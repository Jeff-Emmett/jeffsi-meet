/**
 * Middleware for Meeting Intelligence feature.
 *
 * Listens for CONFERENCE_JOINED to automatically fetch the access token
 * for the current room, so it's ready when the user opens the MI dashboard.
 */

import { CONFERENCE_JOINED } from '../base/conference/actionTypes';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';

import { fetchMeetingToken } from './actions';

MiddlewareRegistry.register(({ dispatch, getState }) => (next: Function) => (action: any) => {
    const result = next(action);

    if (action.type === CONFERENCE_JOINED) {
        const room = getState()['features/base/conference']?.room;

        if (room) {
            dispatch(fetchMeetingToken(room) as any);
        }
    }

    return result;
});
