import { IReduxState, IStore } from '../app/types';
import { AVATAR_DEFAULT_BACKGROUND_COLOR } from '../base/avatar/components/web/styles';
import { getAvatarColor, getInitials } from '../base/avatar/functions';
import { leaveConference } from '../base/conference/actions';
import { isMobileBrowser, isTouchFirstDevice } from '../base/environment/utils';
import { browser } from '../base/lib-jitsi-meet';
import { IParticipant } from '../base/participants/types';
import { getLocalVideoTrack } from '../base/tracks/functions.any';
import { getVideoTrackByParticipant } from '../base/tracks/functions.web';
import { MESSAGE_TYPE_LOCAL } from '../chat/constants';
import { getMessageText } from '../chat/functions';
import { IMessage } from '../chat/types';
import { isPrejoinPageVisible } from '../prejoin/functions.any';

import { toggleAudioFromPiP, toggleVideoFromPiP } from './actions';
import { isPiPEnabled } from './external-api.shared';
import logger from './logger';
import { IMediaSessionState } from './types';

/**
 * Gets the appropriate video track for PiP based on prejoin state.
 * During prejoin, returns local video track. In conference, returns large video participant's track.
 *
 * @param {IReduxState} state - Redux state.
 * @param {IParticipant | undefined} participant - Participant to get track for.
 * @returns {ITrack | undefined} The video track or undefined.
 */
export function getPiPVideoTrack(state: IReduxState, participant: IParticipant | undefined) {
    const isOnPrejoin = isPrejoinPageVisible(state);

    return isOnPrejoin
        ? getLocalVideoTrack(state['features/base/tracks'])
        : getVideoTrackByParticipant(state, participant);
}

/**
 * Determines if PiP should be shown based on config and current app state.
 * Checks if PiP is enabled and handles prejoin page visibility.
 *
 * @param {IReduxState} state - Redux state.
 * @returns {boolean} Whether PiP should be shown.
 */
export function shouldShowPiP(state: IReduxState): boolean {
    const pipConfig = state['features/base/config'].pip;

    // Check if PiP is enabled at all.
    if (!isPiPEnabled(pipConfig)) {
        return false;
    }

    // Mobile web gets the pop-out too, now that nothing in-page can trigger it.
    //
    // It was switched off on mobile (1eb2c22) because PiPVideoElement then
    // entered PiP from window `blur`/`visibilitychange` listeners, which fire
    // on ordinary in-page interactions - opening the fullscreen chat modal
    // popped the tab into PiP - and a MediaSession `hangup` handler left the
    // conference ("booted" from the room). Both causes are gone: entry is the
    // MediaSession 'enterpictureinpicture' action, which the BROWSER invokes
    // only when the page is really being hidden (app switch, home button), and
    // `hangup` is never registered on touch-first devices
    // (setupMediaSessionHandlers). Mobile has no Document PiP, so handleWindowBlur
    // falls back to the plain video PiP. `pip.mobile: false` restores the old
    // behaviour without a rebuild. Audio continuity while hidden stays with
    // background-audio.web either way.
    if (isMobileBrowser() && pipConfig?.mobile === false) {
        return false;
    }

    // Check prejoin state.
    const isOnPrejoin = isPrejoinPageVisible(state);
    const showOnPrejoin = pipConfig?.showOnPrejoin ?? false;

    // Don't show PiP on prejoin unless explicitly enabled.
    if (isOnPrejoin && !showOnPrejoin) {
        return false;
    }

    return true;
}

/**
 * Draws an image-based avatar as a circular clipped image on canvas.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {string} imageUrl - URL of the avatar image.
 * @param {boolean | undefined} useCORS - Whether to use CORS for image loading.
 * @param {number} centerX - X coordinate of avatar center.
 * @param {number} centerY - Y coordinate of avatar center.
 * @param {number} radius - Radius of the avatar circle.
 * @returns {Promise<void>}
 */
export async function drawImageAvatar(
        ctx: CanvasRenderingContext2D,
        imageUrl: string,
        useCORS: boolean | undefined,
        centerX: number,
        centerY: number,
        radius: number
): Promise<void> {
    const img = new Image();

    if (useCORS) {
        img.crossOrigin = 'anonymous';
    }
    img.src = imageUrl;

    try {
        await img.decode();
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.clip();
        const size = radius * 2;

        ctx.drawImage(img, centerX - radius, centerY - radius, size, size);
        ctx.restore();
    } catch (error) {
        logger.error('Failed to draw image avatar', error);
        throw new Error('Image load failed');
    }
}

