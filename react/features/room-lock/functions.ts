import { IStateful } from '../base/app/types';
import { getInviteURL } from '../base/connection/functions';
import { toState } from '../base/redux/functions';
import { parseURLParams } from '../base/util/parseURLParams';

/**
 * The hash parameter of an invite link which carries the room password, so
 * whoever opens the link walks past the lobby. It lives in the fragment, which
 * browsers never send to the server.
 */
export const URL_PASSWORD_PARAM = 'pw';

/**
 * Characters for generated room passwords: no look-alikes (0/O, 1/l/I), so a
 * password read aloud or retyped from the security dialog survives.
 */
const ROOM_PASSWORD_CHARS = [ ...'abcdefghijkmnpqrstuvwxyz', ...'23456789' ].join('');

/**
 * Generated room password length: 10 chars from 32 symbols, 50 bits.
 */
const PASSWORD_LENGTH = 10;

/**
 * Generates a random room password.
 *
 * @returns {string}
 */
export function generateRoomPassword() {
    const bytes = new Uint8Array(PASSWORD_LENGTH);

    crypto.getRandomValues(bytes);

    // 256 is a multiple of 32, so the modulo has no bias.
    return Array.from(bytes, b => ROOM_PASSWORD_CHARS[b % ROOM_PASSWORD_CHARS.length]).join('');
}

/**
 * Returns the room password carried by the URL the app was opened with
 * ({@code #pw=...}), if any.
 *
 * @param {IStateful} stateful - The redux state or getState.
 * @returns {string|undefined}
 */
export function getRoomPasswordFromURL(stateful: IStateful): string | undefined {
    const state = toState(stateful);
    const locationURL
        = state['features/base/connection'].locationURL || state['features/base/config'].locationURL;

    if (!locationURL) {
        return undefined;
    }

    const value = parseURLParams(locationURL, true)[URL_PASSWORD_PARAM];

    if (typeof value !== 'string' || !value) {
        return undefined;
    }

    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}

/**
 * Returns the link to share for the current meeting: the invite URL plus, when
 * this client knows the room password, that password, so recipients join
 * without knocking.
 *
 * @param {IStateful} stateful - The redux state or getState.
 * @returns {string}
 */
export function getShareableInviteURL(stateful: IStateful): string {
    const state = toState(stateful);
    const inviteURL = getInviteURL(state);
    const { password } = state['features/base/conference'];

    if (!password) {
        return inviteURL;
    }

    return `${inviteURL}#${URL_PASSWORD_PARAM}=${encodeURIComponent(password)}`;
}
