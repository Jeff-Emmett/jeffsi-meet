import { IStore } from '../app/types';
import { MEDIA_TYPE } from '../base/media/constants';
import { isLocalTrackMuted } from '../base/tracks/functions.any';
import { handleToggleVideoMuted } from '../toolbox/actions.any';
import { muteLocal } from '../video-menu/actions.any';

import { SET_DOCUMENT_PIP_ACTIVE, SET_DOCUMENT_PIP_MINIMIZED, SET_PIP_ACTIVE } from './actionTypes';
import {
    cleanupMediaSessionHandlers,
    closeDocumentPiPWindow,
    enterPiP,
    isDocumentPiPSupported,
    openDocumentPiPWindow,
    setupMediaSessionHandlers,
    shouldShowPiP
} from './functions';
import logger from './logger';

/**
 * Action to set Picture-in-Picture active state.
 *
 * @param {boolean} isPiPActive - Whether PiP is active.
 * @returns {{
 *     type: SET_PIP_ACTIVE,
 *     isPiPActive: boolean
 * }}
 */
export function setPiPActive(isPiPActive: boolean) {
    return {
        type: SET_PIP_ACTIVE,
        isPiPActive
    };
}

/**
 * Action to set Document Picture-in-Picture active state.
 *
 * @param {boolean} isDocumentPiPActive - Whether Document PiP is active.
 * @returns {{
 *     type: SET_DOCUMENT_PIP_ACTIVE,
 *     isDocumentPiPActive: boolean
 * }}
 */
export function setDocumentPiPActive(isDocumentPiPActive: boolean) {
    return {
        type: SET_DOCUMENT_PIP_ACTIVE,
        isDocumentPiPActive
    };
}

/**
 * Action to set whether the Document Picture-in-Picture window is collapsed
 * to a video-only view.
 *
 * @param {boolean} isDocumentPiPMinimized - Whether the popout is minimized.
 * @returns {{
 *     type: SET_DOCUMENT_PIP_MINIMIZED,
 *     isDocumentPiPMinimized: boolean
 * }}
 */
export function setDocumentPiPMinimized(isDocumentPiPMinimized: boolean) {
    return {
        type: SET_DOCUMENT_PIP_MINIMIZED,
        isDocumentPiPMinimized
    };
}

/**
 * Toggles the minimized (video-only) state of the Document PiP window.
 *
 * @returns {Function}
 */
export function toggleDocumentPiPMinimized() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const isMinimized = getState()['features/pip']?.isDocumentPiPMinimized;

        dispatch(setDocumentPiPMinimized(!isMinimized));
    };
}

/**
 * Action to enter Document Picture-in-Picture mode. Rejects if the window
 * fails to open (unsupported browser, no transient activation, etc.) so
 * callers can fall back to classic video PiP.
 *
 * @returns {Function}
 */
export function enterDocumentPiP() {
    return async (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        if (getState()['features/pip']?.isDocumentPiPActive) {
            return;
        }

        await openDocumentPiPWindow();
        dispatch(setDocumentPiPActive(true));
    };
}

/**
 * Action to exit Document Picture-in-Picture mode. Idempotent - closing the
 * window itself triggers its own 'pagehide' listener (see
 * DocumentPiPContent), so this can legitimately be dispatched twice for one
 * exit (e.g. the header button closing the window, then the resulting
 * pagehide event firing this again).
 *
 * @returns {Function}
 */
export function exitDocumentPiP() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        if (!getState()['features/pip']?.isDocumentPiPActive) {
            return;
        }

        closeDocumentPiPWindow();
        dispatch(setDocumentPiPActive(false));
    };
}

/**
 * Toggles audio mute from PiP MediaSession controls.
 * Uses exact same logic as toolbar audio button including GUM pending state.
 *
 * @returns {Function}
 */
export function toggleAudioFromPiP() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const audioMuted = isLocalTrackMuted(state['features/base/tracks'], MEDIA_TYPE.AUDIO);

        // Use the exact same action as toolbar button.
        dispatch(muteLocal(!audioMuted, MEDIA_TYPE.AUDIO));
    };
}

