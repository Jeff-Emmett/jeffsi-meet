import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { translate } from '../../../base/i18n/functions';
import { IconAudioOnly } from '../../../base/icons/svg';
import { getLocalParticipant } from '../../../base/participants/functions';
import AbstractButton, { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import { toggleSharedMusic } from '../../actions';
import { isSharingStatus } from '../../functions';

/**
 * The type of the React {@code Component} props of {@link SharedMusicButton}.
 */
interface IProps extends AbstractButtonProps {

    /**
     * Whether or not the button is disabled.
     */
    _isDisabled: boolean;

    /**
     * Whether or not the local participant is sharing music.
     */
    _sharingMusic: boolean;
}

/**
 * Component that renders a toolbar button for sharing music.
 *
 * @augments AbstractButton
 */
class SharedMusicButton extends AbstractButton<IProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.sharedmusic';
    override icon = IconAudioOnly;
    override label = 'toolbar.sharedmusic';
    override toggledLabel = 'toolbar.stopSharedMusic';

    /**
     * Handles clicking / pressing the button.
     *
     * @override
     * @protected
     * @returns {void}
     */
    override _handleClick() {
        this._doToggleSharedMusic();
    }

    /**
     * Indicates whether this button is in toggled state or not.
     *
     * @override
     * @protected
     * @returns {boolean}
     */
    override _isToggled() {
        return this.props._sharingMusic;
    }

    /**
     * Indicates whether this button is disabled or not.
     *
     * @override
     * @protected
     * @returns {boolean}
     */
    override _isDisabled() {
        return this.props._isDisabled;
    }

    /**
     * Dispatches an action to toggle music sharing.
     *
     * @private
     * @returns {void}
     */
    _doToggleSharedMusic() {
        this.props.dispatch(toggleSharedMusic());
    }
}

/**
 * Maps part of the Redux state to the props of this component.
 *
 * @param {Object} state - The Redux state.
 * @param {Object} ownProps - The properties explicitly passed to the component instance.
 * @private
 * @returns {IProps}
 */
function _mapStateToProps(state: IReduxState, ownProps: any) {
    const { ownerId, status: sharedMusicStatus } = state['features/shared-music'];
    const localParticipantId = getLocalParticipant(state)?.id;
    const { visible = true } = ownProps;

    if (ownerId !== localParticipantId) {
        return {
            _isDisabled: isSharingStatus(sharedMusicStatus ?? ''),
            _sharingMusic: false,
            visible
        };
    }

    return {
        _isDisabled: false,
        _sharingMusic: isSharingStatus(sharedMusicStatus ?? ''),
        visible
    };
}

export default translate(connect(_mapStateToProps)(SharedMusicButton));
