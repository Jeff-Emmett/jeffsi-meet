import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState, IStore } from '../../app/types';
import { getAvatarFont, getAvatarInitialsColor } from '../../base/avatar/components/web/styles';
import { leaveConference } from '../../base/conference/actions';
import Icon from '../../base/icons/components/Icon';
import {
    IconArrowBack,
    IconArrowDown,
    IconHangup,
    IconMessage,
    IconMic,
    IconMicSlash,
    IconScreenshare,
    IconSend,
    IconVideo,
    IconVideoOff
} from '../../base/icons/svg';
import JitsiMeetJS from '../../base/lib-jitsi-meet/_';
import { MEDIA_TYPE } from '../../base/media/constants';
import { isLocalTrackMuted } from '../../base/tracks/functions.any';
import { sendMessage } from '../../chat/actions.any';
import { MESSAGE_TYPE_LOCAL } from '../../chat/constants';
import { getMessageText, isChatDisabled } from '../../chat/functions';
import { getDisplayNameColor } from '../../display-name/components/web/styles';
import { getThumbnailBackgroundColor } from '../../filmstrip/functions.web';
import { startScreenShareFlow } from '../../screen-share/actions.web';
import { isScreenVideoShared } from '../../screen-share/functions';
import { isDesktopShareButtonDisabled } from '../../toolbox/functions.web';
import { exitDocumentPiP, toggleAudioFromPiP, toggleDocumentPiPMinimized, toggleVideoFromPiP } from '../actions';
import { getDocumentPiPWindow, getPiPChatMessages } from '../functions';
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
        videoWrapperWithChat: {
            flex: '0 0 40%'
        },
        chat: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column' as const,
            minHeight: 0,
            background: '#131519',
            borderTop: '1px solid rgba(255, 255, 255, 0.12)'
        },
        chatMessages: {
            flex: 1,
            overflowY: 'auto' as const,
            padding: '8px 10px',
            fontSize: '13px',
            lineHeight: '18px',
            color: '#fff',
            wordBreak: 'break-word' as const
        },
        chatEmpty: {
            color: '#9aa0a6',
            textAlign: 'center' as const,
            marginTop: '12px'
        },
        chatMessage: {
            marginBottom: '8px'
        },
        chatSender: {
            color: '#9aa0a6',
            fontSize: '12px',
            fontWeight: 600
        },
        chatForm: {
            display: 'flex',
            gap: '6px',
            padding: '6px 8px',
            borderTop: '1px solid rgba(255, 255, 255, 0.12)'
        },
        chatInput: {
            flex: 1,
            minWidth: 0,
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '13px',
            padding: '6px 8px',
            outline: 'none'
        },
        chatSend: {
            cursor: 'pointer',
            border: 0,
            borderRadius: '6px',
            background: '#246fe5',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px'
        },
        unreadDot: {
            position: 'absolute' as const,
            top: '2px',
            right: '2px',
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            background: '#e04b57'
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
            position: 'relative' as const,
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
        },
        toolbarButtonActive: {
            background: '#246fe5'
        },
        toolbarButtonDisabled: {
            opacity: 0.4,
            cursor: 'default'
        },
        toolbarButtonHangupArmed: {
            width: 'auto',
            padding: '0 12px',
            borderRadius: '18px',
            gap: '6px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            whiteSpace: 'nowrap' as const,
            boxShadow: '0 0 0 2px #fff inset'
        }
    };
});

/**
 * How long an armed popout hang-up waits for the confirming second click.
 */
const HANGUP_ARM_MS = 3000;

