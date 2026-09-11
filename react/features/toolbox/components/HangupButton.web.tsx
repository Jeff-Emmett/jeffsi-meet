import { connect } from 'react-redux';

import { createToolbarEvent } from '../../analytics/AnalyticsEvents';
import { sendAnalytics } from '../../analytics/functions';
import { leaveConference } from '../../base/conference/actions';
import { translate } from '../../base/i18n/functions';
import { IProps as AbstractButtonProps } from '../../base/toolbox/components/AbstractButton';
import AbstractHangupButton from '../../base/toolbox/components/AbstractHangupButton';

/**
 * Toolbar hangup button. Leaves the conference immediately — the end-call
 * button is itself the confirmation. This fork previously routed through a
 * "Leave meeting?" confirm dialog, which made hanging up a two-tap action on
 * mobile for no benefit, since rejoining is a single tap.
 *
 * @augments AbstractHangupButton
 */
class HangupButton extends AbstractHangupButton<AbstractButtonProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.hangup';
    override label = 'toolbar.hangup';
    override tooltip = 'toolbar.hangup';

    override _doHangup() {
        sendAnalytics(createToolbarEvent('hangup'));
        this.props.dispatch(leaveConference());
    }
}

export default translate(connect()(HangupButton));
