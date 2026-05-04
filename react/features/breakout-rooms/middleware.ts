import { JitsiConferenceEvents } from '../base/lib-jitsi-meet';
import { getParticipantById } from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import StateListenerRegistry from '../base/redux/StateListenerRegistry';
import { editMessage } from '../chat/actions.any';
import { MESSAGE_TYPE_REMOTE } from '../chat/constants';

import { UPDATE_BREAKOUT_ROOMS } from './actionTypes';
import { moveToRoom } from './actions';
import { FEATURE_KEY } from './constants';
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

MiddlewareRegistry.register(({ dispatch, getState }) => next => action => {
    const { type } = action;

    switch (type) {
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
