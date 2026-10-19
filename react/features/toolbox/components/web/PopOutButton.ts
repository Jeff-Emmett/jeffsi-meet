import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { translate } from '../../../base/i18n/functions';
import { IconPopOut } from '../../../base/icons/svg';
import AbstractButton, { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import { exitDocumentPiP, exitPiP, handleWindowBlur } from '../../../pip/actions';
import { shouldShowPiP } from '../../../pip/functions';
import { closeOverflowMenuIfOpen } from '../../actions.web';

interface IProps extends AbstractButtonProps {

    /**
     * Whether the call is popped out (Document PiP window or video PiP).
     */
    _poppedOut?: boolean;
}

/**
 * Pops the call out into a floating window that stays on screen when you switch
 * apps or tabs.
 *
 * Why a button: phones do not reliably pop a web call out on their own when the
 * user leaves the browser (that is the browser's decision, and Android Chrome
 * mostly declines), but every mobile browser that has PiP allows it from a tap.
 * Desktop gets the Document PiP window with call controls; elsewhere the plain
 * video PiP. Tapping again returns the call to the page.
 */
class PopOutButton extends AbstractButton<IProps> {
    override accessibilityLabel = 'toolbar.accessibilityLabel.popOut';
    override toggledAccessibilityLabel = 'toolbar.accessibilityLabel.popIn';
    override label = 'toolbar.popOut';
    override toggledLabel = 'toolbar.popIn';
    override tooltip = 'toolbar.popOut';
    override toggledTooltip = 'toolbar.popIn';
    override icon = IconPopOut;

    /**
     * Indicates whether this button is in toggled state or not.
     *
     * @override
     * @protected
     * @returns {boolean}
     */
    override _isToggled() {
        return this.props._poppedOut;
    }

    /**
     * Pops the call out, or back in. Runs inside the tap, so the browser sees
     * the user gesture PiP requires.
     *
     * @private
     * @returns {void}
     */
    override _handleClick() {
        const { dispatch, _poppedOut } = this.props;

        dispatch(closeOverflowMenuIfOpen());
        if (_poppedOut) {
            dispatch(exitDocumentPiP());
            dispatch(exitPiP());

            return;
        }

        const video = document.getElementById('pipVideo') as HTMLVideoElement | null;

        if (video) {
            dispatch(handleWindowBlur(video));
        }
    }
}

/**
 * Function that maps parts of Redux state tree into component props.
 *
 * @param {Object} state - Redux state.
 * @returns {Object}
 */
const mapStateToProps = (state: IReduxState) => {
    const pip = state['features/pip'];

    return {
        _poppedOut: Boolean(pip?.isPiPActive || pip?.isDocumentPiPActive),

        // The hidden PiP video element only exists where PiP can run.
        visible: shouldShowPiP(state)
    };
};

export default translate(connect(mapStateToProps)(PopOutButton));
