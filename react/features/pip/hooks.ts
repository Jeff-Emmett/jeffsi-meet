import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../app/types';
import IconUserSVG from '../base/icons/svg/user.svg?raw';
import { getLocalParticipant, getParticipantDisplayName } from '../base/participants/functions';
import { IParticipant } from '../base/participants/types';
import { ITrack } from '../base/tracks/types';
import { isTrackStreamingStatusActive } from '../connection-indicator/functions';
import { TILE_ASPECT_RATIO } from '../filmstrip/constants';
import { getLargeVideoParticipant } from '../large-video/functions';
import { isPrejoinPageVisible } from '../prejoin/functions.any';

import { getPiPVideoTrack, renderAvatarOnCanvas } from './functions';
import logger from './logger';

/**
 * Result of {@link usePiPParticipantAndTrack}.
 */
export interface IUsePiPParticipantAndTrackResult {
    customAvatarBackgrounds: string[];
    displayName: string;
    participant: IParticipant | undefined;
    shouldShowAvatar: boolean;
    videoTrack: ITrack | undefined;
}

/**
 * Selects the participant, video track, and display name that any PiP
 * surface (classic video PiP or Document PiP) should render, along with
 * whether an avatar should be shown instead of live video. Shared so both
 * surfaces stay in sync about who/what is being shown.
 *
 * @returns {IUsePiPParticipantAndTrackResult}
 */
export function usePiPParticipantAndTrack(): IUsePiPParticipantAndTrackResult {
    const isOnPrejoin = useSelector(isPrejoinPageVisible);
    const localParticipant = useSelector(getLocalParticipant);
    const largeVideoParticipant = useSelector(getLargeVideoParticipant);
    const participant = isOnPrejoin ? localParticipant : largeVideoParticipant;

    const videoTrack = useSelector((state: IReduxState) =>
        getPiPVideoTrack(state, participant)
    );
    const displayName = useSelector((state: IReduxState) =>
        participant?.id
            ? getParticipantDisplayName(state, participant.id)
            : ''
    );
    const customAvatarBackgrounds = useSelector((state: IReduxState) =>
        state['features/dynamic-branding']?.avatarBackgrounds || []
    );

    const shouldShowAvatar = !videoTrack
        || videoTrack.muted
        || (!videoTrack.local && !isTrackStreamingStatusActive(videoTrack));

    return {
        customAvatarBackgrounds,
        displayName,
        participant,
        shouldShowAvatar,
        videoTrack
    };
}

/**
 * Attaches/detaches a video track (or canvas-avatar stream) to a video
 * element ref. Shared between the hidden classic-PiP video element and the
 * visible Document PiP mini video, which both need identical track-switching
 * behavior.
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef - Ref to the target video element.
 * @param {ITrack | undefined} videoTrack - The real video track, if any.
 * @param {boolean} shouldShowAvatar - Whether to show the canvas avatar instead.
 * @param {React.MutableRefObject<MediaStream | null>} canvasStreamRef - Ref to the canvas avatar stream.
 * @returns {void}
 */
export function usePiPTrackAttachment(
        videoRef: React.RefObject<HTMLVideoElement>,
        videoTrack: ITrack | undefined,
        shouldShowAvatar: boolean,
        canvasStreamRef: React.MutableRefObject<MediaStream | null>
) {
    const previousTrackRef = useRef<ITrack | undefined>(undefined);

    useEffect(() => {
        const videoElement = videoRef.current;

        if (!videoElement) {
            return;
        }

        const previousTrack = previousTrackRef.current;

        if (previousTrack?.jitsiTrack) {
            try {
                previousTrack.jitsiTrack.detach(videoElement);
            } catch (error) {
                logger.error('Error detaching previous track:', error);
            }
        }

        if (shouldShowAvatar) {
            const canvasStream = canvasStreamRef.current;

            if (canvasStream && videoElement.srcObject !== canvasStream) {
                videoElement.srcObject = canvasStream;
            }
        } else if (videoTrack?.jitsiTrack) {
            videoTrack.jitsiTrack.attach(videoElement)
                .catch((error: Error) => {
                    logger.error('Error attaching video track:', error);
                });
        }

        previousTrackRef.current = videoTrack;

        return () => {
            if (videoTrack?.jitsiTrack && videoElement) {
                try {
                    videoTrack.jitsiTrack.detach(videoElement);
                } catch (error) {
                    logger.error('Error during cleanup:', error);
                }
            }
        };
    }, [ videoTrack, shouldShowAvatar ]);
}

