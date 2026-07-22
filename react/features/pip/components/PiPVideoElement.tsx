import React, { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IStore } from '../../app/types';
import { getAvatarFont, getAvatarInitialsColor } from '../../base/avatar/components/web/styles';
import { getDisplayNameColor } from '../../display-name/components/web/styles';
import { getThumbnailBackgroundColor } from '../../filmstrip/functions.web';
import { handlePiPLeaveEvent, handlePipEnterEvent, handleWindowBlur, handleWindowFocus } from '../actions';
import { useCanvasAvatar, usePiPParticipantAndTrack, usePiPTrackAttachment } from '../hooks';

const useStyles = makeStyles()(() => {
    return {
        hiddenVideo: {
            position: 'absolute' as const,
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none' as const,
            left: '-9999px',
            top: '-9999px'
        }
    };
});

/**
 * Component that renders a hidden video element for Picture-in-Picture.
 * Automatically switches between real video track and canvas-based avatar
 * depending on video availability.
 *
 * @returns {JSX.Element} The hidden video element.
 */
const PiPVideoElement: React.FC = () => {
    const { classes, theme } = useStyles();
    const videoRef = useRef<HTMLVideoElement>(null);

    const { customAvatarBackgrounds, displayName, participant, shouldShowAvatar, videoTrack } = usePiPParticipantAndTrack();

    const dispatch: IStore['dispatch'] = useDispatch();
    const avatarFont = getAvatarFont(theme);
    const fontFamily = (avatarFont as any).fontFamily ?? 'Inter, sans-serif';
    const initialsColor = getAvatarInitialsColor(theme);
    const displayNameColor = getDisplayNameColor(theme);
    const { canvasStreamRef } = useCanvasAvatar({
        participant,
        displayName,
        customAvatarBackgrounds,
        backgroundColor: getThumbnailBackgroundColor(theme),
        fontFamily,
        initialsColor,
        displayNameColor
    });

    // Attach/detach the real video track or canvas avatar stream to the video element.
    usePiPTrackAttachment(videoRef, videoTrack, shouldShowAvatar, canvasStreamRef);

    /**
     * Effect: Auto Picture-in-Picture entry + focus-to-exit.
     *
     * Entry is driven by the MediaSession 'enterpictureinpicture' action, NOT
     * by a 'blur'/'visibilitychange' listener. This is deliberate:
     * documentPictureInPicture.requestWindow() (and video.requestPictureInPicture())
     * require transient user activation, which a plain blur/visibility handler
     * does NOT have - so calling them there always rejected and silently fell
     * back to the bare classic video PiP (no controls), which is exactly the
     * "popout doesn't open properly" bug. The browser fires the
     * 'enterpictureinpicture' action WITH implicit transient activation when the
     * user switches away from the tab while capturing camera/mic, which is the
     * only reliable way to open Document PiP on tab switch (see
     * https://developer.chrome.com/blog/automatic-picture-in-picture).
     */
    useEffect(() => {
        const videoElement = videoRef.current;

        if (!videoElement) {
            return;
        }

        const onWindowFocus = () => {

            // In the use case where the PiP is closed by the 'X' or 'back to main window' buttons, this handler is
            // called before the leavepictureinpicture handler. From there we call document.exitPictureInPicture()
            // which seems to put Chrome into a weird state - document.exitPictureInPicture() never resolves, the
            // leavepictureinpicture is never triggered and it is not possible to display PiP again.
            // This is probably a browser bug. To workaround it we have the 100ms timeout here. This way this event
            // is triggered after the leavepictureinpicture event and everything seems to work well.
            setTimeout(() => {
                dispatch(handleWindowFocus());
            }, 100);
        };

        window.addEventListener('focus', onWindowFocus);

        // Register the browser Auto-PiP entry point. Runs with transient
        // activation, so handleWindowBlur's requestWindow()/requestPictureInPicture()
        // calls succeed. Falls back to the autopictureinpicture attribute on the
        // <video> below when the browser doesn't support this action.
        let enterPiPActionRegistered = false;

        if ('mediaSession' in navigator && navigator.mediaSession?.setActionHandler) {
            try {

                // @ts-ignore - 'enterpictureinpicture' is a newer MediaSession action not yet typed.
                navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
                    dispatch(handleWindowBlur(videoElement));
                });
                enterPiPActionRegistered = true;
            } catch (e) {

                // Action unsupported - the autopictureinpicture attribute is the fallback.
            }
        }

        return () => {
            window.removeEventListener('focus', onWindowFocus);

            if (enterPiPActionRegistered) {
                try {

                    // @ts-ignore - 'enterpictureinpicture' is a newer MediaSession action not yet typed.
                    navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
                } catch (e) {

                    // noop
                }
            }
        };
    }, [ dispatch ]);

    /**
     * Effect: PiP enter/leave event listeners.
     * Updates Redux state when browser PiP events occur.
     */
    useEffect(() => {
        const videoElement = videoRef.current;

        if (!videoElement) {
            return;
        }

        const onEnterPiP = () => {
            dispatch(handlePipEnterEvent());
        };
        const onLeavePiP = () => {
            dispatch(handlePiPLeaveEvent());
        };

        videoElement.addEventListener('enterpictureinpicture', onEnterPiP);
        videoElement.addEventListener('leavepictureinpicture', onLeavePiP);

        return () => {
            videoElement.removeEventListener('enterpictureinpicture', onEnterPiP);
            videoElement.removeEventListener('leavepictureinpicture', onLeavePiP);
        };
    }, [ dispatch ]);

    return (
        <video
            autoPlay = { true }

            // @ts-ignore - autopictureinpicture is not yet in React's DOM typings; must be
            // lowercase (or React emits an unrecognized literal attribute name) and a
            // string (React doesn't know it's boolean, so a JS `true` renders wrong).
            // eslint-plugin-react doesn't know this newer attribute and wrongly suggests
            // camelCase, which breaks it at runtime (confirmed via manual testing).
            // eslint-disable-next-line react/no-unknown-property
            autopictureinpicture = 'true'
            className = { classes.hiddenVideo }
            id = 'pipVideo'
            muted = { true }
            playsInline = { true }
            ref = { videoRef } />
    );
};

export default PiPVideoElement;
