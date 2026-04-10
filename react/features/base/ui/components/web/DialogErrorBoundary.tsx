import { Component, ErrorInfo, ReactNode } from 'react';
import { connect } from 'react-redux';

import { IStore } from '../../../../app/types';
import logger from '../../../app/logger';
import { hideDialog } from '../../../dialog/actions';

interface IProps {

    /**
     * The child components.
     */
    children: ReactNode;

    /**
     * Redux dispatch function (injected by connect).
     */
    dispatch: IStore['dispatch'];
}

interface IState {

    /**
     * Whether a rendering error has been caught.
     */
    hasError: boolean;
}

/**
 * Error boundary that wraps DialogContainer to prevent dialog rendering
 * errors from crashing the entire application. Without this, an error in
 * any dialog (e.g., Settings) would unmount the Conference component, which
 * calls hangup() and disconnects the user from the meeting.
 */
class DialogErrorBoundary extends Component<IProps, IState> {

    /**
     * Initializes a new DialogErrorBoundary instance.
     *
     * @param {IProps} props - Component props.
     */
    constructor(props: IProps) {
        super(props);
        this.state = { hasError: false };
    }

    /**
     * React lifecycle method to derive state from an error.
     *
     * @param {Error} _error - The error that was thrown.
     * @returns {IState} New state.
     */
    static getDerivedStateFromError(_error: Error): IState {
        return { hasError: true };
    }

    /**
     * Logs the error and attempts to close the broken dialog.
     *
     * @param {Error} error - The error that was thrown.
     * @param {ErrorInfo} info - React error info with component stack.
     * @returns {void}
     */
    override componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error('Dialog rendering error caught by boundary', error, info);

        // Close the broken dialog so user can continue using the app
        this.props.dispatch(hideDialog('ErrorBoundary'));

        // Reset error state so the next dialog can render
        this.setState({ hasError: false });
    }

    /**
     * Renders children or nothing if there was an error.
     *
     * @returns {ReactNode}
     */
    override render() {
        if (this.state.hasError) {
            return null;
        }

        return this.props.children;
    }
}

export default connect()(DialogErrorBoundary);
