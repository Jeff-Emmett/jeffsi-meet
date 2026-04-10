import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { IconPlay, IconStop } from '../../../base/icons/svg';
import { getLocalParticipant } from '../../../base/participants/functions';
import { setSharedMusicStatus } from '../../actions';
import { PLAYBACK_STATUSES, SOURCE_TYPES } from '../../constants';
import { isSharingStatus } from '../../functions';

import SharedMusicPlayer from './SharedMusicPlayer';

/**
 * Source types that render video content (should show iframe player).
 */
const VIDEO_SOURCE_TYPES: readonly string[] = [
    SOURCE_TYPES.YOUTUBE,
    SOURCE_TYPES.VIMEO,
    SOURCE_TYPES.DAILYMOTION,
    SOURCE_TYPES.TWITCH
];

/**
 * Source types that have embedded controls (user interacts with iframe).
 */
const EMBEDDED_CONTROL_TYPES: readonly string[] = [
    SOURCE_TYPES.YOUTUBE,
    SOURCE_TYPES.VIMEO,
    SOURCE_TYPES.SOUNDCLOUD,
    SOURCE_TYPES.SPOTIFY,
    SOURCE_TYPES.DAILYMOTION,
    SOURCE_TYPES.TWITCH,
    SOURCE_TYPES.APPLE_MUSIC,
    SOURCE_TYPES.DEEZER,
    SOURCE_TYPES.TIDAL,
    SOURCE_TYPES.BANDCAMP
];

interface IProps {
    /**
     * The participant ID (music URL).
     */
    participantId: string;
}

/**
 * Component that renders a shared music tile with the actual video player.
 * This is displayed in the filmstrip thumbnail for shared music.
 *
 * @param {IProps} props - The component props.
 * @returns {React.ReactElement | null}
 */
const SharedMusicTile: React.FC<IProps> = ({ participantId }) => {
    const dispatch = useDispatch();

    const { musicUrl, ownerId, status, sourceType, time, title } = useSelector(
        (state: IReduxState) => state['features/shared-music']
    );
    const localParticipant = useSelector((state: IReduxState) => getLocalParticipant(state));

    const isOwner = ownerId === localParticipant?.id;
    const isMusicShared = isSharingStatus(status ?? '');
    const isPlaying = status === PLAYBACK_STATUSES.PLAYING;

    // Determine if this source type shows video content
    const isVideoSource = sourceType && VIDEO_SOURCE_TYPES.includes(sourceType);

    // Determine if this source type has embedded controls (so we don't show our own)
    const hasEmbeddedControls = sourceType && EMBEDDED_CONTROL_TYPES.includes(sourceType);

    const handlePlayPause = useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent thumbnail click from pinning

        if (!isOwner || !musicUrl) {
            return; // Only owner can control playback, and musicUrl must exist
        }

        const newStatus = isPlaying ? PLAYBACK_STATUSES.PAUSED : PLAYBACK_STATUSES.PLAYING;

        dispatch(setSharedMusicStatus({
            musicUrl,
            status: newStatus,
            time: time ?? 0,
            ownerId,
            sourceType
        }));
    }, [ dispatch, isOwner, isPlaying, musicUrl, ownerId, sourceType, time ]);

    if (!isMusicShared || participantId !== musicUrl) {
        return null;
    }

    return (
        <div className = 'shared-music-tile'>
            {/* Render the actual player for video sources */}
            {isVideoSource || hasEmbeddedControls ? (
                <div className = 'shared-music-player-wrapper'>
                    <SharedMusicPlayer />
                </div>
            ) : (
                /* For direct audio files, show a background with controls */
                <div className = 'shared-music-audio-bg'>
                    <SharedMusicPlayer />
                </div>
            )}

            {/* Overlay with title and controls */}
            <div className = 'shared-music-controls-overlay'>
                {/* Title */}
                <div className = 'shared-music-title'>
                    {title || 'Shared Media'}
                </div>

                {/* Play/Pause button (owner only, shown for direct audio without embedded controls) */}
                {isOwner && !hasEmbeddedControls && (
                    <button
                        aria-label = { isPlaying ? 'Pause' : 'Play' }
                        className = 'shared-music-control-button'
                        onClick = { handlePlayPause }
                        type = 'button'>
                        {isPlaying ? (
                            <IconStop />
                        ) : (
                            <IconPlay />
                        )}
                    </button>
                )}

                {/* Status indicator for non-owners when no embedded controls */}
                {!isOwner && !hasEmbeddedControls && (
                    <div className = 'shared-music-status'>
                        {isPlaying ? 'Playing' : 'Paused'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SharedMusicTile;
