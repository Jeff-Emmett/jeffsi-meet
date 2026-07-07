import { batch } from 'react-redux';
import { AnyAction } from 'redux';

import { createShortcutEvent } from '../analytics/AnalyticsEvents';
import { sendAnalytics } from '../analytics/functions';
import { IStore } from '../app/types';
import { clickOnVideo } from '../filmstrip/actions.web';
import { openSettingsDialog } from '../settings/actions.web';
import { SETTINGS_TABS } from '../settings/constants';
import { iAmVisitor } from '../visitors/functions';

import {
    DISABLE_KEYBOARD_SHORTCUTS,
    ENABLE_KEYBOARD_SHORTCUTS,
    REGISTER_KEYBOARD_SHORTCUT,
    UNREGISTER_KEYBOARD_SHORTCUT
} from './actionTypes';
import { areKeyboardShortcutsEnabled, getKeyboardShortcuts } from './functions';
import { IKeyboardShortcut } from './types';
import { getKeyboardKey, getPriorityFocusedElement } from './utils';

/**
 * Action to register a new shortcut.
 *
 * @param {IKeyboardShortcut} shortcut - The shortcut to register.
 * @returns {AnyAction}
*/
export const registerShortcut = (shortcut: IKeyboardShortcut): AnyAction => {
    return {
        type: REGISTER_KEYBOARD_SHORTCUT,
        shortcut
    };
};

/**
* Action to unregister a shortcut.
*
* @param {string} character - The character of the shortcut to unregister.
* @param {boolean} altKey - Whether the shortcut used altKey.
* @returns {AnyAction}
*/
export const unregisterShortcut = (character: string, altKey = false): AnyAction => {
    return {
        alt: altKey,
        type: UNREGISTER_KEYBOARD_SHORTCUT,
        character
    };
};

/**
 * Action to enable keyboard shortcuts.
 *
 * @returns {AnyAction}
 */
export const enableKeyboardShortcuts = (): AnyAction => {
    return {
        type: ENABLE_KEYBOARD_SHORTCUTS
    };
};


/**
 * Action to enable keyboard shortcuts.
 *
 * @returns {AnyAction}
 */
export const disableKeyboardShortcuts = (): AnyAction => {
    return {
        type: DISABLE_KEYBOARD_SHORTCUTS
    };
};

type KeyHandler = ((e: KeyboardEvent) => void) | undefined;

let keyDownHandler: KeyHandler;
let keyUpHandler: KeyHandler;

/**
 * Initialise global shortcuts.
 * Global shortcuts are shortcuts for features that don't have a button or
 * link associated with the action. In other words they represent actions
 * triggered _only_ with a shortcut.
 *
 * @param {Function} dispatch - The redux dispatch function.
 * @returns {void}
 */
function initGlobalKeyboardShortcuts(dispatch: IStore['dispatch']) {
    batch(() => {
        dispatch(registerShortcut({
            character: '?',
            helpDescription: 'keyboardShortcuts.toggleShortcuts',
            handler: () => {
                sendAnalytics(createShortcutEvent('help'));
                dispatch(openSettingsDialog(SETTINGS_TABS.SHORTCUTS, false));
            }
        }));

        // register SPACE shortcut in two steps to insure visibility of help message.
        // rspace UX: SPACE toggles mute/unmute (was push-to-talk upstream); the
        // actual toggle is handled directly in the global keydown handler below.
        dispatch(registerShortcut({
            character: ' ',
            helpCharacter: 'SPACE',
            helpDescription: 'keyboardShortcuts.mute',
            handler: () => {
                // Handled directly on the global handler.
            }
        }));

        dispatch(registerShortcut({
            character: '0',
            helpDescription: 'keyboardShortcuts.focusLocal',
            handler: () => {
                dispatch(clickOnVideo(0));
            }
        }));

        for (let num = 1; num < 10; num++) {
            dispatch(registerShortcut({
                character: `${num}`,

                // only show help hint for the first shortcut
                helpCharacter: num === 1 ? '1-9' : undefined,
                helpDescription: num === 1 ? 'keyboardShortcuts.focusRemote' : undefined,
                handler: () => {
                    dispatch(clickOnVideo(num));
                }
            }));
        }
    });
}

/**
 * Unregisters global shortcuts.
 *
 * @param {Function} dispatch - The redux dispatch function.
 * @returns {void}
 */
function unregisterGlobalKeyboardShortcuts(dispatch: IStore['dispatch']) {
    batch(() => {
        dispatch(unregisterShortcut('?'));

        // register SPACE shortcut in two steps to insure visibility of help message
        dispatch(unregisterShortcut(' '));

        dispatch(unregisterShortcut('0'));

        for (let num = 1; num < 10; num++) {
            dispatch(unregisterShortcut(`${num}`));
        }
    });
}

/**
 * Initializes keyboard shortcuts.
 *
 * @returns {Function}
*/
export function initKeyboardShortcuts() {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        initGlobalKeyboardShortcuts(dispatch);

        keyUpHandler = (e: KeyboardEvent) => {
            const state = getState();
            const enabled = areKeyboardShortcutsEnabled(state);
            const shortcuts = getKeyboardShortcuts(state);

            if (!enabled || getPriorityFocusedElement()) {
                return;
            }

            const key = getKeyboardKey(e).toUpperCase();

            if (shortcuts.has(key)) {
                shortcuts.get(key)?.handler(e);
            }
        };

        keyDownHandler = (e: KeyboardEvent) => {
            const state = getState();
            const enabled = areKeyboardShortcutsEnabled(state);

            if (!enabled || iAmVisitor(state)) {
                return;
            }

            const focusedElement = getPriorityFocusedElement();
            const key = getKeyboardKey(e).toUpperCase();

            if (key === ' ' && !focusedElement) {
                // rspace UX: SPACE toggles mute/unmute (upstream used it for
                // push-to-talk). preventDefault stops the space bar from
                // scrolling the page; `e.repeat` guards against the held-key
                // auto-repeat flapping mute on/off.
                e.preventDefault();
                if (e.repeat) {
                    return;
                }
                sendAnalytics(createShortcutEvent('mute'));
                APP.conference.toggleAudioMuted();
            } else if (key === 'ESCAPE') {
                focusedElement?.blur();
            }
        };

        window.addEventListener('keyup', keyUpHandler);
        window.addEventListener('keydown', keyDownHandler);
    };
}

/**
 * Unregisters the global shortcuts and removes the global keyboard listeners.
 *
 * @returns {Function}
 */
export function disposeKeyboardShortcuts() {
    return (dispatch: IStore['dispatch']) => {
        // The components that are registering shortcut should take care of unregistering them.
        unregisterGlobalKeyboardShortcuts(dispatch);

        keyUpHandler && window.removeEventListener('keyup', keyUpHandler);
        keyDownHandler && window.removeEventListener('keydown', keyDownHandler);
        keyDownHandler = keyUpHandler = undefined;
    };
}
