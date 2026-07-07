import React, { useCallback } from 'react';
import { useDispatch } from 'react-redux';

import { leaveConference } from '../../../base/conference/actions';
import Dialog from '../../../base/ui/components/web/Dialog';

const LeaveConfirmDialog = () => {
    const dispatch = useDispatch();

    const onSubmit = useCallback(() => {
        dispatch(leaveConference());
    }, [ dispatch ]);

    return (
        <Dialog
            ok = {{ translationKey: 'dialog.confirmYes' }}
            onSubmit = { onSubmit }
            size = 'medium'
            testId = 'dialog.leaveConfirm'
            titleKey = 'dialog.leaveTitle' />
    );
};

export default LeaveConfirmDialog;
