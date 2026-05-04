import { find } from 'lodash-es';

import { IStateful } from '../base/app/types';
import { getCurrentConference } from '../base/conference/functions';
import {
    getLocalParticipant,
    getParticipantById,
    getParticipantCount,
    isLocalParticipantModerator
} from '../base/participants/functions';
import { IJitsiParticipant } from '../base/participants/types';
import { toState } from '../base/redux/functions';

import { FEATURE_KEY } from './constants';
import logger from './logger';
import { IBreakoutAssignments, IRoom, IRoomInfo, IRoomInfoParticipant, IRooms, IRoomsInfo } from './types';

/**
 * Returns the rooms object for breakout rooms.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @returns {Object} Object of rooms.
 */
export const getBreakoutRooms = (stateful: IStateful): IRooms => toState(stateful)[FEATURE_KEY].rooms;

/**
 * Returns the main room.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @returns {IRoom|undefined} The main room object, or undefined.
 */
export const getMainRoom = (stateful: IStateful) => {
    const rooms = getBreakoutRooms(stateful);

    return find(rooms, room => Boolean(room.isMainRoom));
};

/**
 * Returns the rooms info.
 *
 * @param {IStateful} stateful - The redux store, the redux.

* @returns {IRoomsInfo} The rooms info.
 */
export const getRoomsInfo = (stateful: IStateful) => {
    const breakoutRooms = getBreakoutRooms(stateful);
    const conference = getCurrentConference(stateful);

    const initialRoomsInfo = {
        rooms: []
    };

    // only main roomn
    if (!breakoutRooms || Object.keys(breakoutRooms).length === 0) {
        // filter out hidden participants
        const conferenceParticipants = conference?.getParticipants()
            .filter((participant: IJitsiParticipant) => !participant.isHidden());

        const localParticipant = getLocalParticipant(stateful);
        let localParticipantInfo;

        if (localParticipant) {
            localParticipantInfo = {
                role: localParticipant.role,
                displayName: localParticipant.name,
                avatarUrl: localParticipant.loadableAvatarUrl,
                id: localParticipant.id
            };
        }

        return {
            ...initialRoomsInfo,
            rooms: [ {
                isMainRoom: true,
                id: conference?.room?.roomjid,
                jid: conference?.room?.myroomjid,
                participants: conferenceParticipants?.length > 0
                    ? [
                        localParticipantInfo,
                        ...conferenceParticipants.map((participantItem: IJitsiParticipant) => {
                            const storeParticipant = getParticipantById(stateful, participantItem.getId());

                            return {
                                jid: participantItem.getJid(),
                                role: participantItem.getRole(),
                                displayName: participantItem.getDisplayName(),
                                avatarUrl: storeParticipant?.loadableAvatarUrl,
                                id: participantItem.getId()
                            } as IRoomInfoParticipant;
                        }) ]
                    : [ localParticipantInfo ]
            } as IRoomInfo ]
        } as IRoomsInfo;
    }

    return {
        ...initialRoomsInfo,
        rooms: Object.keys(breakoutRooms).map(breakoutRoomKey => {
            const breakoutRoomItem = breakoutRooms[breakoutRoomKey];

            return {
                isMainRoom: Boolean(breakoutRoomItem.isMainRoom),
                id: breakoutRoomItem.id,
                jid: breakoutRoomItem.jid,
                participants: breakoutRoomItem.participants && Object.keys(breakoutRoomItem.participants).length
                    ? Object.keys(breakoutRoomItem.participants).map(participantLongId => {
                        const participantItem = breakoutRoomItem.participants[participantLongId];
                        const ids = participantLongId.split('/');
                        const storeParticipant = getParticipantById(stateful,
                            ids.length > 1 ? ids[1] : participantItem.jid);

                        return {
                            jid: participantItem?.jid,
                            role: participantItem?.role,
                            displayName: participantItem?.displayName,
                            avatarUrl: storeParticipant?.loadableAvatarUrl,
                            id: storeParticipant ? storeParticipant.id
                                : participantLongId
                        } as IRoomInfoParticipant;
                    }) : []
            } as IRoomInfo;
        })
    } as IRoomsInfo;
};

/**
 * Returns the room by Jid.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @param {string} roomJid - The jid of the room.
 * @returns {IRoom|undefined} The main room object, or undefined.
 */
export const getRoomByJid = (stateful: IStateful, roomJid: string) => {
    const rooms = getBreakoutRooms(stateful);

    return find(rooms, (room: IRoom) => room.jid === roomJid);
};

/**
 * Returns the id of the current room.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @returns {string} Room id or undefined.
 */
export const getCurrentRoomId = (stateful: IStateful) => {
    const conference = getCurrentConference(stateful);

    return conference?.getName();
};

/**
 * Determines whether the local participant is in a breakout room.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @returns {boolean}
 */
