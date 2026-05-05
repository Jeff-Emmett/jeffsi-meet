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
 *   3. visibilitychange listener — re-asserts MediaSession state when
 *      the tab returns to foreground, in case it was cleared while
 *      hidden.
 *
 * No-ops on desktop (mobile-only). Caller wires this in conference
 * middleware on CONFERENCE_JOINED and tears it down on CONFERENCE_LEFT.
 */

import { isMobileBrowser } from '../base/environment/utils';

let _silentAudio: HTMLAudioElement | null = null;
let _visibilityHandler: (() => void) | null = null;

/**
 * 1-second silent OGG loop encoded as a data URL. Keeps the page's
 * media element pipeline alive. Tiny (~120 bytes) so we don't hit
 * cache cost; pure silence so it can't disturb the call audio.
 */
const SILENT_LOOP = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

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

export function startBackgroundAudioKeepAlive(roomName: string): void {
	if (!isMobileBrowser()) return;
	if (_silentAudio) return; // already started

	_setMediaSessionMeta(roomName);

	try {
		_silentAudio = new Audio(SILENT_LOOP);
		_silentAudio.loop = true;
		_silentAudio.volume = 0.001;     // effectively silent but non-zero so iOS treats it as playing
		// `playsInline` keeps it from forcing fullscreen on iOS Safari.
		(_silentAudio as any).playsInline = true;
		void _silentAudio.play().catch(() => {
			// Autoplay blocked — the call audio itself acts as the keep-alive
			// once the user interacts. Re-attempt on next visibilitychange.
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
		try { _silentAudio.pause(); } catch { /* ignore */ }
		_silentAudio.src = '';
		_silentAudio = null;
	}
	if (_visibilityHandler) {
		document.removeEventListener('visibilitychange', _visibilityHandler);
		_visibilityHandler = null;
	}
	if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
		try {
			navigator.mediaSession.playbackState = 'none';
			navigator.mediaSession.metadata = null;
		} catch { /* ignore */ }
	}
}
