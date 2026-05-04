import {
    CONFERENCE_JOINED,
    ENDPOINT_MESSAGE_RECEIVED
} from '../base/conference/actionTypes';
import { JitsiConferenceEvents } from '../base/lib-jitsi-meet';
import { PARTICIPANT_JOINED } from '../base/participants/actionTypes';
import {
    getParticipantById,
    isLocalParticipantModerator
} from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import StateListenerRegistry from '../base/redux/StateListenerRegistry';
import { editMessage } from '../chat/actions.any';
import { MESSAGE_TYPE_REMOTE } from '../chat/constants';
import { showNotification } from '../notifications/actions';
import {
    NOTIFICATION_TIMEOUT_TYPE,
    NOTIFICATION_TYPE
} from '../notifications/constants';

import { UPDATE_BREAKOUT_ROOMS, UPDATE_BREAKOUT_TIMER } from './actionTypes';
import {
    _fulfilBreakoutAssignments,
    applyBreakoutAssignmentsFromUrl,
    clearBreakoutTimer,
    moveToRoom
} from './actions';
import {
    BREAKOUT_BROADCAST_TYPE,
    BREAKOUT_HELP_REQUEST_TYPE,
    BREAKOUT_TIMER_UPDATE_TYPE,
    BREAKOUT_TIMER_WARNING_MS,
    FEATURE_KEY
} from './constants';
import { isInBreakoutRoom } from './functions';
import logger from './logger';
import { IRoom, IRooms } from './types';

function _toApiPayload(room: IRoom) {
    return {
        roomId: room.id,
        jid: room.jid,
        name: room.name,
        isMainRoom: Boolean(room.isMainRoom)
    };
}

/**
 * Registers a change handler for state['features/base/conference'].conference to
 * set the event listeners needed for the breakout rooms feature to operate.
 */
StateListenerRegistry.register(
    state => state['features/base/conference'].conference,
    (conference, { dispatch }, previousConference) => {
        if (conference && !previousConference) {
            conference.on(JitsiConferenceEvents.BREAKOUT_ROOMS_MOVE_TO_ROOM, (roomId: string) => {
                logger.debug(`Moving to room: ${roomId}`);
                dispatch(moveToRoom(roomId));
            });

            conference.on(JitsiConferenceEvents.BREAKOUT_ROOMS_UPDATED, ({ rooms, roomCounter }: {
                roomCounter: number; rooms: IRooms;
            }) => {
                logger.debug('Room list updated');
                if (typeof APP !== 'undefined') {
                    APP.API.notifyBreakoutRoomsUpdated(rooms);
                }
                dispatch({
                    type: UPDATE_BREAKOUT_ROOMS,
                    rooms,
                    roomCounter
                });
            });
        }
    });

/**
 * Notify the iframe API when the local participant moves between rooms by
 * tracking the current conference room name across conference swaps.
 */
let _lastReportedRoomId: string | undefined;

StateListenerRegistry.register(
    state => state['features/base/conference'].conference,
    (conference, { getState }) => {
        if (typeof APP === 'undefined') {
            return;
        }
        const newRoomId = conference?.getName?.();
        const rooms = getState()[FEATURE_KEY].rooms;
        const previousRoomId = _lastReportedRoomId;

        if (previousRoomId && previousRoomId !== newRoomId) {
            const previous = rooms[previousRoomId];

            APP.API.notifyBreakoutRoomLeft(previous
                ? _toApiPayload(previous)
                : { roomId: previousRoomId, jid: '', name: '', isMainRoom: false });
        }

        if (newRoomId && newRoomId !== previousRoomId) {
            const current = rooms[newRoomId];

            APP.API.notifyBreakoutRoomJoined(current
                ? _toApiPayload(current)
                : { roomId: newRoomId, jid: '', name: '', isMainRoom: true });
        }

        _lastReportedRoomId = newRoomId;
    });

/**
 * Pending timeouts for the running breakout-room timer. Stored in module
 * scope so START / CLEAR can cancel each other reliably across actions.
 */
