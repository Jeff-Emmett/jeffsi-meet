import React from 'react';
import { connect } from 'react-redux';

import { PLAYBACK_STATUSES } from '../../constants';
import logger from '../../logger';

import AbstractMusicManager, {
    IProps,
    _mapDispatchToProps,
    _mapStateToProps
} from './AbstractMusicManager';


/**
 * Manager for direct audio URL playback using HTML5 audio element.
 */
class DirectAudioManager extends AbstractMusicManager {
    audioRef: React.RefObject<HTMLAudioElement>;
    _autoplayBlocked: boolean;

    /**
     * Initializes a new DirectAudioManager instance.
     *
     * @param {Object} props - This component's props.
     * @returns {void}
     */
    constructor(props: IProps) {
        super(props);

        this.audioRef = React.createRef();
        this._autoplayBlocked = false;
    }

    /**
     * Retrieves the current audio element ref.
     *
     * @returns {HTMLAudioElement | null}
     */
    get player() {
        return this.audioRef.current;
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

        if (this.player.paused) {
            status = PLAYBACK_STATUSES.PAUSED;
        } else {
            status = PLAYBACK_STATUSES.PLAYING;
        }

        return status;
    }

    /**
     * Indicates whether the music is muted.
     *
     * @returns {boolean}
     */
    override isMuted() {
        return this.player?.muted;
    }

    /**
     * Retrieves current volume.
     *
     * @returns {number}
     */
    override getVolume() {
        return Number(this.player?.volume);
    }

    /**
     * Retrieves current time.
     *
     * @returns {number}
     */
    override getTime() {
        return Number(this.player?.currentTime);
    }

    /**
     * Seeks music to provided time.
     *
     * @param {number} time - The time to seek to.
     * @returns {void}
     */
    override seek(time: number) {
        if (this.player) {
            this.player.currentTime = time;
        }
    }

    /**
     * Plays music. Handles autoplay restrictions on mobile browsers.
     *
     * @returns {Promise<void> | undefined}
     */
    override play() {
        const playPromise = this.player?.play();

        if (playPromise !== undefined) {
            playPromise.catch((error: Error) => {
                if (error.name === 'NotAllowedError') {
                    logger.warn('Autoplay blocked by browser. Music will play on user interaction.');
                    this._autoplayBlocked = true;

                    // Add a one-time click listener to resume playback
                    const resumePlayback = () => {
                        if (this._autoplayBlocked && this.player) {
                            this.player.play().catch(() => {
                                // Ignore if still blocked
                            });
                            this._autoplayBlocked = false;
                        }
                        document.removeEventListener('click', resumePlayback);
                        document.removeEventListener('touchstart', resumePlayback);
                    };

                    document.addEventListener('click', resumePlayback, { once: true });
                    document.addEventListener('touchstart', resumePlayback, { once: true });
                } else {
                    logger.error('Error playing music:', error);
                }
            });
        }

        return playPromise;
    }

    /**
     * Pauses music.
     *
     * @returns {void}
     */
    override pause() {
        return this.player?.pause();
    }

    /**
     * Mutes music.
     *
     * @returns {void}
     */
    override mute() {
        if (this.player) {
            this.player.muted = true;
        }
    }

    /**
     * Unmutes music.
     *
     * @returns {void}
     */
    override unMute() {
        if (this.player) {
            this.player.muted = false;
        }
    }

    /**
     * Retrieves audio element options.
     *
     * @returns {Object}
     */
    getPlayerOptions() {
        const { _isOwner, musicId } = this.props;

        let options: any = {
            autoPlay: true,
            src: musicId,
            controls: true,
            onError: () => this.onError(),
            onPlay: () => this.onPlay(),
            onVolumeChange: () => this.onVolumeChange()
        };

        if (_isOwner) {
            options = {
                ...options,
                onPause: () => this.onPause(),
                onTimeUpdate: this.throttledFireUpdateSharedMusicEvent
            };
        }

        return options;
    }

    /**
     * Implements React Component's render.
     *
     * @inheritdoc
     */
    override render() {
        return (
            <audio
                id = 'sharedMusicPlayer'
                ref = { this.audioRef }
                style = {{ width: '100%' }}
                { ...this.getPlayerOptions() } />
        );
    }
}

export default connect(_mapStateToProps, _mapDispatchToProps)(DirectAudioManager);
