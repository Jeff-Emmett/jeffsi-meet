import { batch } from 'react-redux';

import { IStore } from '../app/types';
import { CONFERENCE_JOIN_IN_PROGRESS, CONFERENCE_LEFT } from '../base/conference/actionTypes';
import { getCurrentConference } from '../base/conference/functions';
import { IJitsiConference } from '../base/conference/reducer';
import { MEDIA_TYPE } from '../base/media/constants';
import { PARTICIPANT_LEFT } from '../base/participants/actionTypes';
import { participantJoined, participantLeft } from '../base/participants/actions';
import { getLocalParticipant, getParticipantById } from '../base/participants/functions';
import { FakeParticipant } from '../base/participants/types';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';

import { RESET_SHARED_MUSIC_STATUS, SET_SHARED_MUSIC_STATUS } from './actionTypes';
import {
    resetSharedMusicStatus,
    setSharedMusicStatus
} from './actions';
import {
    MUSIC_PLAYER_PARTICIPANT_NAME,
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
                    const musicParticipant = getParticipantById(state, value);

                    dispatch(participantLeft(value, conference, {
                        fakeParticipant: musicParticipant?.fakeParticipant
                    }));

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
        const conference = getCurrentConference(state);
        const { ownerId: stateOwnerId, musicUrl: stateMusicUrl } = state['features/shared-music'];

        if (action.participant.id === stateOwnerId) {
            batch(() => {
                dispatch(resetSharedMusicStatus());
                dispatch(participantLeft(stateMusicUrl ?? '', conference));
            });
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
 * Dispatches participantJoined event to show music as a participant tile.
 * Sets the SharedMusicStatus if the event was triggered by the local user.
 *
 * @param {Store} store - The redux store.
 * @param {string} musicUrl - The id/url of the music to be shared.
 * @param {Object} attributes - The attributes received from the share music command.
 * @param {JitsiConference} conference - The current conference.
 * @returns {void}
 */
function handleSharingMusicStatus(store: IStore, musicUrl: string,
        attributes: IMusicCommandAttributes,
        conference: IJitsiConference) {
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

    // If music was not started (no participant), create the fake participant
    // This can be triggered by start, playing, or paused commands (joining late)
    if (attributes.state === PLAYBACK_START || !isSharingStatus(oldStatus)) {
        // Create a fake participant for the music player (shows as a tile, not pinned)
        const displayName = attributes.title || MUSIC_PLAYER_PARTICIPANT_NAME;

        dispatch(participantJoined({
            conference,
            fakeParticipant: FakeParticipant.SharedMusic,
            id: musicUrl,
            name: displayName
        }));

        // Note: We intentionally do NOT pin the participant so it appears as a tile
        // instead of taking over the whole screen like shared video does

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
