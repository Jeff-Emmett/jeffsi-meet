/**
 * Background audio keep-alive (rspace TASK-RMEETS-UI-POLISH item 6).
 *
 * Mobile browsers throttle background tabs and may pause WebRTC audio
 * when the screen turns off. Four combined techniques keep the call
 * audio playing:
 *
 *   1. MediaSession metadata + playback state — tells the OS this tab
 *      is producing media, so it gets the same priority as a podcast
 *      app and is exempted from background throttling.
 *   2. A tiny silent looping HTMLAudioElement — keeps the page's media
 *      pipeline considered "actively playing", which iOS uses as the
 *      signal to keep the AudioContext running when locked.
 *   3. Visibilitychange listener — re-asserts MediaSession state when
 *      the tab returns to foreground, in case it was cleared while
 *      hidden.
 *   4. Auto audio-only while hidden — the single biggest lever. Encoding
 *      and decoding video is what makes a backgrounded tab expensive
 *      enough for the OS to throttle or evict it, and none of that video
 *      is visible anyway while the screen is off or another app is in
 *      front. Dropping to audio-only on hide (and restoring on show)
 *      keeps the call cheap enough to survive being backgrounded.
 *
 * No-ops on desktop (mobile-only). Caller wires this in conference
 * middleware on CONFERENCE_JOINED and tears it down on CONFERENCE_LEFT.
 */

import { IStore } from '../app/types';
import { setAudioOnly } from '../base/audio-only/actions';
import { isMobileBrowser } from '../base/environment/utils';
import { isScreenVideoShared } from '../screen-share/functions';

import logger from './logger';

let _silentAudio: HTMLAudioElement | null = null;
let _visibilityHandler: (() => void) | null = null;
let _gestureUnlockHandler: (() => void) | null = null;
let _store: IStore | null = null;

/**
 * True only when *we* turned audio-only on because the page went hidden. A
 * user who chose audio-only themselves must not have it switched back off
 * when they return to the tab.
 */
let _forcedAudioOnly = false;

/**
 * Pending hide→audio-only transition. Deferred by {@link HIDE_GRACE_MS} so a
 * momentary hide (permission sheet, share picker, notification shade) doesn't
 * tear the camera down and rebuild it a second later.
 */
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

const HIDE_GRACE_MS = 2000;

/**
 * 0.15-second silent WAV (8 kHz / mono / 16-bit, 1200 zeroed PCM frames).
 * MUST contain real frames — an empty/0-length clip has duration 0, so
 * `loop` never advances and the browser never treats the element as
 * "actively playing media", which silently defeats the entire keep-alive
 * (the previous 44-byte header-only clip did exactly that). Pure silence
 * so it can't disturb the call audio.
 */
const BASE64_SILENCE = 'UklGRoQJAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YWAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const SILENT_LOOP = `data:audio/wav;base64,${BASE64_SILENCE}`;

function _setMediaSessionMeta(roomName: string): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: roomName || 'Meeting',
            artist: 'rMeets',
            album: 'rSpace',
        });
        navigator.mediaSession.playbackState = 'playing';
    } catch {
        // MediaMetadata may be unavailable on older browsers; failure is benign.
    }
}

/**
 * Registers MediaSession action handlers. Having handlers makes the OS treat
 * this as a first-class media session (lock-screen transport controls on
 * Android) and keeps it from tearing the session down under background
 * throttling. The call's own mic button remains the real mute control — these
 * handlers just keep the silent keep-alive loop playing and the playback state
 * coherent, so pressing a stray lock-screen control can't kill the call audio.
 *
 * NOTE: iOS Safari locked-screen WebRTC audio remains a hard WebKit limitation
 * that no web technique fully solves; only the native app can. On Android
 * Chrome this materially improves backgrounded-call reliability.
 *
 * @returns {void}
 */
function _setMediaSessionHandlers(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const keepPlaying = () => {
        void _silentAudio?.play().catch(() => undefined);
        try {
            navigator.mediaSession.playbackState = 'playing';
        } catch { /* ignore */ }
    };

    try {
        navigator.mediaSession.setActionHandler('play', keepPlaying);
        navigator.mediaSession.setActionHandler('pause', keepPlaying);
    } catch {
        // Some browsers throw on unsupported actions; failure is benign.
    }
}

