import { IStateful } from '../base/app/types';
import { IJitsiConference } from '../base/conference/reducer';
import { toState } from '../base/redux/functions';

import {
    APPLE_MUSIC_URL_DOMAIN,
    BANDCAMP_URL_DOMAIN,
    DAILYMOTION_URL_DOMAIN,
    DEEZER_URL_DOMAIN,
    PLAYBACK_START,
    PLAYBACK_STATUSES,
    SHARED_MUSIC,
    SOUNDCLOUD_URL_DOMAIN,
    SOURCE_TYPES,
    SPOTIFY_URL_DOMAIN,
    TIDAL_URL_DOMAIN,
    TWITCH_URL_DOMAIN,
    VIMEO_URL_DOMAIN,
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
 * Extracts Vimeo video ID from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {string | null} The Vimeo video id if matched.
 */
function getVimeoId(url: string): string | null {
    if (!url) {
        return null;
    }

    // Matches vimeo.com/123456789 or player.vimeo.com/video/123456789
    const p = /(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/;
    const result = url.match(p);

    return result ? result[1] : null;
}

/**
 * Extracts Dailymotion video ID from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {string | null} The Dailymotion video id if matched.
 */
function getDailymotionId(url: string): string | null {
    if (!url) {
        return null;
    }

    // Matches dailymotion.com/video/x123abc or dai.ly/x123abc
    const p = /(?:https?:\/\/)?(?:www\.)?(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/;
    const result = url.match(p);

    return result ? result[1] : null;
}

/**
 * Extracts Twitch channel or video from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {Object|null} The Twitch info if matched.
 */
function getTwitchInfo(url: string): { id: string; type: string; } | null {
    if (!url) {
        return null;
    }

    // Matches twitch.tv/channel or twitch.tv/videos/123456
    const channelMatch = url.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)(?:\?|$)/);
    const videoMatch = url.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/videos\/(\d+)/);

    if (videoMatch) {
        return { type: 'video', id: videoMatch[1] };
    }

    if (channelMatch && channelMatch[1] !== 'videos') {
        return { type: 'channel', id: channelMatch[1] };
    }

    return null;
}

/**
 * Extracts Spotify track/album/playlist from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {Object|null} The Spotify info if matched.
 */
function getSpotifyInfo(url: string): { id: string; type: string; } | null {
    if (!url) {
        return null;
    }

    // Matches open.spotify.com/track/123, /album/123, /playlist/123
    const p = /(?:https?:\/\/)?open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/;
    const result = url.match(p);

    return result ? { type: result[1], id: result[2] } : null;
}

/**
 * Extracts Apple Music info from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {Object|null} The Apple Music info if matched.
 */
function getAppleMusicInfo(url: string): { id: string; path: string; } | null {
    if (!url) {
        return null;
    }

    // Matches music.apple.com/{country}/album/{name}/{id} or /playlist/{name}/{id}
    const p = /(?:https?:\/\/)?music\.apple\.com\/([a-z]{2})\/(album|playlist|song)\/([^/]+)\/([a-zA-Z0-9.]+)/;
    const result = url.match(p);

    if (result) {
        return { path: `${result[1]}/${result[2]}/${result[3]}/${result[4]}`, id: result[4] };
    }

    return null;
}

/**
 * Extracts Deezer info from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {Object|null} The Deezer info if matched.
 */
function getDeezerInfo(url: string): { id: string; type: string; } | null {
    if (!url) {
        return null;
    }

    // Matches deezer.com/{country}/track/123, /album/123, /playlist/123
    const p = /(?:https?:\/\/)?(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/;
    const result = url.match(p);

    return result ? { type: result[1], id: result[2] } : null;
}

/**
 * Extracts Tidal info from URL.
 *
 * @param {string} url - The entered URL.
 * @returns {Object|null} The Tidal info if matched.
 */
function getTidalInfo(url: string): { id: string; type: string; } | null {
    if (!url) {
        return null;
    }

    // Matches tidal.com/browse/track/123, /album/123, /playlist/{uuid}
    const p = /(?:https?:\/\/)?(?:www\.)?(?:listen\.)?tidal\.com\/(?:browse\/)?(track|album|playlist|mix)\/([a-zA-Z0-9-]+)/;
    const result = url.match(p);

    return result ? { type: result[1], id: result[2] } : null;
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
    if (getYoutubeId(url)) {
        return SOURCE_TYPES.YOUTUBE;
    }

    if (getVimeoId(url)) {
        return SOURCE_TYPES.VIMEO;
    }

    if (getDailymotionId(url)) {
        return SOURCE_TYPES.DAILYMOTION;
    }

    if (getTwitchInfo(url)) {
        return SOURCE_TYPES.TWITCH;
    }

    if (getSpotifyInfo(url)) {
        return SOURCE_TYPES.SPOTIFY;
    }

    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        if (hostname.includes(YOUTUBE_URL_DOMAIN)
            || hostname.includes(YOUTUBE_MUSIC_URL_DOMAIN)) {
            return SOURCE_TYPES.YOUTUBE;
        }

        if (hostname.includes(VIMEO_URL_DOMAIN)) {
            return SOURCE_TYPES.VIMEO;
        }

        if (hostname.includes(SOUNDCLOUD_URL_DOMAIN)) {
            return SOURCE_TYPES.SOUNDCLOUD;
        }

        if (hostname.includes(SPOTIFY_URL_DOMAIN)) {
            return SOURCE_TYPES.SPOTIFY;
        }

        if (hostname.includes(DAILYMOTION_URL_DOMAIN)) {
            return SOURCE_TYPES.DAILYMOTION;
        }

        if (hostname.includes(TWITCH_URL_DOMAIN)) {
            return SOURCE_TYPES.TWITCH;
        }

        if (hostname.includes(APPLE_MUSIC_URL_DOMAIN)) {
            return SOURCE_TYPES.APPLE_MUSIC;
        }

        if (hostname.includes(DEEZER_URL_DOMAIN)) {
            return SOURCE_TYPES.DEEZER;
        }

        if (hostname.includes(TIDAL_URL_DOMAIN)) {
            return SOURCE_TYPES.TIDAL;
        }

        if (hostname.includes(BANDCAMP_URL_DOMAIN)) {
            return SOURCE_TYPES.BANDCAMP;
        }
    } catch (_) {
        // Not a valid URL
    }

    return SOURCE_TYPES.DIRECT;
}

