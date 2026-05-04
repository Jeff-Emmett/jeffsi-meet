import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import Button from '../../../../../base/ui/components/web/Button';
import { BUTTON_TYPES } from '../../../../../base/ui/constants.web';
import { shuffleBreakoutRooms } from '../../../../../breakout-rooms/actions';

interface IProps {
    className?: string;
}

export const ShuffleButton = ({ className }: IProps) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const onClick = useCallback(() => {
        dispatch(shuffleBreakoutRooms());
    }, [ dispatch ]);

    return (
        <Button
            accessibilityLabel = { t('breakoutRooms.actions.shuffle') }
            className = { className }
            fullWidth = { true }
            labelKey = { 'breakoutRooms.actions.shuffle' }
            onClick = { onClick }
            type = { BUTTON_TYPES.TERTIARY } />
    );
};