/**
 * Draws an initials-based avatar with a colored background on canvas.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {string} name - Participant's display name.
 * @param {Array<string>} customAvatarBackgrounds - Custom avatar background colors.
 * @param {number} centerX - X coordinate of avatar center.
 * @param {number} centerY - Y coordinate of avatar center.
 * @param {number} radius - Radius of the avatar circle.
 * @param {string} fontFamily - Font family to use for initials.
 * @param {string} textColor - Color for the initials text.
 * @returns {void}
 */
export function drawInitialsAvatar(
        ctx: CanvasRenderingContext2D,
        name: string,
        customAvatarBackgrounds: Array<string>,
        centerX: number,
        centerY: number,
        radius: number,
        fontFamily: string,
        textColor: string
) {
    const initials = getInitials(name);
    const color = getAvatarColor(name, customAvatarBackgrounds);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = textColor;
    ctx.font = `bold 80px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, centerX, centerY);
}

/**
 * Draws the default user icon when no avatar is available.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {HTMLImageElement | null} defaultIcon - Preloaded default icon image.
 * @param {number} centerX - X coordinate of icon center.
 * @param {number} centerY - Y coordinate of icon center.
 * @param {number} radius - Radius of the icon circle.
 * @returns {void}
 */
export function drawDefaultIcon(
        ctx: CanvasRenderingContext2D,
        defaultIcon: HTMLImageElement | null,
        centerX: number,
        centerY: number,
        radius: number
) {
    ctx.fillStyle = AVATAR_DEFAULT_BACKGROUND_COLOR;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    if (defaultIcon) {
        const iconSize = radius;
        const x = centerX - iconSize / 2;
        const y = centerY - iconSize / 2;

        ctx.drawImage(defaultIcon, x, y, iconSize, iconSize);
    }
}

/**
 * Maximum character limit for display name before truncation.
 */
const DISPLAY_NAME_MAX_CHARS = 25;

/**
 * Draws the participant's display name below the avatar.
 * Truncates long names with ellipsis using a simple character limit.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {string} displayName - Participant's display name.
 * @param {number} centerX - X coordinate of text center.
 * @param {number} y - Y coordinate of text top.
 * @param {string} fontFamily - Font family to use for display name.
 * @param {string} textColor - Color for the display name text.
 * @returns {void}
 */
export function drawDisplayName(
        ctx: CanvasRenderingContext2D,
        displayName: string,
        centerX: number,
        y: number,
        fontFamily: string,
        textColor: string
) {
    const truncated = displayName.length > DISPLAY_NAME_MAX_CHARS
        ? `${displayName.slice(0, DISPLAY_NAME_MAX_CHARS)}...`
        : displayName;

    ctx.fillStyle = textColor;
    ctx.font = `24px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(truncated, centerX, y);
}

/**
 * Renders a complete avatar (image, initials, or default icon) with display name on canvas.
 *
 * @param {HTMLCanvasElement} canvas - The canvas element.
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {IParticipant | undefined} participant - The participant to render.
 * @param {string} displayName - The display name to show.
 * @param {Array<string>} customAvatarBackgrounds - Custom avatar background colors.
 * @param {HTMLImageElement | null} defaultIcon - Preloaded default icon image.
 * @param {string} backgroundColor - Background color for the canvas.
 * @param {string} fontFamily - Font family to use for text rendering.
 * @param {string} initialsColor - Color for avatar initials text.
 * @param {string} displayNameColor - Color for display name text.
 * @returns {Promise<void>}
 */
export async function renderAvatarOnCanvas(
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        participant: IParticipant | undefined,
        displayName: string,
        customAvatarBackgrounds: Array<string>,
        defaultIcon: HTMLImageElement | null,
        backgroundColor: string,
        fontFamily: string,
        initialsColor: string,
        displayNameColor: string
): Promise<void> {
    const { width, height } = canvas;
    const centerX = width / 2;
    const centerY = height / 2;
    const avatarRadius = 100;
    const spacing = 20;
    const textY = centerY + avatarRadius + spacing;

    // Clear and fill background.
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    let avatarRendered = false;

    if (participant?.loadableAvatarUrl) {
        try {
            await drawImageAvatar(
                ctx,
                participant.loadableAvatarUrl,
                participant.loadableAvatarUrlUseCORS,
                centerX,
                centerY,
                avatarRadius
            );
            avatarRendered = true;
        } catch (error) {
            logger.warn('Failed to load image avatar, falling back.', error);
        }
    }

    if (!avatarRendered) {
        if (participant?.name) {
            drawInitialsAvatar(
                ctx, participant.name, customAvatarBackgrounds, centerX, centerY, avatarRadius, fontFamily, initialsColor
            );
        } else {
            drawDefaultIcon(ctx, defaultIcon, centerX, centerY, avatarRadius);
        }
    }

    drawDisplayName(ctx, displayName, centerX, textY, fontFamily, displayNameColor);
}

