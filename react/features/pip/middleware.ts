import { CONFERENCE_WILL_LEAVE } from '../base/conference/actionTypes';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';

import { exitDocumentPiP, exitPiP } from './actions';

import './subscriber';

/**
 * Closes any open PiP surface (Document PiP window or classic video PiP)
 * when the conference is left, so it doesn't strand a floating window.
 */
MiddlewareRegistry.register(store => next => action => {
    const result = next(action);

    if (action.type === CONFERENCE_WILL_LEAVE) {
        const { dispatch, getState } = store;
        const state = getState()['features/pip'];

        if (state?.isDocumentPiPActive) {
            dispatch(exitDocumentPiP());
        }

        if (state?.isPiPActive) {
            dispatch(exitPiP());
        }
    }

    return result;
});
