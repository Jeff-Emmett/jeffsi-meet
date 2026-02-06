import React from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import {
    formatTime,
    getMeetingIntelligenceState,
    getSpeakerColor,
    getUniqueSpeakers,
    groupSegmentsBySpeaker
} from '../../functions';

/**
 * Transcript viewer component with speaker labels.
 *
 * @returns {React.ReactElement} The transcript viewer component.
 */
const TranscriptViewer: React.FC = () => {
    const { transcript, transcriptLoading, transcriptError, selectedMeeting } = useSelector(
        (state: IReduxState) => getMeetingIntelligenceState(state)
    );

    if (transcriptLoading) {
        return (
            <div className = 'transcript-loading'>
                <div className = 'spinner' />
                <span>Loading transcript...</span>
            </div>
        );
    }

    if (transcriptError) {
        return (
            <div className = 'transcript-error'>
                <p>Failed to load transcript: {transcriptError}</p>
            </div>
        );
    }

    if (!transcript || transcript.length === 0) {
        const isProcessing = selectedMeeting?.status !== 'ready' && selectedMeeting?.status !== 'failed';

        return (
            <div className = 'transcript-empty'>
                {isProcessing ? (
                    <>
                        <div className = 'spinner' />
                        <h3>Transcript in progress</h3>
                        <p>The transcript is being generated. Please check back soon.</p>
                    </>
                ) : (
                    <>
                        <svg
                            fill = 'currentColor'
                            height = '48'
                            viewBox = '0 0 24 24'
                            width = '48'>
                            <path d = 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' />
                        </svg>
                        <h3>No transcript available</h3>
                        <p>This meeting does not have a transcript yet.</p>
                    </>
                )}
            </div>
        );
    }

    const speakerLabels = getUniqueSpeakers(transcript);
    const groupedSegments = groupSegmentsBySpeaker(transcript);

    return (
        <div className = 'transcript-viewer'>
            <div className = 'transcript-speakers'>
                {speakerLabels.map(speaker => (
                    <span
                        className = 'speaker-tag'
                        key = { speaker }
                        style = {{ backgroundColor: getSpeakerColor(speaker, speakerLabels) }}>
                        {speaker}
                    </span>
                ))}
            </div>

            <div className = 'transcript-segments'>
                {groupedSegments.map((group, groupIndex) => (
                    <div
                        className = 'transcript-group'
                        key = { groupIndex }>
                        <div
                            className = 'transcript-speaker'
                            style = {{ color: getSpeakerColor(group.speaker, speakerLabels) }}>
                            {group.speaker}
                            <span className = 'transcript-time'>
                                {formatTime(group.segments[0].start_time)}
                            </span>
                        </div>
                        <div className = 'transcript-text'>
                            {group.segments.map(segment => segment.text).join(' ')}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TranscriptViewer;
