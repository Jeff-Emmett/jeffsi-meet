import { IReduxState } from '../app/types';

/**
 * What a Back press (Android back gesture, browser back button, mouse back
 * button) does while in a conference.
 */
export type BackAction = 'close-chat' | 'close-participants' | 'hide-dialog' | 'close-overflow' | 'warn' | 'leave';

/**
 * A second Back within this window, with nothing left to close, leaves.
 */
export const BACK_TO_LEAVE_WINDOW_MS = 3000;

/**
 * Decides what one Back press does: close the top-most open surface, else warn,
 * else (second press inside the window) leave.
 *
 * Without this, Back navigated the page away. People dismiss the mobile chat
 * with the back gesture, so "closing the chat" ended the call - and in the
 * installed PWA, which has no history, Back closes the app outright.
 *
 * @param {IReduxState} state - The Redux state.
 * @param {number} lastWarnAt - When the last "press back again" warning was shown (ms), 0 if never.
 * @param {number} now - The current time (ms).
 * @returns {BackAction}
 */
export function decideBack(state: IReduxState, lastWarnAt: number, now: number): BackAction {
    if (state['features/base/dialog']?.component) {
        return 'hide-dialog';
    }
    if (state['features/chat']?.isOpen) {
        return 'close-chat';
    }
    if (state['features/participants-pane']?.isOpen) {
        return 'close-participants';
    }
    if (state['features/toolbox']?.overflowMenuVisible) {
        return 'close-overflow';
    }
    if (lastWarnAt > 0 && now - lastWarnAt <= BACK_TO_LEAVE_WINDOW_MS) {
        return 'leave';
    }

    return 'warn';
}
