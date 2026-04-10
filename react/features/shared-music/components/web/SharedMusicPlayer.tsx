import React, { Component } from 'react';
import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { getLocalParticipant } from '../../../base/participants/functions';
import { SOURCE_TYPES } from '../../constants';
import { isSharingStatus } from '../../functions';
import { SourceType } from '../../types';

import DirectAudioManager from './DirectAudioManager';
import EmbedPlayerManager from './EmbedPlayerManager';
import YouTubeMusicManager from './YouTubeMusicManager';

interface IProps {

    /**
     * Whether music is currently being shared.
     */
    isMusicShared: boolean;

    /**
     * Whether the local participant is the owner.
     */
    isOwner: boolean;

    /**
     * The music URL.
     */
    musicUrl?: string;

    /**
     * The source type.
     */
    sourceType?: SourceType;
}

/**
 * Embedded source types that use iframe players.
 */
const EMBED_SOURCE_TYPES: readonly string[] = [
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

/**
 * Component that manages and renders the appropriate music player.
 */
class SharedMusicPlayer extends Component<IProps> {

    /**
     * Retrieves the manager to be used for playing the shared music.
     *
     * @returns {React.ReactNode}
     */
    getManager() {
        const { musicUrl, sourceType } = this.props;

        if (!musicUrl) {
            return null;
        }

        // YouTube has its own dedicated player
        if (sourceType === SOURCE_TYPES.YOUTUBE) {
            return <YouTubeMusicManager musicId = { musicUrl } />;
        }

        // Vimeo, SoundCloud, Spotify, Dailymotion, Twitch use iframe embeds
        if (sourceType && EMBED_SOURCE_TYPES.includes(sourceType)) {
            return <EmbedPlayerManager musicId = { musicUrl } />;
        }

        // Direct audio/video files use HTML5 audio element
        return <DirectAudioManager musicId = { musicUrl } />;
    }

    /**
     * Implements React's {@link Component#render()}.
     *
     * @inheritdoc
     * @returns {React.ReactNode}
     */
    override render() {
        const { isMusicShared } = this.props;

        if (!isMusicShared) {
            return null;
        }

        return (
            <div id = 'sharedMusic'>
                {this.getManager()}
            </div>
        );
    }
}

/**
 * Maps (parts of) the Redux state to the associated props.
 *
 * @param {Object} state - The Redux state.
 * @private
 * @returns {IProps}
 */
function _mapStateToProps(state: IReduxState) {
    const { musicUrl, ownerId, status, sourceType } = state['features/shared-music'];
    const localParticipant = getLocalParticipant(state);
    const isMusicShared = isSharingStatus(status ?? '');

    return {
        isMusicShared,
        isOwner: ownerId === localParticipant?.id,
        musicUrl,
        sourceType
    };
}

export default connect(_mapStateToProps)(SharedMusicPlayer);
