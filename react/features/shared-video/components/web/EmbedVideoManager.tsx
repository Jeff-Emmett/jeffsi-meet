import React from 'react';
import { connect } from 'react-redux';

import { PLAYBACK_STATUSES } from '../../constants';
import { getVideoEmbedUrl } from '../../functions';

import AbstractVideoManager, {
    IProps as IBaseProps,
    _mapDispatchToProps,
    _mapStateToProps
} from './AbstractVideoManager';

interface IProps extends IBaseProps {

    /**
     * The video source type (vimeo, dailymotion, twitch).
     */
    sourceType: string;
}

/**
 * Manager for embedded video players (Vimeo, Dailymotion, Twitch).
 * Uses iframe embeds for playback.
 */
class EmbedVideoManager extends AbstractVideoManager {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    _isPlaying: boolean;
    _isMuted: boolean;
    _currentTime: number;

    /**
     * Initializes a new EmbedVideoManager instance.
     *
     * @param {Object} props - This component's props.
     * @returns {void}
     */
    constructor(props: IProps) {
        super(props);

        this.iframeRef = React.createRef();
        this._isPlaying = true;
        this._isMuted = false;
        this._currentTime = 0;
    }

    /**
     * Indicates the playback state of the video.
     *
     * @returns {string}
     */
    override getPlaybackStatus() {
        return this._isPlaying ? PLAYBACK_STATUSES.PLAYING : PLAYBACK_STATUSES.PAUSED;
    }

    /**
     * Indicates whether the video is muted.
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
     *
     * @returns {number}
     */
    override getTime() {
        return this._currentTime;
    }

    /**
     * Seeks video to provided time.
     *
     * @param {number} time - The time to seek to.
     * @returns {void}
     */
    override seek(time: number) {
        this._currentTime = time;
    }

    /**
     * Plays video.
     *
     * @returns {void}
     */
    override play() {
        this._isPlaying = true;
    }

    /**
     * Pauses video.
     *
     * @returns {void}
     */
    override pause() {
        this._isPlaying = false;
    }

    /**
     * Mutes video.
     *
     * @returns {void}
     */
    override mute() {
        this._isMuted = true;
    }

    /**
     * Unmutes video.
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
        const { videoId } = this.props;
        const sourceType = (this.props as IProps).sourceType;
        const embedUrl = getVideoEmbedUrl(videoId, sourceType);

        return (
            <div
                style = {{
                    width: '100%',
                    height: '100%'
                }}>
                <iframe
                    allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
                    allowFullScreen = { true }
                    frameBorder = '0'
                    height = '100%'
                    id = 'sharedVideoPlayer'
                    ref = { this.iframeRef }
                    src = { embedUrl }
                    title = 'Shared Video Player'
                    width = '100%' />
            </div>
        );
    }
}

// @ts-ignore - EmbedVideoManager has extra sourceType prop not in AbstractVideoManager's mapStateToProps
export default connect(_mapStateToProps, _mapDispatchToProps)(EmbedVideoManager);
