import React from 'react';
import { connect } from 'react-redux';

import { IReduxState } from '../../../app/types';
import AudioTrack from '../../../base/media/components/web/AudioTrack';
import { MEDIA_TYPE } from '../../../base/media/constants';
import { isRecordingOptedOut } from '../../../base/participants/functions';
import { ITrack } from '../../../base/tracks/types';

/**
 * The type of the React {@code Component} props of {@link AudioTracksContainer}.
 */
interface IProps {

    /**
     * Comma-joined ids of participants whose audio a recorder (Jibri) must not
     * play, because they opted out of recording. A string so connect() only
     * re-renders when the set actually changes.
     */
    _excluded: string;

    /**
     * All media tracks stored in redux.
     */
    _tracks: ITrack[];
}

/**
 * A container for the remote tracks audio elements.
 *
 * @param {IProps} props - The props of the component.
 * @returns {Array<ReactElement>}
 */
function AudioTracksContainer(props: IProps) {
    const { _excluded, _tracks } = props;
    const excluded = new Set(_excluded.split(','));
    const remoteAudioTracks = _tracks.filter(t => !t.local && t.mediaType === MEDIA_TYPE.AUDIO
        && !excluded.has(t.participantId));

    return (
        <div>
            {
                remoteAudioTracks.map(t => {
                    const { jitsiTrack, participantId } = t;
                    const audioTrackId = jitsiTrack?.getId();
                    const id = `remoteAudio_${audioTrackId || ''}`;

                    return (
                        <AudioTrack
                            audioTrack = { t }
                            id = { id }
                            key = { id }
                            participantId = { participantId } />
                    );
                })
            }
        </div>
    );
}

/**
 * Maps (parts of) the Redux state to the associated {@code AudioTracksContainer}'s props.
 *
 * @param {Object} state - The Redux state.
 * @private
 * @returns {IProps}
 */
function _mapStateToProps(state: IReduxState) {
    // NOTE: The disadvantage of this approach is that the component will re-render on any track change.
    // One way to solve the problem would be to pass only the participant ID to the AudioTrack component and
    // find the corresponding track inside the AudioTrack's mapStateToProps. But currently this will be very
    // inefficient because features/base/tracks is an array and in order to find a track by participant ID
    // we need to go through the array. Introducing a map participantID -> track could be beneficial in this case.
    const tracks = state['features/base/tracks'];

    // Jibri records what this page plays, so opted-out people are simply not played.
    const excluded = state['features/base/config'].iAmRecorder
        ? tracks.filter(t => isRecordingOptedOut(state, t.participantId)).map(t => t.participantId)
            .join(',')
        : '';

    return {
        _excluded: excluded,
        _tracks: tracks
    };
}

export default connect(_mapStateToProps)(AudioTracksContainer);