/**
 * Extracts media info from URL based on the source type.
 *
 * @param {string} input - The user input.
 * @returns {Object | undefined} An object with url, sourceType, and optional embedInfo.
 */
export function extractMusicUrl(input: string): {
    embedInfo?: { id: string; type?: string; };
    sourceType: SourceType;
    url: string;
} | undefined {
    if (!input) {
        return;
    }

    const trimmedLink = input.trim();

    if (!trimmedLink) {
        return;
    }

    // YouTube
    const youtubeId = getYoutubeId(trimmedLink);

    if (youtubeId) {
        return {
            url: youtubeId,
            sourceType: SOURCE_TYPES.YOUTUBE,
            embedInfo: { id: youtubeId }
        };
    }

    // Vimeo
    const vimeoId = getVimeoId(trimmedLink);

    if (vimeoId) {
        return {
            url: trimmedLink,
            sourceType: SOURCE_TYPES.VIMEO,
            embedInfo: { id: vimeoId }
        };
    }

    // Dailymotion
    const dailymotionId = getDailymotionId(trimmedLink);

    if (dailymotionId) {
        return {
            url: trimmedLink,
            sourceType: SOURCE_TYPES.DAILYMOTION,
            embedInfo: { id: dailymotionId }
        };
    }

    // Twitch
    const twitchInfo = getTwitchInfo(trimmedLink);

    if (twitchInfo) {
        return {
            url: trimmedLink,
            sourceType: SOURCE_TYPES.TWITCH,
            embedInfo: twitchInfo
        };
    }

    // Spotify
    const spotifyInfo = getSpotifyInfo(trimmedLink);

    if (spotifyInfo) {
        return {
            url: trimmedLink,
            sourceType: SOURCE_TYPES.SPOTIFY,
            embedInfo: spotifyInfo
        };
    }

    // Check if the URL is valid for other sources
    try {
        const urlObj = new URL(trimmedLink);
        const hostname = urlObj.hostname.toLowerCase();

        // SoundCloud - we use the full URL for embedding
        if (hostname.includes(SOUNDCLOUD_URL_DOMAIN)) {
            return {
                url: trimmedLink,
                sourceType: SOURCE_TYPES.SOUNDCLOUD
            };
        }

        // Apple Music
        const appleMusicInfo = getAppleMusicInfo(trimmedLink);

        if (appleMusicInfo) {
            return {
                url: trimmedLink,
                sourceType: SOURCE_TYPES.APPLE_MUSIC,
                embedInfo: { id: appleMusicInfo.id, type: appleMusicInfo.path }
            };
        }

        // Deezer
        const deezerInfo = getDeezerInfo(trimmedLink);

        if (deezerInfo) {
            return {
                url: trimmedLink,
                sourceType: SOURCE_TYPES.DEEZER,
                embedInfo: deezerInfo
            };
        }

        // Tidal
        const tidalInfo = getTidalInfo(trimmedLink);

        if (tidalInfo) {
            return {
                url: trimmedLink,
                sourceType: SOURCE_TYPES.TIDAL,
                embedInfo: tidalInfo
            };
        }

        // Bandcamp - use full URL for embedding
        if (hostname.includes(BANDCAMP_URL_DOMAIN)) {
            return {
                url: trimmedLink,
                sourceType: SOURCE_TYPES.BANDCAMP
            };
        }

        // It's a direct URL (audio/video file)
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
