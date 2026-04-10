import React from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { VIDEO_SOURCE_TYPES } from '../../constants';
import { getVideoEmbedUrl, getVideoSourceType, isVideoPlaying } from '../../functions';

interface IProps {

    /**
     * The participant ID (video URL or YouTube ID).
     */
    participantId: string;
}

/**
 * Component that renders a shared video tile in the filmstrip.
 * Displays the embedded video player inside the filmstrip thumbnail.
 *
 * @param {IProps} props - The component props.
 * @returns {React.ReactElement | null}
 */
const SharedVideoTile: React.FC<IProps> = ({ participantId }) => {
    const { videoUrl } = useSelector(
        (state: IReduxState) => state['features/shared-video']
    );
    const isShared = useSelector((state: IReduxState) => isVideoPlaying(state));

    if (!isShared || participantId !== videoUrl) {
        return null;
    }

    const sourceType = getVideoSourceType(videoUrl ?? '');

    const renderPlayer = () => {
        if (!videoUrl) {
            return null;
        }

        if (sourceType === VIDEO_SOURCE_TYPES.YOUTUBE) {
            // videoUrl is a YouTube ID (not a full URL) for YouTube videos
            const youtubeId = videoUrl.match(/^https?:\/\//) ? null : videoUrl;
            const embedId = youtubeId ?? videoUrl;

            return (
                <iframe
                    allow = 'autoplay; encrypted-media'
                    allowFullScreen = { true }
                    frameBorder = '0'
                    height = '100%'
                    src = { `https://www.youtube.com/embed/${embedId}?autoplay=1&controls=1&rel=0` }
                    title = 'Shared Video'
                    width = '100%' />
            );
        }

        if (sourceType === VIDEO_SOURCE_TYPES.VIMEO
            || sourceType === VIDEO_SOURCE_TYPES.DAILYMOTION
            || sourceType === VIDEO_SOURCE_TYPES.TWITCH) {
            const embedUrl = getVideoEmbedUrl(videoUrl, sourceType);

            return (
                <iframe
                    allow = 'autoplay; encrypted-media; fullscreen'
                    allowFullScreen = { true }
                    frameBorder = '0'
                    height = '100%'
                    src = { embedUrl }
                    title = 'Shared Video'
                    width = '100%' />
            );
        }

        // Direct video URL
        return (
            <video
                autoPlay = { true }
                controls = { true }
                height = '100%'
                src = { videoUrl }
                width = '100%'>
                <track kind = 'captions' />
            </video>
        );
    };

    return (
        <div className = 'shared-video-tile'>
            <div className = 'shared-video-player-wrapper'>
                {renderPlayer()}
            </div>
            <div className = 'shared-video-controls-overlay'>
                <div className = 'shared-video-title'>
                    {'Shared Video'}
                </div>
            </div>
        </div>
    );
};

export default SharedVideoTile;
