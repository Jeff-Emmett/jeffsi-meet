import { throttle } from 'lodash-es';
import { PureComponent } from 'react';

import { IReduxState, IStore } from '../../../app/types';
import { getCurrentConference } from '../../../base/conference/functions';
import { IJitsiConference } from '../../../base/conference/reducer';
import { MEDIA_TYPE } from '../../../base/media/constants';
import { getLocalParticipant } from '../../../base/participants/functions';
import { isLocalTrackMuted } from '../../../base/tracks/functions';
import { showWarningNotification } from '../../../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../../../notifications/constants';
import { muteLocal } from '../../../video-menu/actions.any';
import { setSharedMusicStatus, stopSharedMusic } from '../../actions';
import { PLAYBACK_STATUSES } from '../../constants';
import logger from '../../logger';
import { SourceType } from '../../types';

/**
 * Return true if the difference between the two times is larger than 5.
 *
 * @param {number} newTime - The current time.
 * @param {number} previousTime - The previous time.
 * @private
 * @returns {boolean}
 */
function shouldSeekToPosition(newTime: number, previousTime: number) {
    return Math.abs(newTime - previousTime) > 5;
}

/**
 * The type of the React {@link PureComponent} props of {@link AbstractMusicManager}.
 */
export interface IProps {

    /**
     * The current conference.
     */
    _conference?: IJitsiConference;

    /**
     * Warning that indicates an incorrect music url.
     */
    _displayWarning: Function;

    /**
     * Indicates whether the local audio is muted.
     */
    _isLocalAudioMuted: boolean;

    /**
     * Is the music shared by the local user.
     */
    _isOwner: boolean;

    /**
     * The music URL.
     */
    _musicUrl?: string;

    /**
     * Mutes local audio track.
     */
    _muteLocal: Function;

    /**
     * Store flag for muted state.
     */
    _muted?: boolean;

    /**
     * The shared music owner id.
     */
    _ownerId?: string;

    /**
     * Updates the shared music status.
     */
    _setSharedMusicStatus: Function;

    /**
     * The source type (youtube or direct).
     */
    _sourceType?: SourceType;

    /**
     * The shared music status.
     */
    _status?: string;

    /**
     * Action to stop music sharing.
     */
    _stopSharedMusic: Function;

    /**
     * Seek time in seconds.
     */
    _time?: number;

    /**
     * The music id/url.
     */
    musicId: string;
}

/**
 * Manager of shared music.
 */
class AbstractMusicManager extends PureComponent<IProps> {
    throttledFireUpdateSharedMusicEvent: Function;

    /**
     * Initializes a new instance of AbstractMusicManager.
     *
     * @param {IProps} props - Component props.
     * @returns {void}
     */
    constructor(props: IProps) {
        super(props);

        this.throttledFireUpdateSharedMusicEvent = throttle(this.fireUpdateSharedMusicEvent.bind(this), 5000);
    }

    /**
     * Implements React Component's componentDidMount.
     *
     * @inheritdoc
     */
    override componentDidMount() {
        this.processUpdatedProps();
    }

    /**
     * Implements React Component's componentDidUpdate.
     *
     * @inheritdoc
     */
    override componentDidUpdate(_prevProps: IProps) {
        this.processUpdatedProps();
    }

    /**
     * Implements React Component's componentWillUnmount.
     *
     * @inheritdoc
     */
    override componentWillUnmount() {
        if (this.dispose) {
            this.dispose();
        }
    }

    /**
     * Processes new properties.
     *
     * @returns {void}
     */
    processUpdatedProps() {
        const { _status, _time, _isOwner, _muted } = this.props;

        if (_isOwner) {
            return;
        }

        const playerTime = this.getTime();

        if (shouldSeekToPosition(Number(_time), Number(playerTime))) {
            this.seek(Number(_time));
        }

        if (this.getPlaybackStatus() !== _status) {
            if (_status === PLAYBACK_STATUSES.PLAYING) {
                this.play();
            }

            if (_status === PLAYBACK_STATUSES.PAUSED) {
                this.pause();
            }
        }

        if (this.isMuted() !== _muted) {
            if (_muted) {
                this.mute();
            } else {
                this.unMute();
            }
        }
    }

    /**
     * Handle music error.
     *
     * @param {Object|undefined} e - The error returned by the API or none.
     * @returns {void}
     */
    onError(e?: any) {
        logger.error('Error in the music player', e?.data);
        this.props._stopSharedMusic();
        this.props._displayWarning();
    }

    /**
     * Handle music playing.
     *
     * @returns {void}
     */
    onPlay() {
        this.smartAudioMute();
        this.fireUpdateSharedMusicEvent();
    }

    /**
     * Handle music paused.
     *
     * @returns {void}
     */
    onPause() {
        this.fireUpdateSharedMusicEvent();
    }

    /**
     * Handle volume changed.
     *
     * @returns {void}
     */
    onVolumeChange() {
        const volume = this.getVolume();
        const muted = this.isMuted();

        if (Number(volume) > 0 && !muted) {
            this.smartAudioMute();
        }

        this.fireUpdatePlayingMusicEvent();
    }

