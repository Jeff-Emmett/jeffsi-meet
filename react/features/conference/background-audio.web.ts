/**
 * Background audio keep-alive (rspace TASK-RMEETS-UI-POLISH item 6).
 *
 * Mobile browsers throttle background tabs and may pause WebRTC audio
 * when the screen turns off. Three combined techniques keep the call
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
 *
 * No-ops on desktop (mobile-only). Caller wires this in conference
 * middleware on CONFERENCE_JOINED and tears it down on CONFERENCE_LEFT.
 */

import { isMobileBrowser } from '../base/environment/utils';

let _silentAudio: HTMLAudioElement | null = null;
let _visibilityHandler: (() => void) | null = null;
let _gestureUnlockHandler: (() => void) | null = null;

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

function _teardownGestureUnlock(): void {
    if (!_gestureUnlockHandler) return;
    document.removeEventListener('pointerdown', _gestureUnlockHandler);
    document.removeEventListener('touchend', _gestureUnlockHandler);
    _gestureUnlockHandler = null;
}

export function startBackgroundAudioKeepAlive(roomName: string): void {
    if (!isMobileBrowser()) return;
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

    _visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
            _setMediaSessionMeta(roomName);
            void _silentAudio?.play().catch(() => undefined);
        }
    };
    document.addEventListener('visibilitychange', _visibilityHandler);
}

export function stopBackgroundAudioKeepAlive(): void {
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
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
        } catch { /* ignore */ }
    }
}
