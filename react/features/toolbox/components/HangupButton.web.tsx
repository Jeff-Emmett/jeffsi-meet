import { connect } from 'react-redux';

import { createToolbarEvent } from '../../analytics/AnalyticsEvents';
import { sendAnalytics } from '../../analytics/functions';
import { openDialog } from '../../base/dialog/actions';
import { translate } from '../../base/i18n/functions';
import { IProps as AbstractButtonProps } from '../../base/toolbox/components/AbstractButton';
import AbstractHangupButton from '../../base/toolbox/components/AbstractHangupButton';

import LeaveConfirmDialog from './web/LeaveConfirmDialog';

/**
 * Toolbar hangup button that opens a "Leave meeting?" confirm dialog instead of
 * leaving immediately. Confirm by clicking OK or pressing Enter.
 *
 * @augments AbstractHangupButton
 */
class HangupButton extends AbstractHangupButton<AbstractButtonProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.hangup';
    override label = 'toolbar.hangup';
    override tooltip = 'toolbar.hangup';

    override _doHangup() {
        sendAnalytics(createToolbarEvent('hangup'));
        this.props.dispatch(openDialog('LeaveConfirmDialog', LeaveConfirmDialog));
    }
}

export default translate(connect()(HangupButton));
