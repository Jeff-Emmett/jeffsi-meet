/* eslint-disable no-invalid-this */
import React from 'react';
import { connect } from 'react-redux';
import YouTube from 'react-youtube';

import { PLAYBACK_STATUSES } from '../../constants';

import AbstractMusicManager, {
    IProps,
    _mapDispatchToProps,
    _mapStateToProps
} from './AbstractMusicManager';

/**
 * Manager for YouTube music playback.
 * Uses react-youtube but renders the video hidden since we only need audio.
 */
class YouTubeMusicManager extends AbstractMusicManager {
    isPlayerAPILoaded: boolean;
    player?: any;

    /**
     * Initializes a new YouTubeMusicManager instance.
     *
     * @param {Object} props - This component's props.
     * @returns {void}
     */
    constructor(props: IProps) {
        super(props);

        this.isPlayerAPILoaded = false;
    }

    /**
     * Indicates the playback state of the music.
     *
     * @returns {string}
     */
    override getPlaybackStatus() {
        let status;

        if (!this.player) {
            return;
        }

        const playerState = this.player.getPlayerState();

        if (playerState === YouTube.PlayerState.PLAYING) {
            status = PLAYBACK_STATUSES.PLAYING;
        }

        if (playerState === YouTube.PlayerState.PAUSED) {
            status = PLAYBACK_STATUSES.PAUSED;
        }

        return status;
    }

    /**
     * Indicates whether the music is muted.
     *
     * @returns {boolean}
     */
    override isMuted() {
        return this.player?.isMuted();
    }

    /**
     * Retrieves current volume.
     *
     * @returns {number}
     */
    override getVolume() {
        return this.player?.getVolume();
    }

    /**
     * Retrieves current time.
     *
     * @returns {number}
     */
    override getTime() {
        return this.player?.getCurrentTime();
    }

    /**
     * Seeks music to provided time.
     *
     * @param {number} time - The time to seek to.
     * @returns {void}
     */
    override seek(time: number) {
        return this.player?.seekTo(time);
    }

    /**
     * Plays music.
     *
     * @returns {void}
     */
    override play() {
        return this.player?.playVideo();
    }

    /**
     * Pauses music.
     *
     * @returns {void}
     */
    override pause() {
        return this.player?.pauseVideo();
    }

    /**
     * Mutes music.
     *
     * @returns {void}
     */
    override mute() {
        return this.player?.mute();
    }

    /**
     * Unmutes music.
     *
     * @returns {void}
     */
    override unMute() {
        return this.player?.unMute();
    }

    /**
     * Disposes of the current music player.
     *
     * @returns {void}
     */
    override dispose() {
        if (this.player) {
            this.player.destroy();
            this.player = null;
        }
    }

    /**
     * Fired on play state toggle.
     *
     * @param {Object} event - The yt player stateChange event.
     * @returns {void}
     */
    onPlayerStateChange = (event: any) => {
        if (event.data === YouTube.PlayerState.PLAYING) {
            this.onPlay();
        } else if (event.data === YouTube.PlayerState.PAUSED) {
            this.onPause();
        }
    };

    /**
     * Fired when youtube player is ready.
     *
     * @param {Object} event - The youtube player event.
     * @returns {void}
     */
    onPlayerReady = (event: any) => {
        const { _isOwner } = this.props;

        this.player = event.target;

        this.player.addEventListener('onVolumeChange', () => {
            this.onVolumeChange();
        });

        if (_isOwner) {
            this.player.addEventListener('onVideoProgress', this.throttledFireUpdateSharedMusicEvent);
        }

        this.play();

        // Sometimes youtube can get muted state from previous videos
        if (this.isMuted()) {
            this.unMute();
        }
    };

    /**
     * Returns player options for YouTube.
     *
     * @returns {Object}
     */
    getPlayerOptions = () => {
        const { _isOwner, musicId } = this.props;
        const showControls = _isOwner ? 1 : 0;

        const options = {
            id: 'sharedMusicPlayer',
            opts: {
                height: '1',
                width: '1',
                playerVars: {
                    'origin': location.origin,
                    'fs': '0',
                    'autoplay': 0,
                    'controls': showControls,
                    'rel': 0
                }
            },
            onError: (e: any) => this.onError(e),
            onReady: this.onPlayerReady,
            onStateChange: this.onPlayerStateChange,
            videoId: musicId
        };

        return options;
    };

    /**
     * Implements React Component's render.
     *
     * @inheritdoc
     */
    override render() {
        // Render the YouTube player hidden (offscreen) since we only need audio
        return (
            <div className = 'okhide'>
                <YouTube
                    { ...this.getPlayerOptions() } />
            </div>
        );
    }
}

export default connect(_mapStateToProps, _mapDispatchToProps)(YouTubeMusicManager);