/**
 * Toggles video mute from PiP MediaSession controls.
 * Uses exact same logic as toolbar video button including GUM pending state.
 *
 * @returns {Function}
 */
export function toggleVideoFromPiP() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const videoMuted = isLocalTrackMuted(state['features/base/tracks'], MEDIA_TYPE.VIDEO);

        // Use the exact same action as toolbar button (showUI=true, ensureTrack=true).
        dispatch(handleToggleVideoMuted(!videoMuted, true, true));
    };
}

/**
 * Action to exit Picture-in-Picture mode.
 *
 * @returns {Function}
 */
export function exitPiP() {
    return (dispatch: IStore['dispatch']) => {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture()
            .then(() => {
                logger.debug('Exited Picture-in-Picture mode');
            })
            .catch((err: Error) => {
                logger.error(`Error while exiting PiP: ${err.message}`);
            });
        }

        dispatch(setPiPActive(false));
        cleanupMediaSessionHandlers();
    };
}

/**
 * Action to handle window blur or tab switch.
 * Enters PiP mode if not already active.
 *
 * @param {HTMLVideoElement} videoElement - The video element we will use for PiP.
 * @returns {Function}
 */
export function handleWindowBlur(videoElement: HTMLVideoElement) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isPiPActive = state['features/pip']?.isPiPActive;
        const isDocumentPiPActive = state['features/pip']?.isDocumentPiPActive;

        if (isPiPActive || isDocumentPiPActive) {
            return;
        }

        if (isDocumentPiPSupported()) {
            // Tier 1: custom popout window. Requires transient activation,
            // which may not always be available at blur time - fall back to
            // the guaranteed Tier 2 (classic video PiP) if it throws.
            dispatch(enterDocumentPiP()).catch((err: Error) => {
                logger.warn(`Document PiP unavailable, falling back to video PiP: ${err.message}`);
                enterPiP(videoElement);
            });

            return;
        }

        enterPiP(videoElement);
    };
}

/**
 * Action to handle window focus.
 * Exits PiP mode if currently active (matches old AOT behavior).
 *
 * @returns {Function}
 */
export function handleWindowFocus() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isPiPActive = state['features/pip']?.isPiPActive;

        if (isPiPActive) {
            dispatch(exitPiP());
        }
    };
}

/**
 * Action to handle the browser's leavepictureinpicture event.
 * Updates state and cleans up MediaSession handlers.
 *
 * @returns {Function}
 */
export function handlePiPLeaveEvent() {
    return (dispatch: IStore['dispatch']) => {
        logger.log('Left Picture-in-Picture mode');

        dispatch(setPiPActive(false));
        cleanupMediaSessionHandlers();
        APP.API.notifyPictureInPictureLeft();
    };
}

/**
 * Action to handle the browser's enterpictureinpicture event.
 * Updates state and sets up MediaSession handlers.
 *
 * @returns {Function}
 */
export function handlePipEnterEvent() {
    return (dispatch: IStore['dispatch']) => {
        logger.log('Entered Picture-in-Picture mode');

        dispatch(setPiPActive(true));
        setupMediaSessionHandlers(dispatch);
        APP.API.notifyPictureInPictureEntered();
    };
}

/**
 * Shows Picture-in-Picture window.
 * Called from external API when iframe becomes not visible (IntersectionObserver).
 *
 * @returns {Function}
 */
export function showPiP() {
    return (_dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isPiPActive = state['features/pip']?.isPiPActive;

        if (!shouldShowPiP(state)) {
            return;
        }

        if (!isPiPActive) {
            const videoElement = document.getElementById('pipVideo') as HTMLVideoElement;

            if (videoElement) {
                enterPiP(videoElement);
            }
        }
    };
}

/**
 * Hides Picture-in-Picture window.
 * Called from external API when iframe becomes visible.
 *
 * @returns {Function}
 */
export function hidePiP() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        const state = getState();
        const isPiPActive = state['features/pip']?.isPiPActive;

        if (isPiPActive) {
            dispatch(exitPiP());
        }
    };
}
