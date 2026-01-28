import { IStateful } from '../base/app/types';
import { IJitsiConference } from '../base/conference/reducer';
import { toState } from '../base/redux/functions';

import {
    PLAYBACK_START,
    PLAYBACK_STATUSES,
    SHARED_MUSIC,
    SOURCE_TYPES,
    YOUTUBE_MUSIC_URL_DOMAIN,
    YOUTUBE_URL_DOMAIN
} from './constants';
import { SourceType } from './types';

/**
 * Validates the entered URL and extracts YouTube ID if applicable.
 *
 * @param {string} url - The entered URL.
 * @returns {string | null} The youtube video id if matched.
 */
function getYoutubeId(url: string): string | null {
    if (!url) {
        return null;
    }

    // eslint-disable-next-line max-len
    const p = /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|(?:m\.)?(?:music\.)?youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;
    const result = url.match(p);

    return result ? result[1] : null;
}

/**
 * Checks if the status is one that is actually sharing music - playing, pause or start.
 *
 * @param {string} status - The shared music status.
 * @returns {boolean}
 */
export function isSharingStatus(status: string): boolean {
    return [ PLAYBACK_STATUSES.PLAYING, PLAYBACK_STATUSES.PAUSED, PLAYBACK_START ].includes(status);
}

/**
 * Determines the source type of the given URL.
 *
 * @param {string} url - The URL to check.
 * @returns {SourceType} The source type.
 */
export function getSourceType(url: string): SourceType {
    const youtubeId = getYoutubeId(url);

    if (youtubeId) {
        return SOURCE_TYPES.YOUTUBE;
    }

    try {
        const urlObj = new URL(url);

        if (urlObj.hostname.includes(YOUTUBE_URL_DOMAIN)
            || urlObj.hostname.includes(YOUTUBE_MUSIC_URL_DOMAIN)) {
            return SOURCE_TYPES.YOUTUBE;
        }
    } catch (_) {
        // Not a valid URL
    }

    return SOURCE_TYPES.DIRECT;
}

/**
 * Extracts a YouTube ID or validates a direct URL.
 *
 * @param {string} input - The user input.
 * @returns {Object | undefined} An object with url and sourceType, or undefined.
 */
export function extractMusicUrl(input: string): { sourceType: SourceType; url: string; } | undefined {
    if (!input) {
        return;
    }

    const trimmedLink = input.trim();

    if (!trimmedLink) {
        return;
    }

    const youtubeId = getYoutubeId(trimmedLink);

    if (youtubeId) {
        return {
            url: youtubeId,
            sourceType: SOURCE_TYPES.YOUTUBE
        };
    }

    // Check if the URL is valid
    try {
        const urlObj = new URL(trimmedLink);

        // Check if it's a YouTube URL
        if (urlObj.hostname.includes(YOUTUBE_URL_DOMAIN)
            || urlObj.hostname.includes(YOUTUBE_MUSIC_URL_DOMAIN)) {
            const videoId = getYoutubeId(trimmedLink);

            if (videoId) {
                return {
                    url: videoId,
                    sourceType: SOURCE_TYPES.YOUTUBE
                };
            }
        }

        // It's a direct URL
        return {
            url: trimmedLink,
            sourceType: SOURCE_TYPES.DIRECT
        };
    } catch (_) {
        return;
    }
}

/**
 * Returns true if shared music functionality is enabled.
 *
 * @param {IStateful} stateful - The redux store or getState function.
 * @returns {boolean}
 */
export function isSharedMusicEnabled(stateful: IStateful): boolean {
    const state = toState(stateful);
    const { disableThirdPartyRequests = false } = state['features/base/config'];

    return !disableThirdPartyRequests;
}

/**
 * Returns true if music is currently playing.
 *
 * @param {IStateful} stateful - The redux store or getState function.
 * @returns {boolean}
 */
export function isMusicPlaying(stateful: IStateful): boolean {
    const state = toState(stateful);
    const { status } = state['features/shared-music'];

    return isSharingStatus(status ?? '');
}

/**
 * Sends SHARED_MUSIC command.
 *
 * @param {Object} options - The command options.
 * @param {string} options.id - The id of the music.
 * @param {string} options.status - The status of the shared music.
 * @param {IJitsiConference} options.conference - The current conference.
 * @param {string} options.localParticipantId - The id of the local participant.
 * @param {number} options.time - The seek position of the music.
 * @param {boolean} options.muted - Whether the music is muted.
 * @param {number} options.volume - The volume level.
 * @param {string} options.sourceType - The source type.
 * @param {string} options.title - The track title.
 * @returns {void}
 */
export function sendShareMusicCommand({ id, status, conference, localParticipantId = '', time, muted, volume,
    sourceType, title }: {
    conference?: IJitsiConference;
    id: string;
    localParticipantId?: string;
    muted?: boolean;
    sourceType?: string;
    status: string;
    time: number;
    title?: string;
    volume?: number;
}): void {
    conference?.sendCommandOnce(SHARED_MUSIC, {
        value: id,
        attributes: {
            from: localParticipantId,
            muted,
            sourceType,
            state: status,
            time,
            title,
            volume
        }
    });
}
