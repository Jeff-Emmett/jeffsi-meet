import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState, IStore } from '../../app/types';
import { getAvatarFont, getAvatarInitialsColor } from '../../base/avatar/components/web/styles';
import { leaveConference } from '../../base/conference/actions';
import Icon from '../../base/icons/components/Icon';
import { IconArrowBack, IconArrowDown, IconHangup, IconMic, IconMicSlash, IconVideo, IconVideoOff } from '../../base/icons/svg';
import { MEDIA_TYPE } from '../../base/media/constants';
import { isLocalTrackMuted } from '../../base/tracks/functions.any';
import { getDisplayNameColor } from '../../display-name/components/web/styles';
import { getThumbnailBackgroundColor } from '../../filmstrip/functions.web';
import { exitDocumentPiP, toggleAudioFromPiP, toggleDocumentPiPMinimized, toggleVideoFromPiP } from '../actions';
import { getDocumentPiPWindow } from '../functions';
import { useCanvasAvatar, usePiPParticipantAndTrack, usePiPTrackAttachment } from '../hooks';

const useStyles = makeStyles()(() => {
    return {
        root: {
            display: 'flex',
            flexDirection: 'column' as const,
            width: '100%',
            height: '100%',
            background: '#000',
            overflow: 'hidden'
        },
        header: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '4px',
            padding: '4px',
            flexShrink: 0
        },
        headerButton: {
            cursor: 'pointer',
            borderRadius: '4px',
            padding: '4px',
            background: 'rgba(0, 0, 0, 0.4)',

            '&:hover': {
                background: 'rgba(0, 0, 0, 0.6)'
            }
        },
        videoWrapper: {
            flex: 1,
            position: 'relative' as const,
            minHeight: 0
        },
        video: {
            width: '100%',
            height: '100%',
            objectFit: 'cover' as const
        },
        toolbar: {
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            padding: '8px',
            background: 'rgba(0, 0, 0, 0.6)',
            flexShrink: 0
        },
        toolbarButton: {
            cursor: 'pointer',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255, 255, 255, 0.15)',

            '&:hover': {
                background: 'rgba(255, 255, 255, 0.25)'
            }
        },
        toolbarButtonMuted: {
            background: '#e04b57'
        },
        toolbarButtonHangup: {
            background: '#e04b57'
        }
    };
});

/**
 * Content portaled into the Document Picture-in-Picture window: a mini
 * video, a bottom toolbar (mic/camera/hangup), and a top-right header
 * (return to tab / minimize).
 *
 * @returns {React.ReactPortal | null}
 */
const DocumentPiPContent: React.FC = () => {
    const { classes, theme } = useStyles();
    const dispatch: IStore['dispatch'] = useDispatch();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [ container, setContainer ] = useState<HTMLElement | null>(null);

    const isMinimized = useSelector((state: IReduxState) => state['features/pip']?.isDocumentPiPMinimized);
    const audioMuted = useSelector((state: IReduxState) =>
        isLocalTrackMuted(state['features/base/tracks'], MEDIA_TYPE.AUDIO));
    const videoMuted = useSelector((state: IReduxState) =>
        isLocalTrackMuted(state['features/base/tracks'], MEDIA_TYPE.VIDEO));

    const { customAvatarBackgrounds, displayName, participant, shouldShowAvatar, videoTrack } = usePiPParticipantAndTrack();

    const avatarFont = getAvatarFont(theme);
    const fontFamily = (avatarFont as any).fontFamily ?? 'Inter, sans-serif';
    const { canvasStreamRef } = useCanvasAvatar({
        participant,
        displayName,
        customAvatarBackgrounds,
        backgroundColor: getThumbnailBackgroundColor(theme),
        fontFamily,
        initialsColor: getAvatarInitialsColor(theme),
        displayNameColor: getDisplayNameColor(theme)
    });

    usePiPTrackAttachment(videoRef, videoTrack, shouldShowAvatar, canvasStreamRef);

    /**
     * Grabs the open Document PiP window's body as the portal target, and
     * makes sure closing the popout (native 'X', OS close, etc.) syncs
     * Redux state back.
     */
    useEffect(() => {
        const pipWindow = getDocumentPiPWindow();

        if (!pipWindow) {
            return;
        }

        setContainer(pipWindow.document.body);

        const onPageHide = () => dispatch(exitDocumentPiP());

        pipWindow.addEventListener('pagehide', onPageHide);

        return () => pipWindow.removeEventListener('pagehide', onPageHide);
    }, [ dispatch ]);

    const handleReturnToTab = useCallback(() => {
        window.focus();
        dispatch(exitDocumentPiP());
    }, [ dispatch ]);

    const handleToggleMinimize = useCallback(() => {
        dispatch(toggleDocumentPiPMinimized());
    }, [ dispatch ]);

    const handleToggleAudio = useCallback(() => {
        dispatch(toggleAudioFromPiP());
    }, [ dispatch ]);

    const handleToggleVideo = useCallback(() => {
        dispatch(toggleVideoFromPiP());
    }, [ dispatch ]);

    const handleHangup = useCallback(() => {
        dispatch(leaveConference());
    }, [ dispatch ]);

    if (!container) {
        return null;
    }

    return ReactDOM.createPortal(
        <div className = { classes.root }>
            <div className = { classes.header }>
                <div
                    className = { classes.headerButton }
                    onClick = { handleToggleMinimize }>
                    <Icon
                        ariaLabel = 'Minimize'
                        size = { 18 }
                        src = { IconArrowDown } />
                </div>
                <div
                    className = { classes.headerButton }
                    onClick = { handleReturnToTab }>
                    <Icon
                        ariaLabel = 'Return to tab'
                        size = { 18 }
                        src = { IconArrowBack } />
                </div>
            </div>
            <div
                className = { classes.videoWrapper }
                onClick = { isMinimized ? handleToggleMinimize : undefined }>
                <video
                    autoPlay = { true }
                    className = { classes.video }
                    muted = { true }
                    playsInline = { true }
                    ref = { videoRef } />
            </div>
            {!isMinimized && (
                <div className = { classes.toolbar }>
                    <div
                        className = { `${classes.toolbarButton} ${audioMuted ? classes.toolbarButtonMuted : ''}` }
                        onClick = { handleToggleAudio }>
                        <Icon
                            ariaLabel = 'Toggle microphone'
                            color = '#fff'
                            size = { 18 }
                            src = { audioMuted ? IconMicSlash : IconMic } />
                    </div>
                    <div
                        className = { `${classes.toolbarButton} ${videoMuted ? classes.toolbarButtonMuted : ''}` }
                        onClick = { handleToggleVideo }>
                        <Icon
                            ariaLabel = 'Toggle camera'
                            color = '#fff'
                            size = { 18 }
                            src = { videoMuted ? IconVideoOff : IconVideo } />
                    </div>
                    <div
                        className = { `${classes.toolbarButton} ${classes.toolbarButtonHangup}` }
                        onClick = { handleHangup }>
                        <Icon
                            ariaLabel = 'Leave call'
                            color = '#fff'
                            size = { 18 }
                            src = { IconHangup } />
                    </div>
                </div>
            )}
        </div>,
        container
    );
};

export default DocumentPiPContent;
