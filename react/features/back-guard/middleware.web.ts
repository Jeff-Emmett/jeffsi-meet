import { IStore } from '../app/types';
import { CONFERENCE_JOINED, CONFERENCE_LEFT, CONFERENCE_WILL_LEAVE } from '../base/conference/actionTypes';
import { leaveConference } from '../base/conference/actions';
import { hideDialog } from '../base/dialog/actions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import { closeChat } from '../chat/actions.any';
import { close as closeParticipantsPane } from '../participants-pane/actions.any';
import { setOverflowMenuVisible } from '../toolbox/actions.web';

import { decideBack } from './functions';

/**
 * Marks the one history entry this guard pushes, so it can pop exactly that.
 */
const GUARD_STATE = { jeffsiBackGuard: true };

let onPopState: (() => void) | undefined;
let lastWarnAt = 0;

/**
 * Shows a short self-removing hint. A plain DOM toast on purpose: the
 * deployment restricts Jitsi notifications (`config.notifications`), and this
 * one must always be seen.
 *
 * @param {string} text - The hint.
 * @returns {void}
 */
function showHint(text: string) {
    const id = 'jeffsi-back-guard-hint';

    document.getElementById(id)?.remove();
    const el = document.createElement('div');

    el.id = id;
    el.setAttribute('role', 'status');
    el.textContent = text;
    Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: 'calc(96px + env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: '100000',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '20px',
        font: '500 14px/1.3 Inter, system-ui, sans-serif',
        pointerEvents: 'none'
    });
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
}

/**
 * Pushes the guard entry (same URL), so the next Back pops it instead of
 * leaving the page.
 *
 * @returns {void}
 */
function pushGuard() {
    window.history.pushState(GUARD_STATE, '');
}

/**
 * Starts catching Back for this conference.
 *
 * @param {Object} store - The Redux store.
 * @returns {void}
 */
function install({ dispatch, getState }: IStore) {
    if (onPopState || typeof window === 'undefined' || !window.history?.pushState) {
        return;
    }
    lastWarnAt = 0;
    pushGuard();
    onPopState = () => {
        const now = Date.now();

        switch (decideBack(getState(), lastWarnAt, now)) {
        case 'hide-dialog':
            dispatch(hideDialog());
            break;
        case 'close-chat':
            dispatch(closeChat());
            break;
        case 'close-participants':
            dispatch(closeParticipantsPane());
            break;
        case 'close-overflow':
            dispatch(setOverflowMenuVisible(false));
            break;
        case 'warn':
            lastWarnAt = now;
            showHint('Press back again to leave the call');
            break;
        case 'leave':
            // The guard entry is already popped by this Back; don't push it again.
            uninstall(false);
            dispatch(leaveConference());

            return;
        }
        pushGuard();
    };
    window.addEventListener('popstate', onPopState);
}

/**
 * Stops catching Back. When the call ended some other way (hang-up button),
 * also pops the guard entry so it doesn't cost the user an extra Back later.
 *
 * @param {boolean} popGuardEntry - Whether to pop our history entry if it is current.
 * @returns {void}
 */
function uninstall(popGuardEntry = true) {
    if (!onPopState) {
        return;
    }
    window.removeEventListener('popstate', onPopState);
    onPopState = undefined;
    if (popGuardEntry && window.history.state?.jeffsiBackGuard) {
        window.history.back();
    }
}

MiddlewareRegistry.register(store => next => action => {
    const result = next(action);

    switch (action.type) {
    case CONFERENCE_JOINED:
        install(store);
        break;
    case CONFERENCE_WILL_LEAVE:
    case CONFERENCE_LEFT:
        uninstall();
        break;
    }

    return result;
});