function _teardownGestureUnlock(): void {
    if (!_gestureUnlockHandler) return;
    document.removeEventListener('pointerdown', _gestureUnlockHandler);
    document.removeEventListener('touchend', _gestureUnlockHandler);
    _gestureUnlockHandler = null;
}

function _cancelHideTimer(): void {
    if (_hideTimer !== null) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }
}

/**
 * Drops the conference to audio-only because the page went hidden. Skipped
 * when the user is already in audio-only mode (nothing to do) or is sharing
 * their screen (audio-only would kill the share, and a screen share is
 * routinely watched from another app).
 *
 * @returns {void}
 */
function _enterAudioOnlyForHidden(): void {
    _hideTimer = null;

    if (!_store || document.visibilityState !== 'hidden') return;

    const state = _store.getState();

    if (state['features/base/audio-only'].enabled) return;
    if (isScreenVideoShared(state)) return;

    _forcedAudioOnly = true;
    logger.info('[background-audio] page hidden — dropping to audio-only to keep the call alive');
    _store.dispatch(setAudioOnly(true));
}

/**
 * Restores video after the page becomes visible again, but only if this module
 * is what turned it off.
 *
 * @returns {void}
 */
function _exitAudioOnlyForVisible(): void {
    if (!_forcedAudioOnly) return;

    _forcedAudioOnly = false;
    logger.info('[background-audio] page visible — restoring video');
    _store?.dispatch(setAudioOnly(false));
}

export function startBackgroundAudioKeepAlive(roomName: string, store?: IStore): void {
    if (!isMobileBrowser()) return;

    // Always refresh the store handle — the keep-alive may already be running
    // from a previous join within the same page load.
    _store = store ?? _store;

    if (_silentAudio) return; // already started

    _setMediaSessionMeta(roomName);

    try {
        _silentAudio = new Audio(SILENT_LOOP);
        _silentAudio.loop = true;
        _silentAudio.volume = 0.001; // effectively silent but non-zero so iOS treats it as playing
        // `playsInline` keeps it from forcing fullscreen on iOS Safari.
        (_silentAudio as any).playsInline = true;
        void _silentAudio.play().catch(() => {
            // iOS Safari rejects play() without user activation. The call's
            // own join/unmute taps usually satisfy this, but if not, latch a
            // one-time gesture listener and start the loop from inside it —
            // that's the only context iOS reliably allows playback to begin.
            _gestureUnlockHandler = () => {
                void _silentAudio?.play().catch(() => undefined);
                _teardownGestureUnlock();
            };
            document.addEventListener('pointerdown', _gestureUnlockHandler, { once: true });
            document.addEventListener('touchend', _gestureUnlockHandler, { once: true });
        });
    } catch {
        // HTMLAudioElement may be unavailable in test/SSR environments.
    }

    _setMediaSessionHandlers();

    _visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
            _cancelHideTimer();
            _setMediaSessionMeta(roomName);
            void _silentAudio?.play().catch(() => undefined);
            _exitAudioOnlyForVisible();
        } else {
            _cancelHideTimer();
            _hideTimer = setTimeout(_enterAudioOnlyForHidden, HIDE_GRACE_MS);
        }
    };
    document.addEventListener('visibilitychange', _visibilityHandler);
}

export function stopBackgroundAudioKeepAlive(): void {
    _cancelHideTimer();

    // Leave redux the way we found it — a forced audio-only must not leak into
    // the next conference joined in this same page load.
    _exitAudioOnlyForVisible();
    _store = null;

    if (_silentAudio) {
        try {
            _silentAudio.pause();
        } catch { /* ignore */ }
        _silentAudio.src = '';
        _silentAudio = null;
    }
    if (_visibilityHandler) {
        document.removeEventListener('visibilitychange', _visibilityHandler);
        _visibilityHandler = null;
    }
    _teardownGestureUnlock();
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
            navigator.mediaSession.setActionHandler('play', null);
            navigator.mediaSession.setActionHandler('pause', null);
        } catch { /* ignore */ }
        try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
        } catch { /* ignore */ }
    }
}
