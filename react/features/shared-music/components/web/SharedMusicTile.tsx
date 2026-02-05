import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { IconPlay, IconStop } from '../../../base/icons/svg';
import { getLocalParticipant } from '../../../base/participants/functions';
import { setSharedMusicStatus } from '../../actions';
import { PLAYBACK_STATUSES, SOURCE_TYPES } from '../../constants';
import { isSharingStatus } from '../../functions';

import SharedMusicPlayer from './SharedMusicPlayer';

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
    const isYouTube = sourceType === SOURCE_TYPES.YOUTUBE;

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
            {/* Render the actual player for YouTube videos */}
            {isYouTube ? (
                <div className = 'shared-music-player-wrapper'>
                    <SharedMusicPlayer />
                </div>
            ) : (
                /* For audio-only, show a background with controls */
                <div className = 'shared-music-audio-bg'>
                    <SharedMusicPlayer />
                </div>
            )}

            {/* Overlay with title and controls for non-owners */}
            <div className = 'shared-music-controls-overlay'>
                {/* Title */}
                <div className = 'shared-music-title'>
                    {title || 'Shared Music'}
                </div>

                {/* Play/Pause button (owner only, shown when YouTube controls are hidden) */}
                {isOwner && !isYouTube && (
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

                {/* Status indicator for non-owners when not YouTube */}
                {!isOwner && !isYouTube && (
                    <div className = 'shared-music-status'>
                        {isPlaying ? 'Playing' : 'Paused'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SharedMusicTile;
