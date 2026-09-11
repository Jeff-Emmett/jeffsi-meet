import i18next from 'i18next';

import {
    setPrejoinPageVisibility,
    setSkipPrejoinOnReload
} from '../../prejoin/actions.web';
import { isPrejoinPageVisible } from '../../prejoin/functions';
import { iAmVisitor } from '../../visitors/functions';
import { CONNECTION_DISCONNECTED, CONNECTION_ESTABLISHED } from '../connection/actionTypes';
import { hangup } from '../connection/actions.web';
import { JitsiConferenceErrors, JitsiConnectionErrors, browser } from '../lib-jitsi-meet';
import { gumPending, setInitialGUMPromise } from '../media/actions';
import { MEDIA_TYPE } from '../media/constants';
import { IGUMPendingState } from '../media/types';
import MiddlewareRegistry from '../redux/MiddlewareRegistry';
import { replaceLocalTrack } from '../tracks/actions.any';
import { getLocalTracks } from '../tracks/functions.any';

import {
    CONFERENCE_FAILED,
    CONFERENCE_JOINED,
    CONFERENCE_JOIN_IN_PROGRESS,
    CONFERENCE_LEFT,
    KICKED_OUT
} from './actionTypes';
import { TRIGGER_READY_TO_CLOSE_REASONS } from './constants';
import { processDestroyConferenceEvent } from './functions';
import logger from './logger';
import './middleware.any';

let screenLock: WakeLockSentinel | undefined;

/**
 * Whether a conference is currently in progress, i.e. whether we should be
 * holding a screen wake lock at all. Tracked separately from `screenLock`
 * because the sentinel is legitimately absent for stretches of a live call
 * (the OS drops it every time the document stops being visible).
 */
let wakeLockWanted = false;

/**
 * Releases the screen lock sentinel, if we hold one.
 *
 * @returns {Promise}
 */
async function releaseScreenLock() {
    const lock = screenLock;

    if (!lock) {
        return;
    }

    screenLock = undefined;
    lock.removeEventListener('release', onWakeLockReleased);

    if (!lock.released) {
        logger.debug('Releasing wake lock.');

        try {
            await lock.release();
        } catch (e) {
            logger.error(`Error while releasing the screen wake lock: ${e}.`);
        }
    }
}

/**
 * Requests a new screen wake lock, if one is wanted and we don't already hold
 * a live one. Requesting while the document is hidden always rejects, so that
 * case is skipped rather than burned as a failed attempt.
 *
 * @returns {void}
 */
function requestWakeLock() {
    if (!wakeLockWanted || !navigator.wakeLock?.request) {
        return;
    }
    if (document.visibilityState !== 'visible') {
        return;
    }
    if (screenLock && !screenLock.released) {
        return;
    }

    navigator.wakeLock.request('screen')
        .then(lock => {
            if (!wakeLockWanted) {
                lock.release().catch(() => undefined);

                return;
            }
            screenLock = lock;
            lock.addEventListener('release', onWakeLockReleased);
            logger.debug('Wake lock created.');
        })
        .catch(e => {
            logger.error(`Error while requesting wake lock for screen: ${e}`);
        });
}

/**
 * Starts holding a screen wake lock for the duration of the conference.
 *
 * @returns {void}
 */
function startScreenLock() {
    if (wakeLockWanted) {
        return;
    }
    wakeLockWanted = true;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    requestWakeLock();
}

/**
 * Stops holding a screen wake lock and detaches the visibility listener.
 *
 * @returns {Promise}
 */
async function stopScreenLock() {
    wakeLockWanted = false;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    await releaseScreenLock();
}

/**
 * Page visibility change handler that re-takes the wake lock after the OS has
 * dropped it.
 *
 * The OS releases the sentinel every time the document stops being visible, so
 * the only reliable trigger is "we are visible again — ask for it back". The
 * previous guard also required a previously-successful sentinel to be present
 * and released, which meant a single failed request (most obviously: joining
 * while the tab was in the background, where the API always rejects) gave up
 * on the wake lock permanently for the rest of the call.
 *
 * @returns {void}
 */
function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
    }
}

/**
 * Wake lock released handler.
 *
 * @returns {void}
 */
function onWakeLockReleased() {
    logger.debug('Wake lock released');
}

