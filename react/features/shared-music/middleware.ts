import { IStore } from '../app/types';
import { CONFERENCE_JOIN_IN_PROGRESS, CONFERENCE_LEFT } from '../base/conference/actionTypes';
import { getCurrentConference } from '../base/conference/functions';
import { IJitsiConference } from '../base/conference/reducer';
import { MEDIA_TYPE } from '../base/media/constants';
import { PARTICIPANT_LEFT } from '../base/participants/actionTypes';
import { getLocalParticipant } from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';

import { RESET_SHARED_MUSIC_STATUS, SET_SHARED_MUSIC_STATUS } from './actionTypes';
import {
    resetSharedMusicStatus,
    setSharedMusicStatus
} from './actions';
import {
    PLAYBACK_START,
    PLAYBACK_STATUSES,
    SHARED_MUSIC,
    SOURCE_TYPES
} from './constants';
import { isSharedMusicEnabled, isSharingStatus, sendShareMusicCommand } from './functions';
import logger from './logger';
import { IMusicCommandAttributes, SourceType } from './types';


/**
 * Middleware that captures actions related to music sharing and updates
 * components not hooked into redux.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register(store => next => action => {
    const { dispatch, getState } = store;

    if (!isSharedMusicEnabled(getState())) {
        return next(action);
    }

    switch (action.type) {
    case CONFERENCE_JOIN_IN_PROGRESS: {
        const { conference } = action;
        const localParticipantId = getLocalParticipant(getState())?.id;

        conference.addCommandListener(SHARED_MUSIC,
            ({ value, attributes }: { attributes: IMusicCommandAttributes; value: string; }) => {
                const state = getState();
                const sharedMusicStatus = attributes.state;
                const { ownerId } = state['features/shared-music'];

                if (ownerId && ownerId !== attributes.from) {
                    logger.warn(
                        `User with id: ${attributes.from} sent shared music command: ${sharedMusicStatus} `
                        + 'while we are playing.');

                    return;
                }

                if (isSharingStatus(sharedMusicStatus)) {
                    handleSharingMusicStatus(store, value, attributes, conference);

                    return;
                }

                if (sharedMusicStatus === 'stop') {
                    if (localParticipantId !== attributes.from) {
                        dispatch(resetSharedMusicStatus());
                    }
                }
            }
        );
        break;
    }
    case CONFERENCE_LEFT:
        dispatch(resetSharedMusicStatus());
        break;
    case PARTICIPANT_LEFT: {
        const state = getState();
        const { ownerId: stateOwnerId } = state['features/shared-music'];

        if (action.participant.id === stateOwnerId) {
            dispatch(resetSharedMusicStatus());
        }
        break;
    }
    case SET_SHARED_MUSIC_STATUS: {
        const state = getState();
        const conference = getCurrentConference(state);
        const localParticipantId = getLocalParticipant(state)?.id;
        const { musicUrl, status, ownerId, time, muted, volume, sourceType, title } = action;
        const operator = status === PLAYBACK_STATUSES.PLAYING ? 'is' : '';

        logger.debug(`User with id: ${ownerId} ${operator} ${status} music sharing.`);

        if (typeof APP !== 'undefined') {
            APP.API.notifyAudioOrVideoSharingToggled(MEDIA_TYPE.AUDIO, status, ownerId);
        }

        // Don't send command for start status - already sent in playSharedMusic
        if (status === 'start') {
            break;
        }

        if (localParticipantId === ownerId) {
            sendShareMusicCommand({
                conference,
                localParticipantId,
                muted,
                status,
                time,
                id: musicUrl,
                volume,
                sourceType,
                title
            });
        }
        break;
    }
    case RESET_SHARED_MUSIC_STATUS: {
        const state = getState();
        const localParticipantId = getLocalParticipant(state)?.id;
        const { ownerId: stateOwnerId, musicUrl: stateMusicUrl, sourceType } = state['features/shared-music'];

        if (!stateOwnerId) {
            break;
        }

        logger.debug(`User with id: ${stateOwnerId} stop music sharing.`);

        if (typeof APP !== 'undefined') {
            APP.API.notifyAudioOrVideoSharingToggled(MEDIA_TYPE.AUDIO, 'stop', stateOwnerId);
        }

        if (localParticipantId === stateOwnerId) {
            const conference = getCurrentConference(state);

            sendShareMusicCommand({
                conference,
                id: stateMusicUrl ?? '',
                localParticipantId,
                muted: true,
                status: 'stop',
                time: 0,
                volume: 0,
                sourceType
            });
        }
        break;
    }
    }

    return next(action);
});

/**
 * Handles the playing, pause and start statuses for the shared music.
 * Sets the SharedMusicStatus if the event was triggered by the local user.
 *
 * @param {Store} store - The redux store.
 * @param {string} musicUrl - The id/url of the music to be shared.
 * @param {Object} attributes - The attributes received from the share music command.
 * @param {JitsiConference} _conference - The current conference.
 * @returns {void}
 */
function handleSharingMusicStatus(store: IStore, musicUrl: string,
        attributes: IMusicCommandAttributes,
        _conference: IJitsiConference) {
    const { dispatch, getState } = store;
    const localParticipantId = getLocalParticipant(getState())?.id;
    const oldStatus = getState()['features/shared-music']?.status ?? '';
    const oldMusicUrl = getState()['features/shared-music'].musicUrl;

    if (oldMusicUrl && oldMusicUrl !== musicUrl) {
        logger.warn(
            `User with id: ${attributes.from} sent musicUrl: ${musicUrl} while we are playing: ${oldMusicUrl}`);

        return;
    }

    const sourceType = (attributes.sourceType as SourceType) || SOURCE_TYPES.DIRECT;

    // If music was not started, set the initial status
    if (attributes.state === PLAYBACK_START || !isSharingStatus(oldStatus)) {
        if (localParticipantId === attributes.from) {
            dispatch(setSharedMusicStatus({
                musicUrl,
                status: attributes.state,
                time: Number(attributes.time),
                ownerId: localParticipantId,
                sourceType,
                title: attributes.title
            }));
        }
    }

    if (localParticipantId !== attributes.from) {
        dispatch(setSharedMusicStatus({
            muted: attributes.muted === 'true',
            ownerId: attributes.from,
            status: attributes.state,
            time: Number(attributes.time),
            musicUrl,
            volume: attributes.volume ? Number(attributes.volume) : undefined,
            sourceType,
            title: attributes.title
        }));
    }
}
