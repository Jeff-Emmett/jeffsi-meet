/**
 * Fixed name of the music player fake participant.
 *
 * @type {string}
 */
export const MUSIC_PLAYER_PARTICIPANT_NAME = 'Music';

/**
 * Shared music command.
 *
 * @type {string}
 */
export const SHARED_MUSIC = 'shared-music';

/**
 * Available playback statuses.
 */
export const PLAYBACK_STATUSES = {
    PLAYING: 'playing',
    PAUSED: 'pause',
    STOPPED: 'stop'
};

/**
 * Playback start state.
 */
export const PLAYBACK_START = 'start';

/**
 * Source types for shared music.
 */
export const SOURCE_TYPES = {
    YOUTUBE: 'youtube',
    DIRECT: 'direct'
} as const;

/**
 * The domain for youtube URLs.
 */
export const YOUTUBE_URL_DOMAIN = 'youtube.com';

/**
 * YouTube Music domain.
 */
export const YOUTUBE_MUSIC_URL_DOMAIN = 'music.youtube.com';
