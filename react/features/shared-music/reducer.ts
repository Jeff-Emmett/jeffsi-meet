import ReducerRegistry from '../base/redux/ReducerRegistry';

import {
    RESET_SHARED_MUSIC_STATUS,
    SET_SHARED_MUSIC_MINIMIZED,
    SET_SHARED_MUSIC_STATUS
} from './actionTypes';
import { ISharedMusicState } from './types';

const initialState: ISharedMusicState = {
    minimized: false
};

/**
 * Reduces the Redux actions of the feature features/shared-music.
 */
ReducerRegistry.register<ISharedMusicState>('features/shared-music',
(state = initialState, action): ISharedMusicState => {
    const { musicUrl, status, time, ownerId, muted, volume, sourceType, title, duration } = action;

    switch (action.type) {
    case RESET_SHARED_MUSIC_STATUS:
        return {
            ...initialState
        };

    case SET_SHARED_MUSIC_STATUS:
        return {
            ...state,
            duration,
            muted,
            musicUrl,
            ownerId,
            sourceType,
            status,
            time,
            title,
            volume
        };

    case SET_SHARED_MUSIC_MINIMIZED:
        return {
            ...state,
            minimized: action.minimized
        };

    default:
        return state;
    }
});

export { ISharedMusicState };
