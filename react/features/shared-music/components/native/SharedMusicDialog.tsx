import React, { Component } from 'react';
import { WithTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { IReduxState, IStore } from '../../../app/types';
import { hideDialog } from '../../../base/dialog/actions';
import InputDialog from '../../../base/dialog/components/native/InputDialog';
import { translate } from '../../../base/i18n/functions';
import { extractMusicUrl } from '../../functions';

interface IProps extends WithTranslation {

    /**
     * Invoked to update the shared music link.
     */
    dispatch: IStore['dispatch'];

    /**
     * Function to be invoked after typing a valid URL.
     */
    onPostSubmit: Function;
}

interface IState {
    error: boolean;
}

/**
 * Component that renders the music share dialog for native.
 */
class SharedMusicDialog extends Component<IProps, IState> {

    /**
     * Instantiates a new component.
     *
     * @inheritdoc
     */
    constructor(props: IProps) {
        super(props);

        this.state = {
            error: false
        };

        this._onSubmitValue = this._onSubmitValue.bind(this);
    }

    /**
     * Callback to be invoked when the value of the link input is submitted.
     *
     * @param {string} value - The entered music link.
     * @returns {boolean}
     */
    _onSubmitValue(value: string) {
        const { onPostSubmit, dispatch } = this.props;
        const extracted = extractMusicUrl(value);

        if (!extracted) {
            this.setState({ error: true });

            return false;
        }

        onPostSubmit(value);
        dispatch(hideDialog());

        return true;
    }

    /**
     * Implements React's {@link Component#render()}.
     *
     * @inheritdoc
     */
    override render() {
        const { t } = this.props;
        const { error } = this.state;

        return (
            <InputDialog
                messageKey = { error ? 'dialog.sharedMusicDialogError' : undefined }
                onSubmit = { this._onSubmitValue }
                textInputProps = {{
                    autoCapitalize: 'none',
                    autoCorrect: false,
                    placeholder: t('dialog.sharedMusicLinkPlaceholder')
                }}
                titleKey = 'dialog.shareMusicTitle' />
        );
    }
}

/**
 * Maps part of the Redux state to the props of this component.
 *
 * @param {Object} _state - The Redux state.
 * @private
 * @returns {Object}
 */
function mapStateToProps(_state: IReduxState) {
    return {};
}

export default translate(connect(mapStateToProps)(SharedMusicDialog));
