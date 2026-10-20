import { batch } from 'react-redux';

import { createRecordingEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { APP_WILL_MOUNT, APP_WILL_UNMOUNT } from '../base/app/actionTypes';
import {
    CONFERENCE_JOIN_IN_PROGRESS,
    ENDPOINT_MESSAGE_RECEIVED,
    NON_PARTICIPANT_MESSAGE_RECEIVED
} from '../base/conference/actionTypes';
import { getCurrentConference } from '../base/conference/functions';
import { openDialog } from '../base/dialog/actions';
import JitsiMeetJS, {
    JitsiConferenceEvents,
    JitsiRecordingConstants
} from '../base/lib-jitsi-meet';
import {
    setAudioMuted,
    setAudioUnmutePermissions,
    setVideoMuted,
    setVideoUnmutePermissions
} from '../base/media/actions';
import { PARTICIPANT_UPDATED } from '../base/participants/actionTypes';
import { participantUpdated, updateLocalRecordingStatus } from '../base/participants/actions';
import { PARTICIPANT_ROLE, TRANSCRIBER_ID } from '../base/participants/constants';
import { getLocalParticipant, getParticipantDisplayName } from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import StateListenerRegistry from '../base/redux/StateListenerRegistry';
import {
    playSound,
    stopSound
} from '../base/sounds/actions';
import { TRACK_ADDED, TRACK_REMOVED, TRACK_UPDATED } from '../base/tracks/actionTypes';
import { hideNotification, showErrorNotification, showNotification } from '../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../notifications/constants';
import { SET_SCREENSHARE_TRACKS } from '../screen-share/actionTypes';
import { setRequestingSubtitles } from '../subtitles/actions.any';
import { isRecorderTranscriptionsRunning } from '../transcribing/functions';

import { RECORDING_SESSION_UPDATED, START_LOCAL_RECORDING, STOP_LOCAL_RECORDING } from './actionTypes';
import {
    clearRecordingSessions,
    hidePendingRecordingNotification,
    markConsentRequested,
    showPendingRecordingNotification,
    showRecordingError,
    showRecordingLimitNotification,
    showRecordingWarning,
    showStartRecordingNotification,
    showStartedRecordingNotification,
    showStoppedRecordingNotification,
    updateRecordingSessionData
} from './actions';
import { RecordingConsentDialog } from './components/Recording';
import LocalRecordingManager from './components/Recording/LocalRecordingManager';
import {
    LIVE_STREAMING_OFF_SOUND_ID,
    LIVE_STREAMING_ON_SOUND_ID,
    LOCAL_RECORDING_ERROR,
    RECORDING_OFF_SOUND_ID,
    RECORDING_ON_SOUND_ID,
    START_RECORDING_NOTIFICATION_ID
} from './constants';
import {
    getResourceId,
    getSessionById,
    registerRecordingAudioFiles,
    shouldRequireRecordingConsent,
    unregisterRecordingAudioFiles
} from './functions';
import logger from './logger';

/**
 * Whether the running local recording turned on transcription itself (and so
 * should release the request when it stops).
 */
let transcriptionRequestedByRecording = false;

/**
 * StateListenerRegistry provides a reliable way to detect the leaving of a
 * conference, where we need to clean up the recording sessions.
 */
StateListenerRegistry.register(
    /* selector */ state => getCurrentConference(state),
    /* listener */ (conference, { dispatch }) => {
        if (!conference) {
            dispatch(clearRecordingSessions());
        }
    }
);

/**
 * Broadcasts the user's global "never record or transcribe me" setting into
 * every conference they join, and whenever they change it.
 */
StateListenerRegistry.register(
    /* selector */ state => [
        getCurrentConference(state),
        Boolean(state['features/base/settings'].recordingOptOut
            || state['features/base/config'].localRecording?.optOut)
    ],
    /* listener */ ([ conference, optOut ], { dispatch, getState }) => {
        const localId = getLocalParticipant(getState())?.id;

        conference?.setLocalParticipantProperty('recordingOptOut', optOut ? 'true' : 'false');
        localId && dispatch(participantUpdated({
            id: localId,
            local: true,
            recordingOptOut: optOut
        }));
    }, {
        deepEquals: true
    }
);

/**
 * The redux middleware to handle the recorder updates in a React way.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register(({ dispatch, getState }) => next => action => {
    let oldSessionData;

    if (action.type === RECORDING_SESSION_UPDATED) {
        oldSessionData
            = getSessionById(getState(), action.sessionData.id);
    }

    const result = next(action);

    switch (action.type) {
    case APP_WILL_MOUNT:
        registerRecordingAudioFiles(dispatch);

        break;

    case APP_WILL_UNMOUNT:
        unregisterRecordingAudioFiles(dispatch);

        break;

    case CONFERENCE_JOIN_IN_PROGRESS: {
        const { conference } = action;

        conference.on(
            JitsiConferenceEvents.RECORDER_STATE_CHANGED,
            (recorderSession: any) => {
                if (recorderSession) {
                    recorderSession.getID() && dispatch(updateRecordingSessionData(recorderSession));
                    if (recorderSession.getError()) {
                        _showRecordingErrorNotification(recorderSession, dispatch, getState);
                    } else {
                        _showExplicitConsentDialog(recorderSession, dispatch, getState);
                    }
                }

                return;
            });

        break;
    }

    case START_LOCAL_RECORDING: {
        const { transcription } = getState()['features/base/config'];
        const { onlySelf } = action;

        LocalRecordingManager.startLocalRecording({
            dispatch,
            getState
        }, action.onlySelf)
        .then(() => {
            const props = {
                descriptionKey: 'recording.on',
                titleKey: 'dialog.recording'
            };

            if (!onlySelf) {
                dispatch(playSound(RECORDING_ON_SOUND_ID));

                // Live transcription gives the per-speaker transcript saved next
                // to the recording; Jicofo invites the transcriber when any
                // participant requests it.
                if (transcription?.enabled && !getState()['features/subtitles']._requestingSubtitles) {
                    transcriptionRequestedByRecording = true;
                    dispatch(setRequestingSubtitles(true, false, null));
                }
            }
            dispatch(showNotification(props, NOTIFICATION_TIMEOUT_TYPE.MEDIUM));
            dispatch(showNotification({
                titleKey: 'recording.localRecordingStartWarningTitle',
                descriptionKey: 'recording.localRecordingStartWarning'
            }, NOTIFICATION_TIMEOUT_TYPE.STICKY));
            dispatch(updateLocalRecordingStatus(true, onlySelf));
            sendAnalytics(createRecordingEvent('started', `local${onlySelf ? '.self' : ''}`));
            if (typeof APP !== 'undefined') {
                APP.API.notifyRecordingStatusChanged(
                    true, 'local', undefined, isRecorderTranscriptionsRunning(getState()));
            }
        })
        .catch(err => {
            if (err.message === LOCAL_RECORDING_ERROR.CANCELLED
                    || err.message === LOCAL_RECORDING_ERROR.ALREADY_RUNNING) {
                // The user closed the folder picker, or double-clicked start.
                return;
            }
            logger.error('Capture failed', err);

            let descriptionKey = 'recording.error';

            if (err.message === LOCAL_RECORDING_ERROR.NO_FOLDER_ACCESS) {
                descriptionKey = 'recording.noFolderAccess';
            } else if (err.message === LOCAL_RECORDING_ERROR.NO_LOCAL_STREAMS) {
                descriptionKey = 'recording.noStreams';
            } else if (err.message === 'NoMicTrack') {
                descriptionKey = 'recording.noMicPermission';
            }
            const props = {
                descriptionKey,
                titleKey: 'recording.failedToStart'
            };

            if (typeof APP !== 'undefined') {
                APP.API.notifyRecordingStatusChanged(
                    false, 'local', err.message, isRecorderTranscriptionsRunning(getState()));
            }

            dispatch(showErrorNotification(props));
        });
        break;
    }

    case STOP_LOCAL_RECORDING: {
        if (LocalRecordingManager.isRecordingLocally()) {
            LocalRecordingManager.stopLocalRecording();
            dispatch(updateLocalRecordingStatus(false));
            if (!LocalRecordingManager.selfRecording.on) {
                dispatch(playSound(RECORDING_OFF_SOUND_ID));
            }
            if (transcriptionRequestedByRecording) {
                transcriptionRequestedByRecording = false;
                dispatch(setRequestingSubtitles(false, false, null));
            }
            if (typeof APP !== 'undefined') {
                APP.API.notifyRecordingStatusChanged(
                    false, 'local', undefined, isRecorderTranscriptionsRunning(getState()));
            }
        }
        break;
    }

    case RECORDING_SESSION_UPDATED: {
        const state = getState();

        // When in recorder mode no notifications are shown
        // or extra sounds are also not desired
        // but we want to indicate those in case of sip gateway
        const {
            iAmRecorder,
            iAmSipGateway,
            recordingLimit
        } = state['features/base/config'];

        if (iAmRecorder && !iAmSipGateway) {
            break;
        }

        const updatedSessionData
            = getSessionById(state, action.sessionData.id);
        const { initiator, mode = '', terminator } = updatedSessionData ?? {};
        const { PENDING, OFF, ON } = JitsiRecordingConstants.status;
        const isRecordingStarting = updatedSessionData?.status === PENDING && oldSessionData?.status !== PENDING;

        if (isRecordingStarting || updatedSessionData?.status === ON) {
            dispatch(hideNotification(START_RECORDING_NOTIFICATION_ID));
        }

        if (isRecordingStarting) {
            dispatch(showPendingRecordingNotification(mode));
            break;
        }

        dispatch(hidePendingRecordingNotification(mode));

        if (updatedSessionData?.status === ON) {

            // We receive 2 updates of the session status ON. The first one is from jibri when it joins.
            // The second one is from jicofo which will deliver the initiator value. Since the start
            // recording notification uses the initiator value we skip the jibri update and show the
            // notification on the update from jicofo.
            // FIXME: simplify checks when the backend start sending only one status ON update containing
            // the initiator.
            if (initiator && !oldSessionData?.initiator) {
                if (typeof recordingLimit === 'object') {
                    dispatch(showRecordingLimitNotification(mode));
                } else {
                    dispatch(showStartedRecordingNotification(mode, initiator, action.sessionData.id));
                }
            }

            if (oldSessionData?.status !== ON) {
                sendAnalytics(createRecordingEvent('start', mode));

                let soundID;

                if (mode === JitsiRecordingConstants.mode.FILE && !isRecorderTranscriptionsRunning(state)) {
                    soundID = RECORDING_ON_SOUND_ID;
                } else if (mode === JitsiRecordingConstants.mode.STREAM) {
                    soundID = LIVE_STREAMING_ON_SOUND_ID;
                }

                if (soundID) {
                    dispatch(playSound(soundID));
                }

                if (typeof APP !== 'undefined') {
                    APP.API.notifyRecordingStatusChanged(
                        true, mode, undefined, isRecorderTranscriptionsRunning(state));
                }
            }
        } else if (updatedSessionData?.status === OFF && oldSessionData?.status !== OFF) {
            if (terminator) {
                dispatch(
                    showStoppedRecordingNotification(
                        mode, getParticipantDisplayName(state, getResourceId(terminator))));
            }

            let duration = 0, soundOff, soundOn;

            if (oldSessionData?.timestamp) {
                duration
                    = (Date.now() / 1000) - oldSessionData.timestamp;
            }
            sendAnalytics(createRecordingEvent('stop', mode, duration));

            if (mode === JitsiRecordingConstants.mode.FILE && !isRecorderTranscriptionsRunning(state)) {
                soundOff = RECORDING_OFF_SOUND_ID;
                soundOn = RECORDING_ON_SOUND_ID;
            } else if (mode === JitsiRecordingConstants.mode.STREAM) {
                soundOff = LIVE_STREAMING_OFF_SOUND_ID;
                soundOn = LIVE_STREAMING_ON_SOUND_ID;
            }

            if (soundOff && soundOn) {
                dispatch(stopSound(soundOn));
                dispatch(playSound(soundOff));
            }

            if (typeof APP !== 'undefined') {
                APP.API.notifyRecordingStatusChanged(
                    false, mode, undefined, isRecorderTranscriptionsRunning(state));
            }
        }

        break;
    }
    case TRACK_ADDED:
    case TRACK_REMOVED:
    case TRACK_UPDATED:
    case SET_SCREENSHARE_TRACKS:
        LocalRecordingManager.isRecordingLocally() && LocalRecordingManager.syncSources();
        break;

    case ENDPOINT_MESSAGE_RECEIVED:
        if (LocalRecordingManager.isRecordingLocally() && action.participant?.isHidden?.()) {
            LocalRecordingManager.onTranscriptionResult(action.data);
        }
        break;

    case NON_PARTICIPANT_MESSAGE_RECEIVED:
        if (LocalRecordingManager.isRecordingLocally() && action.id === TRANSCRIBER_ID) {
            LocalRecordingManager.onTranscriptionResult(action.json);
        }
        break;

    case PARTICIPANT_UPDATED: {
        const { id, role } = action.participant;
        const state = getState();
        const localParticipant = getLocalParticipant(state);

        if (localParticipant?.id !== id) {
            return next(action);
        }

        if (role === PARTICIPANT_ROLE.MODERATOR) {
            dispatch(showStartRecordingNotification());
        }

        return next(action);
    }
    }

    return result;
});

/**
 * Shows a notification about an error in the recording session. A
 * default notification will display if no error is specified in the passed
 * in recording session.
 *
 * @private
 * @param {Object} session - The recorder session model from the
 * lib.
 * @param {Dispatch} dispatch - The Redux Dispatch function.
 * @param {Function} getState - The Redux getState function.
 * @returns {void}
 */
function _showRecordingErrorNotification(session: any, dispatch: IStore['dispatch'], getState: IStore['getState']) {
    const mode = session.getMode();
    const error = session.getError();
    const isStreamMode = mode === JitsiMeetJS.constants.recording.mode.STREAM;

    switch (error) {
    case JitsiMeetJS.constants.recording.error.SERVICE_UNAVAILABLE:
        dispatch(showRecordingError({
            descriptionKey: 'recording.unavailable',
            descriptionArguments: {
                serviceName: isStreamMode
                    ? '$t(liveStreaming.serviceName)'
                    : '$t(recording.serviceName)'
            },
            titleKey: isStreamMode
                ? 'liveStreaming.unavailableTitle'
                : 'recording.unavailableTitle'
        }));
        break;
    case JitsiMeetJS.constants.recording.error.RESOURCE_CONSTRAINT:
        dispatch(showRecordingError({
            descriptionKey: isStreamMode
                ? 'liveStreaming.busy'
                : 'recording.busy',
            titleKey: isStreamMode
                ? 'liveStreaming.busyTitle'
                : 'recording.busyTitle'
        }));
        break;
    case JitsiMeetJS.constants.recording.error.UNEXPECTED_REQUEST:
        dispatch(showRecordingWarning({
            descriptionKey: isStreamMode
                ? 'liveStreaming.sessionAlreadyActive'
                : 'recording.sessionAlreadyActive',
            titleKey: isStreamMode ? 'liveStreaming.inProgress' : 'recording.inProgress'
        }));
        break;
    case JitsiMeetJS.constants.recording.error.POLICY_VIOLATION:
        dispatch(showRecordingWarning({
            descriptionKey: isStreamMode ? 'liveStreaming.policyError' : 'recording.policyError',
            titleKey: isStreamMode ? 'liveStreaming.failedToStart' : 'recording.failedToStart'
        }));
        break;
    default:
        dispatch(showRecordingError({
            descriptionKey: isStreamMode
                ? 'liveStreaming.error'
                : 'recording.error',
            titleKey: isStreamMode
                ? 'liveStreaming.failedToStart'
                : 'recording.failedToStart'
        }));
        break;
    }

    if (typeof APP !== 'undefined') {
        APP.API.notifyRecordingStatusChanged(false, mode, error, isRecorderTranscriptionsRunning(getState()));
    }
}

/**
 * Mutes audio and video and displays the RecordingConsentDialog when the conditions are met.
 *
 * @param {any} recorderSession - The recording session.
 * @param {Function} dispatch - The Redux dispatch function.
 * @param {Function} getState - The Redux getState function.
 * @returns {void}
 */
function _showExplicitConsentDialog(recorderSession: any, dispatch: IStore['dispatch'], getState: IStore['getState']) {
    if (!shouldRequireRecordingConsent(recorderSession, getState())) {
        return;
    }

    batch(() => {
        dispatch(markConsentRequested(recorderSession.getID()));
        dispatch(setAudioUnmutePermissions(true, true));
        dispatch(setVideoUnmutePermissions(true, true));
        dispatch(setAudioMuted(true));
        dispatch(setVideoMuted(true));
        dispatch(openDialog('RecordingConsentDialog', RecordingConsentDialog));
    });
}
