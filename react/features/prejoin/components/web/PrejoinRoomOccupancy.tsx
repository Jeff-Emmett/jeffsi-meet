import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState } from '../../../app/types';
import { getRoomName } from '../../../base/conference/functions';

const useStyles = makeStyles()(theme => {
    return {
        occupancy: {
            ...theme.typography.labelRegular,
            color: theme.palette.text02,
            textAlign: 'center' as const,
            marginTop: `-${theme.spacing(2)}`,
            marginBottom: theme.spacing(3)
        }
    };
});

/**
 * How often to re-poll the occupant count while the prejoin screen is open.
 */
const POLL_INTERVAL_MS = 5000;

/**
 * Shows how many people are already in the room on the prejoin screen
 * (count-only, no names) via the mod_muc_size `/room-size` endpoint.
 *
 * Degrades gracefully: renders nothing until the first successful response,
 * and stays hidden if the endpoint is unavailable (e.g. a deployment without
 * mod_muc_size), so it never shows a misleading value.
 *
 * @returns {React.ReactElement | null}
 */
const PrejoinRoomOccupancy: React.FC = () => {
    const { classes } = useStyles();
    const { t } = useTranslation();
    const room = useSelector(getRoomName);
    const domain = useSelector((state: IReduxState) => state['features/base/config'].hosts?.domain);
    const [ count, setCount ] = useState<number | null>(null);

    useEffect(() => {
        if (!room || !domain) {
            return;
        }

        let cancelled = false;
        const url = `/room-size?room=${encodeURIComponent(room.toLowerCase())}&domain=${encodeURIComponent(domain)}`;

        const poll = async () => {
            try {
                const res = await fetch(url, { headers: { Accept: 'application/json' } });

                if (cancelled) {
                    return;
                }

                // 404 = the room has not been created yet, i.e. nobody is in it.
                if (res.status === 404) {
                    setCount(0);

                    return;
                }

                if (!res.ok) {
                    return;
                }

                const data = await res.json();

                if (!cancelled && typeof data?.participants === 'number') {
                    setCount(data.participants);
                }
            } catch (e) {
                // Endpoint unavailable - leave the count as-is (render nothing).
            }
        };

        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [ room, domain ]);

    if (count === null) {
        return null;
    }

    return (
        <div
            className = { classes.occupancy }
            data-testid = 'prejoin.roomOccupancy'>
            <p aria-live = 'polite'>
                { count === 0 ? t('prejoin.roomOccupancyEmpty') : t('prejoin.roomOccupancy', { count }) }
            </p>
        </div>
    );
};

export default PrejoinRoomOccupancy;
