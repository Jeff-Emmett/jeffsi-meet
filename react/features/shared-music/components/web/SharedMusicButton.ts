import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { translate } from '../../../base/i18n/functions';
import { IconAudioOnly } from '../../../base/icons/svg';
import { getLocalParticipant } from '../../../base/participants/functions';
import AbstractButton, { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import { toggleSharedMusic } from '../../actions';
import { isSharingStatus } from '../../functions';

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
 * Implements a button to share music with all participants.
 */
class SharedMusicButton extends AbstractButton<IProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.sharedmusic';
    override toggledAccessibilityLabel = 'toolbar.accessibilityLabel.stopSharedMusic';
    override icon = IconAudioOnly;
    override label = 'toolbar.sharedmusic';
    override toggledLabel = 'toolbar.stopSharedMusic';
    override tooltip = 'toolbar.sharedmusic';
    override toggledTooltip = 'toolbar.stopSharedMusic';

    /**
     * Handles clicking / pressing the button, and opens a new dialog.
     *
     * @private
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
 * @private
 * @returns {IProps}
 */
function _mapStateToProps(state: IReduxState) {
    const { ownerId, status: sharedMusicStatus } = state['features/shared-music'];
    const localParticipantId = getLocalParticipant(state)?.id;
    const isSharing = isSharingStatus(sharedMusicStatus ?? '');

    return {
        _isDisabled: isSharing && ownerId !== localParticipantId,
        _sharingMusic: isSharing
    };
}

export default translate(connect(_mapStateToProps)(SharedMusicButton));