    /**
     * Handle changes to the shared playing music.
     *
     * @returns {void}
     */
    fireUpdatePlayingMusicEvent() {
        if (this.getPlaybackStatus() === PLAYBACK_STATUSES.PLAYING) {
            this.fireUpdateSharedMusicEvent();
        }
    }

    /**
     * Dispatches an update action for the shared music.
     *
     * @returns {void}
     */
    fireUpdateSharedMusicEvent() {
        const { _isOwner } = this.props;

        if (!_isOwner) {
            return;
        }

        const status = this.getPlaybackStatus();

        if (!Object.values(PLAYBACK_STATUSES).includes(status ?? '')) {
            return;
        }

        const {
            _ownerId,
            _setSharedMusicStatus,
            _musicUrl,
            _sourceType
        } = this.props;

        _setSharedMusicStatus({
            musicUrl: _musicUrl,
            status,
            time: this.getTime(),
            ownerId: _ownerId,
            muted: this.isMuted(),
            sourceType: _sourceType
        });
    }

    /**
     * Indicates if the player volume is currently on. This will return true if
     * we have an available player, which is currently in a PLAYING state,
     * which isn't muted and has its volume greater than 0.
     *
     * @returns {boolean} Indicating if the volume of the shared music is
     * currently on.
     */
    isSharedMusicVolumeOn() {
        return this.getPlaybackStatus() === PLAYBACK_STATUSES.PLAYING
                && !this.isMuted()
                && Number(this.getVolume()) > 0;
    }

    /**
     * Smart mike mute. If the mike isn't currently muted and the shared music
     * volume is on we mute the mike.
     *
     * @returns {void}
     */
    smartAudioMute() {
        const { _isLocalAudioMuted, _muteLocal } = this.props;

        if (!_isLocalAudioMuted && this.isSharedMusicVolumeOn()) {
            _muteLocal(true);
        }
    }

    /**
     * Seeks music to provided time.
     *
     * @param {number} _time - Time to seek to.
     * @returns {void}
     */
    seek(_time: number) {
        // to be implemented by subclass
    }

    /**
     * Indicates the playback state of the music.
     *
     * @returns {string}
     */
    getPlaybackStatus(): string | undefined {
        return;
    }

    /**
     * Indicates whether the music is muted.
     *
     * @returns {boolean}
     */
    isMuted(): boolean | undefined {
        return;
    }

    /**
     * Retrieves current volume.
     *
     * @returns {number}
     */
    getVolume() {
        return 1;
    }

    /**
     * Plays music.
     *
     * @returns {void}
     */
    play() {
        // to be implemented by subclass
    }

    /**
     * Pauses music.
     *
     * @returns {void}
     */
    pause() {
        // to be implemented by subclass
    }

    /**
     * Mutes music.
     *
     * @returns {void}
     */
    mute() {
        // to be implemented by subclass
    }

    /**
     * Unmutes music.
     *
     * @returns {void}
     */
    unMute() {
        // to be implemented by subclass
    }

    /**
     * Retrieves current time.
     *
     * @returns {number}
     */
    getTime() {
        return 0;
    }

    /**
     * Disposes current music player.
     *
     * @returns {void}
     */
    dispose() {
        // to be implemented by subclass
    }
}


export default AbstractMusicManager;

/**
 * Maps part of the Redux store to the props of this component.
 *
 * @param {Object} state - The Redux state.
 * @returns {IProps}
 */
export function _mapStateToProps(state: IReduxState) {
    const { ownerId, status, time, musicUrl, muted, sourceType } = state['features/shared-music'];
    const localParticipant = getLocalParticipant(state);
    const _isLocalAudioMuted = isLocalTrackMuted(state['features/base/tracks'], MEDIA_TYPE.AUDIO);

    return {
        _conference: getCurrentConference(state),
        _isLocalAudioMuted,
        _isOwner: ownerId === localParticipant?.id,
        _muted: muted,
        _musicUrl: musicUrl,
        _ownerId: ownerId,
        _sourceType: sourceType,
        _status: status,
        _time: time
    };
}

/**
 * Maps part of the props of this component to Redux actions.
 *
 * @param {Function} dispatch - The Redux dispatch function.
 * @returns {IProps}
 */
export function _mapDispatchToProps(dispatch: IStore['dispatch']) {
    return {
        _displayWarning: () => {
            dispatch(showWarningNotification({
                titleKey: 'dialog.shareMusicLinkError'
            }, NOTIFICATION_TIMEOUT_TYPE.LONG));
        },
        _stopSharedMusic: () => {
            dispatch(stopSharedMusic());
        },
        _muteLocal: (value: boolean) => {
            dispatch(muteLocal(value, MEDIA_TYPE.AUDIO));
        },
        _setSharedMusicStatus: ({ musicUrl, status, time, ownerId, muted, sourceType }: any) => {
            dispatch(setSharedMusicStatus({
                musicUrl,
                status,
                time,
                ownerId,
                muted,
                sourceType
            }));
        }
    };
}
