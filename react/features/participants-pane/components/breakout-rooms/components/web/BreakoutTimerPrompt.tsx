import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import Dialog from '../../../../../base/ui/components/web/Dialog';
import Input from '../../../../../base/ui/components/web/Input';
import { setBreakoutTimer } from '../../../../../breakout-rooms/actions';

export default function BreakoutTimerPrompt() {
    const [ minutes, setMinutes ] = useState('5');
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const parsed = Number(minutes);
    const okDisabled = !Number.isFinite(parsed) || parsed <= 0;

    const onSubmit = useCallback(() => {
        dispatch(setBreakoutTimer(Math.round(parsed * 60_000)));
    }, [ dispatch, parsed ]);

    return (<Dialog
        ok = {{
            disabled: okDisabled,
            translationKey: 'breakoutRooms.actions.startTimer'
        }}
        onSubmit = { onSubmit }
        titleKey = 'breakoutRooms.actions.startTimer'>
        <Input
            autoFocus = { true }
            id = 'breakout-timer-minutes-input'
            label = { t('breakoutRooms.actions.timerDurationMinutes') }
            name = 'breakoutTimerMinutes'
            onChange = { setMinutes }
            type = 'number'
            value = { minutes } />
    </Dialog>);
}
