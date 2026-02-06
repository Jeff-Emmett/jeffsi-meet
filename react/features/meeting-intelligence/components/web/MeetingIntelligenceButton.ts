import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { translate } from '../../../base/i18n/functions';
import { IconMeter } from '../../../base/icons/svg';
import AbstractButton, { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import { toggleMeetingIntelligence } from '../../actions';
import { isDashboardOpen, isMeetingIntelligenceEnabled } from '../../functions';

interface IProps extends AbstractButtonProps {

    /**
     * Whether or not the dashboard is open.
     */
    _isDashboardOpen: boolean;
}

/**
 * Implements a button to open the Meeting Intelligence dashboard.
 */
class MeetingIntelligenceButton extends AbstractButton<IProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.meetingIntelligence';
    override toggledAccessibilityLabel = 'toolbar.accessibilityLabel.closeMeetingIntelligence';
    override icon = IconMeter;
    override label = 'toolbar.meetingIntelligence';
    override toggledLabel = 'toolbar.closeMeetingIntelligence';
    override tooltip = 'toolbar.meetingIntelligence';
    override toggledTooltip = 'toolbar.closeMeetingIntelligence';

    /**
     * Handles clicking / pressing the button.
     *
     * @private
     * @returns {void}
     */
    override _handleClick() {
        this.props.dispatch(toggleMeetingIntelligence());
    }

    /**
     * Indicates whether this button is in toggled state or not.
     *
     * @override
     * @protected
     * @returns {boolean}
     */
    override _isToggled() {
        return this.props._isDashboardOpen;
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
    return {
        _isDashboardOpen: isDashboardOpen(state),
        visible: isMeetingIntelligenceEnabled(state)
    };
}

export default translate(connect(_mapStateToProps)(MeetingIntelligenceButton));
