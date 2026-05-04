import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import { openDialog } from '../../../../../base/dialog/actions';
import Button from '../../../../../base/ui/components/web/Button';
import { BUTTON_TYPES } from '../../../../../base/ui/constants.web';

import BreakoutBroadcastPrompt from './BreakoutBroadcastPrompt';

interface IProps {
    className?: string;
}

export const BroadcastButton = ({ className }: IProps) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const onClick = useCallback(() => {
        dispatch(openDialog('BreakoutBroadcastPrompt', BreakoutBroadcastPrompt));
    }, [ dispatch ]);

    return (
        <Button
            accessibilityLabel = { t('breakoutRooms.actions.broadcast') }
            className = { className }
            fullWidth = { true }
            labelKey = { 'breakoutRooms.actions.broadcast' }
            onClick = { onClick }
            type = { BUTTON_TYPES.TERTIARY } />
    );
};
