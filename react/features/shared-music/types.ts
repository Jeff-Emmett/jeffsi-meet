import { SOURCE_TYPES } from './constants';

/**
 * The source type for shared music.
 */
export type SourceType = typeof SOURCE_TYPES[keyof typeof SOURCE_TYPES];

/**
 * The shared music state interface.
 */
export interface ISharedMusicState {
    /**
     * The duration of the current music track.
     */
    duration?: number;

    /**
     * Whether the music player is minimized.
     */
    minimized: boolean;

    /**
     * The music URL being shared.
     */
    musicUrl?: string;

    /**
     * Whether the music is muted.
     */
    muted?: boolean;

    /**
     * The ID of the participant who owns/started the shared music.
     */
    ownerId?: string;

    /**
     * The type of the music source (youtube or direct).
     */
    sourceType?: SourceType;

    /**
     * The playback status (playing, paused, stopped).
     */
    status?: string;

    /**
     * The current playback time in seconds.
     */
    time?: number;

    /**
     * The title of the music track.
     */
    title?: string;

    /**
     * The volume level (0-100).
     */
    volume?: number;
}

/**
 * Music command attributes received from conference.
 */
export interface IMusicCommandAttributes {
    from: string;
    muted: string;
    sourceType: string;
    state: string;
    time: string;
    title?: string;
    volume?: string;
}
