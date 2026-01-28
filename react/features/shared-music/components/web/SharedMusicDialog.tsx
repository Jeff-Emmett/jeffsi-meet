import React, { Component } from 'react';
import { WithTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { IReduxState, IStore } from '../../../app/types';
import { hideDialog } from '../../../base/dialog/actions';
import { translate } from '../../../base/i18n/functions';
import Dialog from '../../../base/ui/components/web/Dialog';
import Input from '../../../base/ui/components/web/Input';
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
    okDisabled: boolean;
    value: string;
}

/**
 * Component that renders the music share dialog.
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
            value: '',
            okDisabled: true,
            error: false
        };

        this._onChange = this._onChange.bind(this);
        this._onSubmitValue = this._onSubmitValue.bind(this);
    }

    /**
     * Callback for the onChange event of the field.
     *
     * @param {string} value - The input value.
     * @returns {void}
     */
    _onChange(value: string) {
        this.setState({
            value,
            okDisabled: !value,
            error: false
        });
    }

    /**
     * Validates and submits the music link.
     *
     * @returns {boolean}
     */
    _onSubmitValue() {
        const { onPostSubmit, dispatch } = this.props;
        const extracted = extractMusicUrl(this.state.value);

        if (!extracted) {
            this.setState({ error: true });

            return false;
        }

        onPostSubmit(this.state.value);
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
            <Dialog
                disableAutoHideOnSubmit = { true }
                ok = {{
                    disabled: this.state.okDisabled,
                    translationKey: 'dialog.Share'
                }}
                onSubmit = { this._onSubmitValue }
                titleKey = 'dialog.shareMusicTitle'>
                <Input
                    autoFocus = { true }
                    bottomLabel = { error ? t('dialog.sharedMusicDialogError') : undefined }
                    className = 'dialog-bottom-margin'
                    error = { error }
                    id = 'shared-music-url-input'
                    label = { t('dialog.musicLink') }
                    name = 'sharedMusicUrl'
                    onChange = { this._onChange }
                    placeholder = { t('dialog.sharedMusicLinkPlaceholder') }
                    type = 'text'
                    value = { this.state.value } />
            </Dialog>
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
