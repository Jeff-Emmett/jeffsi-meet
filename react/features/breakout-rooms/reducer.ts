import ReducerRegistry from '../base/redux/ReducerRegistry';

import {
    UPDATE_BREAKOUT_ROOMS,
    UPDATE_BREAKOUT_TIMER,
    _RESET_BREAKOUT_ROOMS,
    _UPDATE_ROOM_COUNTER
} from './actionTypes';
import { FEATURE_KEY } from './constants';
import { IRooms } from './types';

const DEFAULT_STATE: IBreakoutRoomsState = {
    rooms: {},
    roomCounter: 0,
    timerEndTimestamp: null,
    timerDurationMs: null
};

export interface IBreakoutRoomsState {
    roomCounter: number;
    rooms: IRooms;

    /** Wall-clock ms when the breakout timer fires. null = no timer. */
    timerEndTimestamp: number | null;

    /** Original duration of the running timer in ms (for UI display). */
    timerDurationMs: number | null;
}

/**
 * Listen for actions for the breakout-rooms feature.
 */
ReducerRegistry.register<IBreakoutRoomsState>(FEATURE_KEY, (state = DEFAULT_STATE, action): IBreakoutRoomsState => {
    switch (action.type) {
    case _UPDATE_ROOM_COUNTER:
        return {
            ...state,
            roomCounter: action.roomCounter
        };
    case UPDATE_BREAKOUT_ROOMS: {
        const { roomCounter, rooms } = action;

        return {
            ...state,
            roomCounter,
            rooms
        };
    }
    case UPDATE_BREAKOUT_TIMER: {
        return {
            ...state,
            timerEndTimestamp: action.endTimestamp ?? null,
            timerDurationMs: action.durationMs ?? null
        };
    }
    case _RESET_BREAKOUT_ROOMS: {
        return DEFAULT_STATE;
    }
    }

    return state;
});