/**
 * Canvas dimensions for PiP avatar rendering.
 */
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = Math.floor(CANVAS_WIDTH / TILE_ASPECT_RATIO);

/**
 * Frame rate 0 means capture on-demand when canvas changes.
 * We manually request frames after drawing to ensure capture.
 */
const CANVAS_FRAME_RATE = 0;

/**
 * Options for the useCanvasAvatar hook.
 */
interface IUseCanvasAvatarOptions {
    backgroundColor: string;
    customAvatarBackgrounds: string[];
    displayName: string;
    displayNameColor: string;
    fontFamily: string;
    initialsColor: string;
    participant: IParticipant | undefined;
}

/**
 * Result returned by the useCanvasAvatar hook.
 * Returns a ref object so consumers can access .current inside effects
 * (the stream is created in an effect and won't be available at render time).
 */
interface IUseCanvasAvatarResult {
    canvasStreamRef: React.MutableRefObject<MediaStream | null>;
}

/**
 * Internal refs managed by the hook.
 */
interface ICanvasRefs {
    canvas: HTMLCanvasElement | null;
    defaultIcon: HTMLImageElement | null;
}

/**
 * Loads and prepares the default user icon SVG as an Image element.
 *
 * @returns {HTMLImageElement} The prepared image element.
 */
function createDefaultIconImage(): HTMLImageElement {
    let svgText = IconUserSVG;

    if (!svgText.includes('fill=')) {
        svgText = svgText.replace('<svg', '<svg fill="#FFFFFF"');
    }

    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svgText)
        .replace(/'/g, '%27')
        .replace(/"/g, '%22')}`;

    const img = new Image();

    img.src = dataUrl;

    return img;
}

/**
 * Custom hook that manages canvas-based avatar rendering for Picture-in-Picture.
 * Creates and maintains a canvas element with a MediaStream that can be used
 * as a video source when the participant's video is unavailable.
 *
 * @param {IUseCanvasAvatarOptions} options - The hook options.
 * @returns {IUseCanvasAvatarResult} The canvas stream for use as video source.
 */
export function useCanvasAvatar(options: IUseCanvasAvatarOptions): IUseCanvasAvatarResult {
    const {
        participant,
        displayName,
        customAvatarBackgrounds,
        backgroundColor,
        fontFamily,
        initialsColor,
        displayNameColor
    } = options;

    const refs = useRef<ICanvasRefs>({
        canvas: null,
        defaultIcon: null
    });

    // Separate ref for the stream to return to consumers.
    // This allows consumers to access .current inside their effects.
    //
    // NOTE: If we ever need to recreate the stream (e.g., different canvas size),
    // consumers' effects won't automatically re-run since refs don't trigger re-renders.
    // To fix this, we could return an additional state flag like `streamReady` that
    // changes when the stream is set, and consumers would add it to their effect deps.
    const streamRef = useRef<MediaStream | null>(null);

    /**
     * Initialize canvas, stream, and default icon on mount.
     */
    useEffect(() => {
        // Create canvas.
        const canvas = document.createElement('canvas');

        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;
        refs.current.canvas = canvas;

        // Create stream from canvas.
        streamRef.current = canvas.captureStream(CANVAS_FRAME_RATE);

        // Load default icon.
        refs.current.defaultIcon = createDefaultIconImage();

        logger.log('Canvas avatar initialized');

        // Cleanup on unmount.
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            refs.current.canvas = null;
            refs.current.defaultIcon = null;
            logger.log('Canvas avatar cleaned up');
        };
    }, []);

    /**
     * Re-render avatar when participant or display name changes.
     */
    useEffect(() => {
        const { canvas, defaultIcon } = refs.current;

        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');

        if (!ctx) {
            logger.error('Failed to get canvas 2D context');

            return;
        }

        renderAvatarOnCanvas(
            canvas,
            ctx,
            participant,
            displayName,
            customAvatarBackgrounds,
            defaultIcon,
            backgroundColor,
            fontFamily,
            initialsColor,
            displayNameColor
        ).then(() => {
            // Request a frame capture after drawing.
            // For captureStream(0), we need to manually trigger frame capture.
            const track = streamRef.current?.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void; };

            if (track?.requestFrame) {
                track.requestFrame();
                logger.log('Canvas frame requested after render');
            }
        }).catch((error: Error) => logger.error('Error rendering avatar on canvas:', error));
    }, [ participant?.loadableAvatarUrl, participant?.name, displayName, customAvatarBackgrounds, backgroundColor, fontFamily, initialsColor, displayNameColor ]);

    return {
        canvasStreamRef: streamRef
    };
}