/**
 * How many chat messages the popout shows at once.
 */
export const PIP_CHAT_MAX_MESSAGES = 30;

/**
 * Picks the chat messages worth showing in a popout: real text messages,
 * newest last, without reactions or lobby chatter.
 *
 * @param {Array<IMessage>} messages - The chat messages from redux.
 * @param {number} max - How many of the newest messages to keep.
 * @returns {Array<IMessage>}
 */
export function getPiPChatMessages(messages: IMessage[], max = PIP_CHAT_MAX_MESSAGES): IMessage[] {
    return messages
        .filter(m => !m.isReaction && !m.lobbyChat && Boolean(m.message))
        .slice(-max);
}

/**
 * Splits text into lines that fit {@code maxWidth} with the context's current font.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {string} text - The text to wrap.
 * @param {number} maxWidth - Maximum line width in pixels.
 * @returns {Array<string>}
 */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';

    for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
        const candidate = line ? `${line} ${word}` : word;

        if (ctx.measureText(candidate).width <= maxWidth || !line) {
            line = candidate;
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line) {
        lines.push(line);
    }

    return lines;
}

/**
 * Draws the newest chat messages onto a canvas, newest at the bottom. Used as
 * the video PiP's picture when a message arrives: a video PiP window (the only
 * kind phones have) shows nothing but one video, so the chat has to become the
 * video for a moment to be seen at all.
 *
 * @param {HTMLCanvasElement} canvas - The canvas element.
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context.
 * @param {Array<IMessage>} messages - Messages to draw, oldest first.
 * @param {string} fontFamily - Font family for the text.
 * @returns {void}
 */
