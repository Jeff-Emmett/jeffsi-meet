import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import Button from '../../../../../base/ui/components/web/Button';
import { BUTTON_TYPES } from '../../../../../base/ui/constants.web';
import { requestBreakoutHelp } from '../../../../../breakout-rooms/actions';

interface IProps {
    className?: string;
}

export const AskForHelpButton = ({ className }: IProps) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const onClick = useCallback(() => {
        dispatch(requestBreakoutHelp());
    }, [ dispatch ]);

    return (
        <Button
            accessibilityLabel = { t('breakoutRooms.actions.askForHelp') }
            className = { className }
            fullWidth = { true }
            labelKey = { 'breakoutRooms.actions.askForHelp' }
            onClick = { onClick }
            type = { BUTTON_TYPES.SECONDARY } />
    );
};