/**
 * Content portaled into the Document Picture-in-Picture window: a mini
 * video, the meeting chat (read and reply without returning to the tab), a
 * bottom toolbar (mic/camera/chat/hangup), and a top-right header (return to
 * tab / minimize).
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
    const screensharing = useSelector((state: IReduxState) => Boolean(isScreenVideoShared(state)));
    const canShareScreen = useSelector((state: IReduxState) =>
        JitsiMeetJS.isDesktopSharingEnabled() && !isDesktopShareButtonDisabled(state));

    const chatDisabled = useSelector(isChatDisabled);
    const allMessages = useSelector((state: IReduxState) => state['features/chat'].messages);
    const messages = useMemo(() => getPiPChatMessages(allMessages), [ allMessages ]);

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

    // Same flow as the toolbar's share button. The click happens in the popout,
    // and Chrome propagates that user activation to the opener, which is where
    // getDisplayMedia() actually runs.
    const handleToggleScreenshare = useCallback(() => {
        if (canShareScreen || screensharing) {
            dispatch(startScreenShareFlow(!screensharing));
        }
    }, [ dispatch, canShareScreen, screensharing ]);

    // The popout is a tiny window with hang-up right beside mic and camera, so
    // one mis-click ended the call. The first click only ARMS it ("Leave?");
    // a second click within HANGUP_ARM_MS leaves. The main toolbar's hang-up
    // stays a single tap on purpose (no "Leave meeting?" dialog there).
    const [ hangupArmed, setHangupArmed ] = useState(false);
    const disarmTimer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(disarmTimer.current), []);

    const handleHangup = useCallback(() => {
        if (hangupArmed) {
            window.clearTimeout(disarmTimer.current);
            setHangupArmed(false);
            dispatch(leaveConference());

            return;
        }
        setHangupArmed(true);
        window.clearTimeout(disarmTimer.current);
        disarmTimer.current = window.setTimeout(() => setHangupArmed(false), HANGUP_ARM_MS);
    }, [ dispatch, hangupArmed ]);

    // Chat starts open: the point of the popout is staying in the meeting
    // while working elsewhere, and that includes the conversation.
    const [ chatOpen, setChatOpen ] = useState(true);
    const [ draft, setDraft ] = useState('');
    const newestId = messages[messages.length - 1]?.messageId;
    const [ seenId, setSeenId ] = useState(newestId);
    const messagesRef = useRef<HTMLDivElement>(null);
    const showChat = chatOpen && !chatDisabled;

    useEffect(() => {
        if (showChat) {
            setSeenId(newestId);
            messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
        }
    }, [ showChat, newestId ]);

    const handleToggleChat = useCallback(() => {
        setChatOpen(open => !open);
    }, []);

    const handleDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setDraft(e.target.value);
    }, []);

    const handleSend = useCallback((e: React.FormEvent) => {
        e.preventDefault();

        const text = draft.trim();

        if (text) {
            dispatch(sendMessage(text));
            setDraft('');
        }
    }, [ dispatch, draft ]);

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
                className = { `${classes.videoWrapper} ${showChat && !isMinimized ? classes.videoWrapperWithChat : ''}` }
                onClick = { isMinimized ? handleToggleMinimize : undefined }>
                <video
                    autoPlay = { true }
                    className = { classes.video }
                    muted = { true }
                    playsInline = { true }
                    ref = { videoRef } />
            </div>
            {showChat && !isMinimized && (
                <div className = { classes.chat }>
                    <div
                        className = { classes.chatMessages }
                        ref = { messagesRef }>
                        {messages.length === 0 && <div className = { classes.chatEmpty }>No messages yet</div>}
                        {messages.map(m => (
                            <div
                                className = { classes.chatMessage }
                                key = { m.messageId }>
                                <div className = { classes.chatSender }>
                                    {m.messageType === MESSAGE_TYPE_LOCAL ? 'You' : m.displayName}
                                    {m.privateMessage ? ' (private)' : ''}
                                </div>
                                <div>{getMessageText(m)}</div>
                            </div>
                        ))}
                    </div>
                    <form
                        className = { classes.chatForm }
                        onSubmit = { handleSend }>
                        <input
                            aria-label = 'Message'
                            className = { classes.chatInput }
                            onChange = { handleDraftChange }
                            placeholder = 'Message everyone'
                            value = { draft } />
                        <button
                            aria-label = 'Send'
                            className = { classes.chatSend }
                            type = 'submit'>
                            <Icon
                                color = '#fff'
                                size = { 16 }
                                src = { IconSend } />
                        </button>
                    </form>
                </div>
            )}
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
                        className = { `${classes.toolbarButton} ${screensharing ? classes.toolbarButtonActive : ''} ${
                            canShareScreen || screensharing ? '' : classes.toolbarButtonDisabled}` }
                        onClick = { handleToggleScreenshare }
                        title = { screensharing ? 'Stop sharing your screen' : 'Share your screen' }>
                        <Icon
                            ariaLabel = { screensharing ? 'Stop sharing your screen' : 'Share your screen' }
                            color = '#fff'
                            size = { 18 }
                            src = { IconScreenshare } />
                    </div>
                    {!chatDisabled && (
                        <div
                            className = { `${classes.toolbarButton} ${showChat ? classes.toolbarButtonActive : ''}` }
                            onClick = { handleToggleChat }
                            title = { showChat ? 'Hide chat' : 'Show chat' }>
                            <Icon
                                ariaLabel = { showChat ? 'Hide chat' : 'Show chat' }
                                color = '#fff'
                                size = { 18 }
                                src = { IconMessage } />
                            {!showChat && newestId !== seenId && <span className = { classes.unreadDot } />}
                        </div>
                    )}
                    <div
                        className = { `${classes.toolbarButton} ${classes.toolbarButtonHangup} ${
                            hangupArmed ? classes.toolbarButtonHangupArmed : ''}` }
                        onClick = { handleHangup }
                        title = { hangupArmed ? 'Click again to leave' : 'Leave call' }>
                        <Icon
                            ariaLabel = { hangupArmed ? 'Click again to leave the call' : 'Leave call' }
                            color = '#fff'
                            size = { 18 }
                            src = { IconHangup } />
                        {hangupArmed && <span>Leave?</span>}
                    </div>
                </div>
            )}
        </div>,
        container
    );
};

export default DocumentPiPContent;