export const isInBreakoutRoom = (stateful: IStateful) => {
    const conference = getCurrentConference(stateful);

    return conference?.getBreakoutRooms()?.isBreakoutRoom();
};

/**
 * Returns the breakout rooms config.
 *
 * @param {IStateful} stateful - The redux store, the redux
 * {@code getState} function, or the redux state itself.
 * @returns {Object}
 */
export const getBreakoutRoomsConfig = (stateful: IStateful) => {
    const state = toState(stateful);
    const { breakoutRooms = {} } = state['features/base/config'];

    return breakoutRooms;
};

/**
 * Returns whether the add breakout room button is visible.
 *
 * @param {IStateful} stateful - Global state.
 * @returns {boolean}
 */
export const isAddBreakoutRoomButtonVisible = (stateful: IStateful) => {
    const state = toState(stateful);
    const isLocalModerator = isLocalParticipantModerator(state);
    const { conference } = state['features/base/conference'];
    const isBreakoutRoomsSupported = conference?.getBreakoutRooms()?.isSupported();
    const { hideAddRoomButton } = getBreakoutRoomsConfig(state);

    return isLocalModerator && isBreakoutRoomsSupported && !hideAddRoomButton;
};

/**
 * Returns whether the auto assign participants to breakout rooms button is visible.
 *
 * @param {IStateful} stateful - Global state.
 * @returns {boolean}
 */
export const isAutoAssignParticipantsVisible = (stateful: IStateful) => {
    const state = toState(stateful);
    const rooms = getBreakoutRooms(state);
    const inBreakoutRoom = isInBreakoutRoom(state);
    const isLocalModerator = isLocalParticipantModerator(state);
    const participantsCount = getParticipantCount(state);
    const { hideAutoAssignButton } = getBreakoutRoomsConfig(state);

    return !inBreakoutRoom
        && isLocalModerator
        && participantsCount > 2
        && Object.keys(rooms).length > 1
        && !hideAutoAssignButton;
};

/**
 * Parse a `breakout-assignments=` URL search param. Accepts either a JSON
 * object/array directly, or that JSON base64-url encoded. Returns a
 * normalised {@link IBreakoutAssignments} or null on any error.
 *
 * Supported shapes:
 *   1. `{ rooms: [{ name, participants: ["id1", "id2"] }, ...] }`
 *   2. `[{ name, participants: [...] }, ...]`
 *   3. `{ "displayName1": "Room A", "displayName2": "Room A", ... }` (Zoom-style)
 *
 * @param {string} value - The raw search-param value.
 * @returns {IBreakoutAssignments | null}
 */
export function parseBreakoutAssignments(value: string | null | undefined): IBreakoutAssignments | null {
    if (!value) {
        return null;
    }
    let raw = value;

    if (!raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
        try {
            // tolerate base64url
            const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
                .padEnd(Math.ceil(raw.length / 4) * 4, '=');
            const g: any = typeof globalThis === 'undefined' ? {} : globalThis;

            if (typeof g.atob === 'function') {
                raw = g.atob(padded);
            } else if (g.Buffer?.from) {
                raw = g.Buffer.from(padded, 'base64').toString('utf8');
            } else {
                logger.warn('parseBreakoutAssignments: no base64 decoder available');

                return null;
            }
        } catch (err) {
            logger.warn('parseBreakoutAssignments: base64 decode failed', err);

            return null;
        }
    }

    let parsed: any;

    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        logger.warn('parseBreakoutAssignments: JSON parse failed', err);

        return null;
    }

    if (Array.isArray(parsed)) {
        return { rooms: _normaliseAssignmentRooms(parsed) };
    }
    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.rooms)) {
            return { rooms: _normaliseAssignmentRooms(parsed.rooms) };
        }

        // Flat shape: { "<participantIdentifier>": "<roomName>", ... }
        const byRoom = new Map<string, string[]>();

        for (const [ id, name ] of Object.entries(parsed)) {
            if (typeof name !== 'string' || !name.trim()) {
                continue;
            }
            const list = byRoom.get(name.trim()) || [];

            list.push(String(id));
            byRoom.set(name.trim(), list);
        }
        if (!byRoom.size) {
            return null;
        }

        return {
            rooms: Array.from(byRoom.entries()).map(([ name, participants ]) => ({
                name,
                participants
            }))
        };
    }

    return null;
}

function _normaliseAssignmentRooms(arr: any[]) {
    const out = [] as Array<{ name: string; participants: string[]; }>;

    for (const r of arr) {
        if (!r || typeof r !== 'object') {
            continue;
        }
        const name = String(r.name ?? '').trim();

        if (!name) {
            continue;
        }
        const participants = Array.isArray(r.participants)
            ? r.participants.map((p: unknown) => String(p)).filter(Boolean)
            : [];

        out.push({ name,
            participants });
    }

    return out;
}