export function renderChatOnCanvas(
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        messages: IMessage[],
        fontFamily: string
) {
    const { width, height } = canvas;
    const padding = 24;
    const lineHeight = 34;
    const textWidth = width - (padding * 2);

    ctx.fillStyle = '#131519';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#8ab4f8';
    ctx.font = `bold 22px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Chat', padding, padding);

    // Lay out from the bottom up so the newest message is always visible.
    let y = height - padding;
    const top = padding + 40;

    for (const message of [ ...messages ].reverse()) {
        ctx.font = `26px ${fontFamily}`;
        const lines = wrapCanvasText(ctx, getMessageText(message), textWidth);
        const blockHeight = (lines.length + 1) * lineHeight;

        if (y - blockHeight < top) {
            break;
        }
        y -= blockHeight;

        const name = message.messageType === MESSAGE_TYPE_LOCAL ? 'You' : message.displayName;

        ctx.fillStyle = '#9aa0a6';
        ctx.font = `bold 22px ${fontFamily}`;
        ctx.fillText(message.privateMessage ? `${name} (private)` : name, padding, y);

        ctx.fillStyle = '#ffffff';
        ctx.font = `26px ${fontFamily}`;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], padding, y + ((i + 1) * lineHeight));
        }

        y -= 8;
    }
}

/**
 * Checks if the Document Picture-in-Picture API is supported.
 *
 * @returns {boolean} - True if the browser supports Document PiP.
 */
export function isDocumentPiPSupported(): boolean {
    return 'documentPictureInPicture' in window;
}

/**
 * The currently open Document PiP window, if any. Kept out of Redux since
 * Window objects aren't serializable.
 */
let documentPiPWindow: Window | null = null;

/**
 * In-flight open request, if any. `blur` and `visibilitychange` can both
 * fire synchronously for a single tab switch, and Redux state doesn't
 * update until this resolves - without this guard both handlers would race
 * past the (still-false) `isDocumentPiPActive` check and each open their
 * own window.
 */
let openDocumentPiPWindowPromise: Promise<Window> | null = null;

/**
 * Returns the currently open Document PiP window, if any.
 *
 * @returns {Window | null} The open Document PiP window or null.
 */
export function getDocumentPiPWindow(): Window | null {
    return documentPiPWindow;
}

/**
 * Clones the main document's stylesheets (both linked and inline) into the
 * Document PiP window so portaled content renders with the app's styles.
 *
 * @param {Document} targetDocument - The Document PiP window's document.
 * @returns {void}
 */
function copyStylesInto(targetDocument: Document) {
    for (const styleSheet of Array.from(document.styleSheets)) {
        try {
            // MUI/tss-react inject rules via CSSOM insertRule in production
            // ("speedy" mode), leaving the <style> element's textContent empty.
            // cloneNode(true) would copy an empty tag and the popout would render
            // unstyled, so reconstruct the rules from the live CSSOM instead.
            const cssText = Array.from(styleSheet.cssRules)
                .map(rule => rule.cssText)
                .join('\n');
            const style = targetDocument.createElement('style');

            style.textContent = cssText;
            targetDocument.head.appendChild(style);
        } catch (e) {
            // Reading cssRules throws for cross-origin stylesheets. Re-link the
            // original node (clone) so the PiP window fetches it itself.
            const ownerNode = styleSheet.ownerNode;

            if (ownerNode instanceof HTMLElement) {
                targetDocument.head.appendChild(ownerNode.cloneNode(true));
            }
        }
    }
}

/**
 * Opens a Document Picture-in-Picture window and copies the app's styles
 * into it. The caller is responsible for portaling content into
 * {@code window.document.body}.
 *
 * @param {number} width - Initial window width.
 * @param {number} height - Initial window height.
 * @returns {Promise<Window>} The opened Document PiP window.
 */
export async function openDocumentPiPWindow(width = 400, height = 320): Promise<Window> {
    if (documentPiPWindow) {
        return documentPiPWindow;
    }

    if (openDocumentPiPWindowPromise) {
        return openDocumentPiPWindowPromise;
    }

    openDocumentPiPWindowPromise = (async () => {
        // @ts-ignore - documentPictureInPicture is not yet in TypeScript's lib definitions.
        const pipWindow: Window = await window.documentPictureInPicture.requestWindow({ width,
            height });

        copyStylesInto(pipWindow.document);
        documentPiPWindow = pipWindow;

        pipWindow.addEventListener('pagehide', () => {
            documentPiPWindow = null;
        }, { once: true });

        return pipWindow;
    })();

    try {
        return await openDocumentPiPWindowPromise;
    } finally {
        openDocumentPiPWindowPromise = null;
    }
}

/**
 * Closes the currently open Document PiP window, if any.
 *
 * @returns {void}
 */
export function closeDocumentPiPWindow(): void {
    documentPiPWindow?.close();
    documentPiPWindow = null;
}

/**
 * Requests picture-in-picture mode for the pip video element.
 *
 * NOTE: Called by Electron main process with userGesture: true.
 *
 * @returns {void}
 */
export function requestPictureInPicture() {
    const video = document.getElementById('pipVideo') as HTMLVideoElement;

    if (!video) {
        logger.error('PiP video element (#pipVideo) not found');

        return;
    }
    if (document.pictureInPictureElement) {
        logger.warn('Already in PiP mode');

        return;
    }

    // Check if video metadata is loaded.
    // readyState >= 1 (HAVE_METADATA) means video dimensions are available.
    if (video.readyState < 1) {
        logger.warn('Video metadata not loaded yet, waiting...');

        // Wait for metadata to load before requesting PiP.
        video.addEventListener('loadedmetadata', () => {
            // @ts-ignore - requestPictureInPicture is not yet in all TypeScript definitions.
            video.requestPictureInPicture().catch((err: Error) => {
                logger.error(`Error while requesting PiP after metadata loaded: ${err.message}`);
            });
        }, { once: true });

        return;
    }

    // @ts-ignore - requestPictureInPicture is not yet in all TypeScript definitions.
    video.requestPictureInPicture().catch((err: Error) => {
        logger.error(`Error while requesting PiP: ${err.message}`);
    });
}

/**
 * Action to enter Picture-in-Picture mode.
 * Handles both browser and Electron environments.
 *
 * @param {HTMLVideoElement} videoElement - The video element to call requestPictureInPicuture on.
 * @returns {void}
 */
export function enterPiP(videoElement: HTMLVideoElement | undefined | null) {
    if (!videoElement) {
        logger.error('PiP video element not found');

        return;
    }

    // Check if PiP is supported.
    if (!('pictureInPictureEnabled' in document)) {
        logger.error('Picture-in-Picture is not supported in this browser');

        return;
    }

    if (document.pictureInPictureEnabled === false) {
        logger.error('Picture-in-Picture is disabled');

        return;
    }

    try {
        // In Electron, use postMessage to request PiP from main process.
        // This bypasses the transient activation requirement by executing
        // requestPictureInPicture with userGesture: true in the main process.
        if (browser.isElectron()) {
            logger.log('Electron detected, sending postMessage to request PiP');

            APP.API.notifyPictureInPictureRequested();

            // State will be updated by enterpictureinpicture event.
            return;
        }

        // In browsers, call requestPictureInPicture directly (has transient
        // activation in most cases coming from a recent in-call interaction;
        // browsers that support the `autopictureinpicture` attribute will
        // also auto-invoke this without any script call as a guaranteed
        // fallback).
        // @ts-ignore - requestPictureInPicture is not yet in all TypeScript definitions.
        videoElement.requestPictureInPicture().catch((err: Error) => {
            logger.warn(`requestPictureInPicture failed, relying on autopictureinpicture fallback: ${err.message}`);
        });
    } catch (error) {
        logger.error('Error entering Picture-in-Picture:', error);
    }
}

/**
 * Sets up MediaSession API action handlers for controlling the conference.
 * Handlers dispatch actions that query fresh Redux state, avoiding stale closures.
 *
 * @param {Function} dispatch - Redux dispatch function.
 * @returns {void}
 */
export function setupMediaSessionHandlers(dispatch: IStore['dispatch']) {
    // @ts-ignore - MediaSession API is not fully typed in all environments.
    if ('mediaSession' in navigator && navigator.mediaSession?.setActionHandler) {
        try {
            // Set up audio mute toggle handler.
            // Dispatch action that will query current state and toggle.
            // @ts-ignore - togglemicrophone is a newer MediaSession action.
            navigator.mediaSession.setActionHandler('togglemicrophone', () => {
                dispatch(toggleAudioFromPiP());
            });

            // Set up video mute toggle handler.
            // Dispatch action that will query current state and toggle.
            // @ts-ignore - togglecamera is a newer MediaSession action.
            navigator.mediaSession.setActionHandler('togglecamera', () => {
                dispatch(toggleVideoFromPiP());
            });

            // Set up hangup handler.
            //
            // Desktop only, deliberately. On mobile the OS - not a PiP window
            // we control - owns the media notification and the lock screen,
            // and it surfaces whatever actions are registered. A stray tap on
            // one of those (or the OS invoking it while the page is
            // backgrounded, which is how opening a chat bubble over the
            // browser used to boot people out of the room) would leave the
            // conference with no confirmation and no way back. Mobile calls
            // are left through the in-call hangup button, nothing else.
            if (!isTouchFirstDevice()) {
                // @ts-ignore - hangup is a newer MediaSession action.
                navigator.mediaSession.setActionHandler('hangup', () => {
                    dispatch(leaveConference());
                });
            }

            logger.log('MediaSession API handlers registered for PiP controls');
        } catch (error) {
            logger.warn('Some MediaSession actions not supported:', error);
        }
    } else {
        logger.warn('MediaSession API not supported in this browser');
    }
}

/**
 * Updates the MediaSession API microphone and camera active state.
 * This ensures the PiP controls show the correct mute/unmute state.
 *
 * @param {IMediaSessionState} state - The current media session state.
 * @returns {void}
 */
export function updateMediaSessionState(state: IMediaSessionState) {
    if ('mediaSession' in navigator) {
        try {
            // @ts-ignore - setMicrophoneActive is a newer MediaSession method.
            if (navigator.mediaSession.setMicrophoneActive) {
                // @ts-ignore
                navigator.mediaSession.setMicrophoneActive(state.microphoneActive);
            }

            // @ts-ignore - setCameraActive is a newer MediaSession method.
            if (navigator.mediaSession.setCameraActive) {
                // @ts-ignore
                navigator.mediaSession.setCameraActive(state.cameraActive);
            }

            logger.log('MediaSession state updated:', state);
        } catch (error) {
            logger.warn('Error updating MediaSession state:', error);
        }
    }
}

/**
 * Cleans up MediaSession API action handlers.
 *
 * @returns {void}
 */
export function cleanupMediaSessionHandlers() {
    if ('mediaSession' in navigator) {
        try {
            // Note: Setting handlers to null is commented out as it may cause issues
            // in some browsers. The handlers will be overwritten when entering PiP again.
            // @ts-ignore - togglemicrophone is a newer MediaSession action.
            navigator.mediaSession.setActionHandler('togglemicrophone', null);
            // @ts-ignore - togglecamera is a newer MediaSession action.
            navigator.mediaSession.setActionHandler('togglecamera', null);
            // @ts-ignore - hangup is a newer MediaSession action.
            navigator.mediaSession.setActionHandler('hangup', null);
            logger.log('MediaSession API handlers cleaned up');
        } catch (error) {
            logger.error('Error cleaning up MediaSession handlers:', error);
        }
    }
}

// Re-export from shared file for external use.
export { isPiPEnabled };

