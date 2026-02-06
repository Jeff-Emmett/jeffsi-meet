import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { selectMeeting } from '../../actions';
import { formatDate, formatDuration, getMeetingIntelligenceState, getStatusColor, getStatusLabel } from '../../functions';

/**
 * List of meeting recordings.
 *
 * @returns {React.ReactElement} The recordings list component.
 */
const RecordingsList: React.FC = () => {
    const dispatch = useDispatch();
    const { meetings, meetingsLoading, meetingsError } = useSelector(
        (state: IReduxState) => getMeetingIntelligenceState(state)
    );

    const handleSelectMeeting = useCallback((e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
        const meetingId = e.currentTarget.dataset.meetingId;

        if (meetingId) {
            dispatch(selectMeeting(meetingId) as any);
        }
    }, [ dispatch ]);

    if (meetingsLoading) {
        return (
            <div className = 'recordings-loading'>
                <div className = 'spinner' />
                <span>Loading recordings...</span>
            </div>
        );
    }

    if (meetingsError) {
        return (
            <div className = 'recordings-error'>
                <p>Failed to load recordings: {meetingsError}</p>
            </div>
        );
    }

    if (meetings.length === 0) {
        return (
            <div className = 'recordings-empty'>
                <svg
                    fill = 'currentColor'
                    height = '48'
                    viewBox = '0 0 24 24'
                    width = '48'>
                    <path d = 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' />
                </svg>
                <h3>No recordings yet</h3>
                <p>Recordings will appear here after you record a meeting.</p>
            </div>
        );
    }

    return (
        <div className = 'recordings-list'>
            {meetings.map(meeting => (
                <div
                    className = 'recording-item'
                    data-meeting-id = { meeting.id }
                    key = { meeting.id }
                    onClick = { handleSelectMeeting }
                    onKeyDown = { handleSelectMeeting }
                    role = 'button'
                    tabIndex = { 0 }>
                    <div className = 'recording-item-icon'>
                        <svg
                            fill = 'currentColor'
                            height = '32'
                            viewBox = '0 0 24 24'
                            width = '32'>
                            <path d = 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' />
                        </svg>
                    </div>
                    <div className = 'recording-item-info'>
                        <div className = 'recording-item-title'>
                            {meeting.title || meeting.conference_id}
                        </div>
                        <div className = 'recording-item-meta'>
                            {meeting.started_at && (
                                <span className = 'recording-date'>
                                    {formatDate(meeting.started_at)}
                                </span>
                            )}
                            {meeting.duration_seconds && (
                                <span className = 'recording-duration'>
                                    {formatDuration(meeting.duration_seconds)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className = 'recording-item-status'>
                        <span
                            className = 'status-badge'
                            style = {{ backgroundColor: getStatusColor(meeting.status) }}>
                            {getStatusLabel(meeting.status)}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default RecordingsList;
