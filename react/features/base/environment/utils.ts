import Platform from '../react/Platform';

/**
 * Returns whether or not the current environment is a mobile device.
 *
 * @returns {boolean}
 */
export function isMobileBrowser() {
    return Platform.OS === 'android' || Platform.OS === 'ios';
}


/**
 * Whether the device is driven by touch with no fine pointer: a phone or
 * tablet, including Android in "desktop site" mode (its user agent says
 * Linux, so {@link isMobileBrowser} misses it).
 *
 * Use this, not the user agent, for CALL-CONTINUITY decisions (the OS media
 * notification's hang-up action, audio-only while hidden): those follow how
 * the device behaves, not what it claims to be. Layout keeps using
 * {@link isMobileBrowser}.
 *
 * @returns {boolean}
 */
export function isTouchFirstDevice() {
    if (isMobileBrowser()) {
        return true;
    }

    // Browser-only APIs, typed locally: this file is shared with native, whose
    // window/navigator typings don't carry them (isMobileBrowser() covers native).
    const nav = typeof navigator === 'undefined' ? undefined : navigator as { maxTouchPoints?: number; };
    const win = typeof window === 'undefined'
        ? undefined
        : window as { matchMedia?: (query: string) => { matches: boolean; }; };

    if (!nav || !win?.matchMedia) {
        return false;
    }

    return (nav.maxTouchPoints ?? 0) > 0
        && win.matchMedia('(pointer: coarse)').matches
        && !win.matchMedia('(any-pointer: fine)').matches;
}

/**
 * Returns whether or not the current environment is an ios mobile device.
 *
 * @returns {boolean}
 */
export function isIosMobileBrowser() {
    return Platform.OS === 'ios';
}

/**
 * Returns whether or not the current environment is an ipad device.
 *
 * @returns {boolean}
 */
export function isIpadMobileBrowser() {

    // @ts-ignore
    return isIosMobileBrowser() && Platform.isPad;
}

