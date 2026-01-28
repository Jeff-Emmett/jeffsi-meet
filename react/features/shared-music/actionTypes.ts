/**
 * The type of the action which signals to update the current known state of the
 * shared music.
 *
 * {
 *     type: SET_SHARED_MUSIC_STATUS,
 *     status: string
 * }
 */
export const SET_SHARED_MUSIC_STATUS = 'SET_SHARED_MUSIC_STATUS';

/**
 * The type of the action which signals to reset the current known state of the
 * shared music.
 *
 * {
 *     type: RESET_SHARED_MUSIC_STATUS,
 * }
 */
export const RESET_SHARED_MUSIC_STATUS = 'RESET_SHARED_MUSIC_STATUS';

/**
 * The type of the action which toggles the minimized state of the music player.
 *
 * {
 *     type: SET_SHARED_MUSIC_MINIMIZED,
 *     minimized: boolean
 * }
 */
export const SET_SHARED_MUSIC_MINIMIZED = 'SET_SHARED_MUSIC_MINIMIZED';