let _timerExpireTimeout: ReturnType<typeof setTimeout> | null = null;
let _timerWarningTimeout: ReturnType<typeof setTimeout> | null = null;

function _cancelTimerSchedules() {
    if (_timerExpireTimeout) {
        clearTimeout(_timerExpireTimeout);
        _timerExpireTimeout = null;
    }
    if (_timerWarningTimeout) {
        clearTimeout(_timerWarningTimeout);
        _timerWarningTimeout = null;
    }
}

MiddlewareRegistry.register(({ dispatch, getState }) => next => action => {
    const { type } = action;

    switch (type) {
    case CONFERENCE_JOINED: {
        // Parse pre-assignments from the URL on first join. Mid-conference
        // re-joins (breakout swaps) won't re-parse because the param is
        // already consumed and the store carries pendingAssignments through.
        if (typeof window !== 'undefined') {
            // Defer until after the action settles, so isLocalParticipantModerator
            // sees the post-join role. Idempotent — applyBreakoutAssignments
            // bails when no param is present.
            setTimeout(() => dispatch(applyBreakoutAssignmentsFromUrl()), 0);
        }
        break;
    }
    case PARTICIPANT_JOINED: {
        // Late joiner may match a still-pending assignment.
        const { pendingAssignments } = getState()[FEATURE_KEY];

        if (pendingAssignments?.rooms?.length) {
            setTimeout(() => dispatch(_fulfilBreakoutAssignments()), 0);
        }
        break;
    }
    case ENDPOINT_MESSAGE_RECEIVED: {
        const data = action.data;

        if (!data || typeof data !== 'object') {
            break;
        }

        switch (data.type) {
        case BREAKOUT_BROADCAST_TYPE: {
            dispatch(showNotification({
                appearance: NOTIFICATION_TYPE.NORMAL,
                titleKey: 'breakoutRooms.notifications.broadcastTitle',
                description: String(data.message ?? '')
            }, NOTIFICATION_TIMEOUT_TYPE.LONG));
            if (typeof APP !== 'undefined') {
                APP.API.notifyBreakoutBroadcast({
                    message: data.message,
                    senderId: data.senderId,
                    senderName: data.senderName,
                    timestamp: data.timestamp
                });
            }
            break;
        }
        case BREAKOUT_HELP_REQUEST_TYPE: {
            // Only moderators surface the toast; everyone else ignores it.
            if (isLocalParticipantModerator(getState())) {
                dispatch(showNotification({
                    appearance: NOTIFICATION_TYPE.WARNING,
                    titleKey: 'breakoutRooms.notifications.helpRequestedTitle',
                    descriptionKey: 'breakoutRooms.notifications.helpRequested',
                    descriptionArguments: {
                        name: data.participantName ?? 'A participant',
                        room: data.roomName ?? ''
                    }
                }, NOTIFICATION_TIMEOUT_TYPE.STICKY));
            }
            if (typeof APP !== 'undefined') {
                APP.API.notifyBreakoutRoomHelpRequested({
                    roomId: data.roomId,
                    jid: data.roomJid,
                    name: data.roomName,
                    participantId: data.participantId,
                    participantName: data.participantName
                });
            }
            break;
        }
        case BREAKOUT_TIMER_UPDATE_TYPE: {
            // Mirror remote timer state into local store (skip for the
            // moderator who already updated it locally on send).
            const { timerEndTimestamp } = getState()[FEATURE_KEY];
            const remoteEnd = data.endTimestamp ?? null;

            if (timerEndTimestamp !== remoteEnd) {
                dispatch({
                    type: UPDATE_BREAKOUT_TIMER,
                    endTimestamp: remoteEnd,
                    durationMs: data.durationMs ?? null
                });
            }
            break;
        }
        }
        break;
    }
    case UPDATE_BREAKOUT_TIMER: {
        _cancelTimerSchedules();
        const endTimestamp: number | null = action.endTimestamp ?? null;

        if (typeof APP !== 'undefined') {
            APP.API.notifyBreakoutTimerUpdated({
                endTimestamp,
                durationMs: action.durationMs ?? null
            });
        }
        if (endTimestamp) {
            const remaining = endTimestamp - Date.now();

            if (remaining <= 0) {
                if (isInBreakoutRoom(getState())) {
                    dispatch(moveToRoom());
                }
                dispatch(clearBreakoutTimer());
                break;
            }

            if (remaining > BREAKOUT_TIMER_WARNING_MS) {
                _timerWarningTimeout = setTimeout(() => {
                    _timerWarningTimeout = null;
                    if (isInBreakoutRoom(getState())) {
                        dispatch(showNotification({
                            appearance: NOTIFICATION_TYPE.WARNING,
                            titleKey: 'breakoutRooms.notifications.timerWarningTitle',
                            descriptionKey: 'breakoutRooms.notifications.timerWarning'
                        }, NOTIFICATION_TIMEOUT_TYPE.MEDIUM));
                    }
                }, remaining - BREAKOUT_TIMER_WARNING_MS);
            }

            _timerExpireTimeout = setTimeout(() => {
                _timerExpireTimeout = null;
                if (isInBreakoutRoom(getState())) {
                    dispatch(moveToRoom());
                }
                // Moderator clears state; receivers also clear so a stale
                // endTimestamp doesn't keep firing notifications.
                dispatch({
                    type: UPDATE_BREAKOUT_TIMER,
                    endTimestamp: null,
                    durationMs: null
                });
            }, remaining);
        }
        break;
    }
    case UPDATE_BREAKOUT_ROOMS: {
        if (typeof APP !== 'undefined') {
            const previousRooms = getState()[FEATURE_KEY].rooms || {};
            const newRooms: IRooms = action.rooms || {};

            for (const [ id, room ] of Object.entries(newRooms)) {
                if (!previousRooms[id] && !room.isMainRoom) {
                    APP.API.notifyBreakoutRoomCreated(_toApiPayload(room));
                }
            }
            for (const [ id, room ] of Object.entries(previousRooms)) {
                if (!newRooms[id] && !room.isMainRoom) {
                    APP.API.notifyBreakoutRoomRemoved(_toApiPayload(room));
                }
            }
        }

        // Re-attempt pending pre-assignments now that the room list has settled.
        // The dispatch needs to run after this action has been reduced into state.
        const { pendingAssignments } = getState()[FEATURE_KEY];

        if (pendingAssignments?.rooms?.length) {
            setTimeout(() => dispatch(_fulfilBreakoutAssignments()), 0);
        }

        // edit name if it was overwritten
        if (!action.updatedNames) {
            const { overwrittenNameList } = getState()['features/base/participants'];

            if (Object.keys(overwrittenNameList).length > 0) {
                const newRooms: IRooms = {};

                Object.entries(action.rooms as IRooms).forEach(([ key, r ]) => {
                    let participants = r?.participants || {};
                    let jid;

                    for (const id of Object.keys(overwrittenNameList)) {
                        jid = Object.keys(participants).find(p => p.slice(p.indexOf('/') + 1) === id);

                        if (jid) {
                            participants = {
                                ...participants,
                                [jid]: {
                                    ...participants[jid],
                                    displayName: overwrittenNameList[id as keyof typeof overwrittenNameList]
                                }
                            };
                        }
                    }

                    newRooms[key] = {
                        ...r,
                        participants
                    };
                });

                action.rooms = newRooms;
            }
        }

        // edit the chat history to match names for participants in breakout rooms
        const { messages } = getState()['features/chat'];

        messages?.forEach(m => {
            if (m.messageType === MESSAGE_TYPE_REMOTE && !getParticipantById(getState(), m.participantId)) {
                const rooms: IRooms = action.rooms;

                for (const room of Object.values(rooms)) {
                    const participants = room.participants || {};
                    const matchedJid = Object.keys(participants).find(jid => jid.endsWith(m.participantId));

                    if (matchedJid) {
                        m.displayName = participants[matchedJid].displayName;

                        dispatch(editMessage(m));
                    }
                }
            }
        });

        break;
    }
    }

    return next(action);
});
