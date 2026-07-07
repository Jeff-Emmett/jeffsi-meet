import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { openDialog } from '../../../../../base/dialog/actions';
import { isLocalParticipantModerator } from '../../../../../base/participants/functions';
import Button from '../../../../../base/ui/components/web/Button';
import { BUTTON_TYPES } from '../../../../../base/ui/constants.web';
import { clearBreakoutTimer } from '../../../../../breakout-rooms/actions';
import { FEATURE_KEY } from '../../../../../breakout-rooms/constants';

import BreakoutTimerPrompt from './BreakoutTimerPrompt';

const useStyles = makeStyles()(theme => {
    return {
        wrapper: {
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing(2)
        },
        countdown: {
            fontVariantNumeric: 'tabular-nums'
        }
    };
});

function _format(remainingMs: number) {
    const total = Math.max(0, Math.round(remainingMs / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;

    return `${m}:${String(s).padStart(2, '0')}`;
}

interface IProps {
    className?: string;
}

export const BreakoutTimerControls = ({ className }: IProps) => {
    const { classes, cx } = useStyles();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const isModerator = useSelector(isLocalParticipantModerator);
    const endTimestamp = useSelector((state: any) => state[FEATURE_KEY].timerEndTimestamp);
    const [ now, setNow ] = useState(() => Date.now());

    useEffect(() => {
        if (!endTimestamp) {
            return;
        }
        const id = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(id);
    }, [ endTimestamp ]);

    const onStart = useCallback(() => {
        dispatch(openDialog('BreakoutTimerPrompt', BreakoutTimerPrompt));
    }, [ dispatch ]);

    const onStop = useCallback(() => {
        dispatch(clearBreakoutTimer());
    }, [ dispatch ]);

    if (!isModerator && !endTimestamp) {
        return null;
    }

    const running = Boolean(endTimestamp);
    const remainingMs = running ? Math.max(0, endTimestamp - now) : 0;

    return (
        <div className = { cx(classes.wrapper, className) }>
            {running && (
                <span className = { classes.countdown }>
                    {_format(remainingMs)}
                </span>
            )}
            {isModerator && !running && (
                <Button
                    accessibilityLabel = { t('breakoutRooms.actions.startTimer') }
                    fullWidth = { true }
                    labelKey = { 'breakoutRooms.actions.startTimer' }
                    onClick = { onStart }
                    type = { BUTTON_TYPES.TERTIARY } />
            )}
            {isModerator && running && (
                <Button
                    accessibilityLabel = { t('breakoutRooms.actions.stopTimer') }
                    fullWidth = { true }
                    labelKey = { 'breakoutRooms.actions.stopTimer' }
                    onClick = { onStop }
                    type = { BUTTON_TYPES.DESTRUCTIVE } />
            )}
        </div>
    );
};
