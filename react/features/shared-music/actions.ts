import { IStore } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';
import { openDialog } from '../base/dialog/actions';
import { getLocalParticipant } from '../base/participants/functions';

import {
    RESET_SHARED_MUSIC_STATUS,
    SET_SHARED_MUSIC_MINIMIZED,
    SET_SHARED_MUSIC_STATUS
} from './actionTypes';
import { SharedMusicDialog } from './components';
import { PLAYBACK_START, PLAYBACK_STATUSES } from './constants';
import { extractMusicUrl, isSharedMusicEnabled, sendShareMusicCommand } from './functions';
import { SourceType } from './types';

/**
 * Resets the status of the shared music.
 *
 * @returns {{
 *     type: RESET_SHARED_MUSIC_STATUS,
 * }}
 */
export function resetSharedMusicStatus() {
    return {
        type: RESET_SHARED_MUSIC_STATUS
    };
}

/**
 * Updates the current known status of the shared music.
 *
 * @param {Object} options - The options.
 * @param {number} options.duration - Track duration.
 * @param {boolean} options.muted - Is music muted.
 * @param {string} options.musicUrl - URL of the shared music.
 * @param {string} options.ownerId - Participant ID of the owner.
 * @param {string} options.sourceType - Source type (youtube or direct).
 * @param {string} options.status - Sharing status.
 * @param {number} options.time - Playback timestamp.
 * @param {string} options.title - Track title.
 * @param {number} options.volume - Volume level.
 * @returns {Object}
 */
export function setSharedMusicStatus({ musicUrl, status, time, ownerId, muted, volume, sourceType, title, duration }: {
    duration?: number;
    musicUrl: string;
    muted?: boolean;
    ownerId?: string;
    sourceType?: SourceType;
    status: string;
    time: number;
    title?: string;
    volume?: number;
}) {
    return {
        type: SET_SHARED_MUSIC_STATUS,
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
}

/**
 * Sets the minimized state of the music player.
 *
 * @param {boolean} minimized - Whether the player is minimized.
 * @returns {{
 *     type: SET_SHARED_MUSIC_MINIMIZED,
 *     minimized: boolean
 * }}
 */
export function setSharedMusicMinimized(minimized: boolean) {
    return {
        type: SET_SHARED_MUSIC_MINIMIZED,
        minimized
    };
}

/**
 * Displays the dialog for entering the music link.
 *
 * @param {Function} onPostSubmit - The function to be invoked when a valid link is entered.
 * @returns {Function}
 */
export function showSharedMusicDialog(onPostSubmit: Function) {
    return openDialog('SharedMusicDialog', SharedMusicDialog, { onPostSubmit });
}

/**
 * Stops playing shared music.
 *
 * @returns {Function}
 */
export function stopSharedMusic() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const { ownerId } = state['features/shared-music'];
        const localParticipant = getLocalParticipant(state);

        if (ownerId === localParticipant?.id) {
            dispatch(resetSharedMusicStatus());
        }
    };
}

/**
 * Plays shared music.
 *
 * @param {string} input - The music url or YouTube ID to be played.
 * @returns {Function}
 */
export function playSharedMusic(input: string) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        if (!isSharedMusicEnabled(getState())) {
            return;
        }

        const extracted = extractMusicUrl(input);

        if (!extracted) {
            return;
        }

        const { url, sourceType } = extracted;
        const conference = getCurrentConference(getState());

        if (conference) {
            const localParticipant = getLocalParticipant(getState());

            sendShareMusicCommand({
                conference,
                id: url,
                localParticipantId: localParticipant?.id,
                sourceType,
                status: PLAYBACK_START,
                time: 0
            });
        }
    };
}

/**
 * Toggles shared music - opens dialog if not playing, stops if playing.
 *
 * @returns {Function}
 */
export function toggleSharedMusic() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const { status = '' } = state['features/shared-music'];

        if ([ PLAYBACK_STATUSES.PLAYING, PLAYBACK_START, PLAYBACK_STATUSES.PAUSED ].includes(status)) {
            dispatch(stopSharedMusic());
        } else {
            dispatch(showSharedMusicDialog((url: string) => dispatch(playSharedMusic(url))));
        }
    };
}
