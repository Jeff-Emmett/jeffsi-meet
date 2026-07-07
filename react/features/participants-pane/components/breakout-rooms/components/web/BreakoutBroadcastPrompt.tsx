import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import Dialog from '../../../../../base/ui/components/web/Dialog';
import Input from '../../../../../base/ui/components/web/Input';
import { broadcastToBreakoutRooms } from '../../../../../breakout-rooms/actions';

export default function BreakoutBroadcastPrompt() {
    const [ message, setMessage ] = useState('');
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const okDisabled = !message.trim();

    const onSubmit = useCallback(() => {
        dispatch(broadcastToBreakoutRooms(message.trim()));
    }, [ dispatch, message ]);

    return (<Dialog
        ok = {{
            disabled: okDisabled,
            translationKey: 'breakoutRooms.actions.broadcastSend'
        }}
        onSubmit = { onSubmit }
        titleKey = 'breakoutRooms.actions.broadcast'>
        <Input
            autoFocus = { true }
            id = 'breakout-broadcast-input'
            label = { t('breakoutRooms.actions.broadcastPlaceholder') }
            name = 'breakoutBroadcastMessage'
            onChange = { setMessage }
            type = 'text'
            value = { message } />
    </Dialog>);
}
