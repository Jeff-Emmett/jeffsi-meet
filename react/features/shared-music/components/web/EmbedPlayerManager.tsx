import React from 'react';
import { connect } from 'react-redux';

import { PLAYBACK_STATUSES, SOURCE_TYPES } from '../../constants';

import AbstractMusicManager, {
    IProps,
    _mapDispatchToProps,
    _mapStateToProps
} from './AbstractMusicManager';


/**
 * Generates the embed URL for various platforms.
 *
 * @param {string} url - The original URL.
 * @param {string} sourceType - The source type.
 * @returns {string} The embed URL.
 */
function getEmbedUrl(url: string, sourceType: string): string {
    switch (sourceType) {
    case SOURCE_TYPES.VIMEO: {
        // Extract Vimeo ID and create embed URL
        const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);

        if (vimeoMatch) {
            return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&autopause=0`;
        }

        return url;
    }
    case SOURCE_TYPES.SOUNDCLOUD: {
        // SoundCloud requires URL encoding
        const encodedUrl = encodeURIComponent(url);

        return `https://w.soundcloud.com/player/?url=${encodedUrl}&auto_play=true&visual=true`;
    }
    case SOURCE_TYPES.SPOTIFY: {
        // Extract Spotify type and ID
        const spotifyMatch = url.match(/spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);

        if (spotifyMatch) {
            return `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}?utm_source=generator&theme=0`;
        }

        return url;
    }
    case SOURCE_TYPES.DAILYMOTION: {
        // Extract Dailymotion ID
        const dmMatch = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/);

        if (dmMatch) {
            return `https://www.dailymotion.com/embed/video/${dmMatch[1]}?autoplay=1`;
        }

        return url;
    }
    case SOURCE_TYPES.TWITCH: {
        const parent = window.location.hostname;

        // Check for video or channel
        const videoMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
        const channelMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)(?:\?|$)/);

        if (videoMatch) {
            return `https://player.twitch.tv/?video=v${videoMatch[1]}&parent=${parent}&autoplay=true`;
        }

        if (channelMatch && channelMatch[1] !== 'videos') {
            return `https://player.twitch.tv/?channel=${channelMatch[1]}&parent=${parent}&autoplay=true`;
        }

        return url;
    }
    default:
        return url;
    }
}

/**
 * Manager for embedded media players (Vimeo, SoundCloud, Spotify, Dailymotion, Twitch).
 * Uses iframe embeds for playback.
 */
class EmbedPlayerManager extends AbstractMusicManager {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    _isPlaying: boolean;
    _isMuted: boolean;
    _currentTime: number;

    /**
     * Initializes a new EmbedPlayerManager instance.
     *
     * @param {Object} props - This component's props.
     * @returns {void}
     */
    constructor(props: IProps) {
        super(props);

        this.iframeRef = React.createRef();
        this._isPlaying = true; // Assume playing since autoplay is enabled
        this._isMuted = false;
        this._currentTime = 0;
    }

    /**
     * Indicates the playback state of the music.
     * Note: Most embed players don't provide reliable state feedback.
     *
     * @returns {string}
     */
    override getPlaybackStatus() {
        return this._isPlaying ? PLAYBACK_STATUSES.PLAYING : PLAYBACK_STATUSES.PAUSED;
    }

    /**
     * Indicates whether the music is muted.
     *
     * @returns {boolean}
     */
    override isMuted() {
        return this._isMuted;
    }

    /**
     * Retrieves current volume.
     *
     * @returns {number}
     */
    override getVolume() {
        return this._isMuted ? 0 : 1;
    }

    /**
     * Retrieves current time.
     * Note: Embedded players don't provide time reliably.
     *
     * @returns {number}
     */
    override getTime() {
        return this._currentTime;
    }

    /**
     * Seeks music to provided time.
     * Note: Most embedded players don't support external seek control.
     *
     * @param {number} time - The time to seek to.
     * @returns {void}
     */
    override seek(time: number) {
        this._currentTime = time;
    }

    /**
     * Plays music.
     * Note: Embedded players are controlled by user interaction within the iframe.
     *
     * @returns {void}
     */
    override play() {
        this._isPlaying = true;
    }

    /**
     * Pauses music.
     * Note: Embedded players are controlled by user interaction within the iframe.
     *
     * @returns {void}
     */
    override pause() {
        this._isPlaying = false;
    }

    /**
     * Mutes music.
     *
     * @returns {void}
     */
    override mute() {
        this._isMuted = true;
    }

    /**
     * Unmutes music.
     *
     * @returns {void}
     */
    override unMute() {
        this._isMuted = false;
    }

    /**
     * Implements React Component's render.
     *
     * @inheritdoc
     */
    override render() {
        const { musicId, _sourceType } = this.props;
        const embedUrl = getEmbedUrl(musicId, _sourceType ?? '');

        return (
            <div className = 'embed-player-container'>
                <iframe
                    allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
                    allowFullScreen = { true }
                    frameBorder = '0'
                    height = '100%'
                    id = 'sharedMusicPlayer'
                    ref = { this.iframeRef }
                    src = { embedUrl }
                    title = 'Shared Media Player'
                    width = '100%' />
            </div>
        );
    }
}

export default connect(_mapStateToProps, _mapDispatchToProps)(EmbedPlayerManager);