MiddlewareRegistry.register(store => next => action => {
    const { dispatch, getState } = store;
    const { enableForcedReload } = getState()['features/base/config'];

    switch (action.type) {
    case CONFERENCE_JOIN_IN_PROGRESS: {
        dispatch(setPrejoinPageVisibility(false));

        break;
    }
    case CONFERENCE_JOINED: {
        if (enableForcedReload) {
            dispatch(setSkipPrejoinOnReload(false));
        }

        startScreenLock();

        // rspace TASK-RMEETS-UI-POLISH item 6: keep call audio playing
        // when the screen turns off on mobile. Mobile-only no-op on desktop.
        try {
            const roomName = (getState()['features/base/conference'] as any)?.room ?? 'Meeting';

            require('../../conference/background-audio.web').startBackgroundAudioKeepAlive(roomName, store);
        } catch (e) {
            logger.warn('background-audio start failed', e);
        }

        break;
    }
    case CONFERENCE_FAILED: {
        const errorName = action.error?.name;

        if (enableForcedReload
            && (errorName === JitsiConferenceErrors.CONFERENCE_RESTARTED
                || errorName === JitsiConnectionErrors.SHARD_CHANGED_ERROR)) {
            dispatch(setSkipPrejoinOnReload(true));
        }

        if (errorName === JitsiConferenceErrors.CONFERENCE_DESTROYED) {
            const state = getState();
            const { notifyOnConferenceDestruction = true } = state['features/base/config'];
            const [ reason ] = action.error.params;

            if (processDestroyConferenceEvent(state, dispatch, action.error.params)) {
                break;
            }

            const titlekey = Object.keys(TRIGGER_READY_TO_CLOSE_REASONS)[
                Object.values(TRIGGER_READY_TO_CLOSE_REASONS).indexOf(reason)
            ];

            dispatch(hangup(true, i18next.t(titlekey) || reason, notifyOnConferenceDestruction));
        }

        stopScreenLock();

        break;
    }
    case CONFERENCE_LEFT:
    case KICKED_OUT:
        stopScreenLock();

        // rspace TASK-RMEETS-UI-POLISH item 6: tear down background-audio loop.
        try {
            require('../../conference/background-audio.web').stopBackgroundAudioKeepAlive();
        } catch (e) {
            logger.warn('background-audio stop failed', e);
        }

        break;
    case CONNECTION_DISCONNECTED: {
        const { initialGUMPromise } = getState()['features/base/media'];

        if (initialGUMPromise) {
            store.dispatch(setInitialGUMPromise());
        }

        break;
    }
    case CONNECTION_ESTABLISHED: {
        const { initialGUMPromise } = getState()['features/base/media'];
        const promise = initialGUMPromise ? initialGUMPromise.promise : Promise.resolve({ tracks: [] });
        const prejoinVisible = isPrejoinPageVisible(getState());

        logger.debug(`On connection established: prejoinVisible: ${prejoinVisible}, initialGUMPromiseExists=${
            Boolean(initialGUMPromise)}, promiseExists=${Boolean(promise)}`);

        if (prejoinVisible) {
            promise.then(() => {
                const state = getState();
                let localTracks = getLocalTracks(state['features/base/tracks']);
                const trackReplacePromises = [];

                // Do not signal audio/video tracks if the user joins muted.
                for (const track of localTracks) {
                    // Always add the audio track on Safari because of a known issue where audio playout doesn't happen
                    // if the user joins audio and video muted.
                    if ((track.muted && !(browser.isWebKitBased() && track.jitsiTrack
                            && track.jitsiTrack.getType() === MEDIA_TYPE.AUDIO)) || iAmVisitor(state)) {
                        trackReplacePromises.push(dispatch(replaceLocalTrack(track.jitsiTrack, null))
                            .catch((error: any) => {
                                logger.error(`Failed to replace local track (${track.jitsiTrack}) with null: ${error}`);
                            }));
                    }
                }

                Promise.allSettled(trackReplacePromises).then(() => {

                    // Re-fetch the local tracks after muted tracks have been removed above.
                    // This is needed, because the tracks are effectively disposed by the replaceLocalTrack and should
                    // not be used anymore.
                    localTracks = getLocalTracks(getState()['features/base/tracks']);

                    const jitsiTracks = localTracks.map((t: any) => t.jitsiTrack);


                    return APP.conference.startConference(jitsiTracks);
                })
                .catch(logger.error);
            });
        } else {
            promise.then(({ tracks }) => {
                let tracksToUse = tracks ?? [];

                if (iAmVisitor(getState())) {
                    tracksToUse = [];
                    tracks.forEach(track => track.dispose().catch(logger.error));
                    dispatch(gumPending([ MEDIA_TYPE.AUDIO, MEDIA_TYPE.VIDEO ], IGUMPendingState.NONE));
                }

                dispatch(setInitialGUMPromise());

                return APP.conference.startConference(tracksToUse);
            })
            .catch(logger.error);
        }

        break;
    }
    }

    return next(action);
});
