import React, { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import {
    clearSelectedMeeting,
    fetchMeetings,
    setActiveTab,
    toggleMeetingIntelligence
} from '../../actions';
import { getMeetingIntelligenceState } from '../../functions';

import RecordingsList from './RecordingsList';
import SearchPanel from './SearchPanel';
import SummaryPanel from './SummaryPanel';
import TranscriptViewer from './TranscriptViewer';

/**
 * Meeting Intelligence Dashboard side panel.
 *
 * @returns {React.ReactElement|null} The dashboard or null if closed.
 */
const MeetingIntelligenceDashboard: React.FC = () => {
    const dispatch = useDispatch();
    const {
        isOpen,
        activeTab,
        selectedMeeting
    } = useSelector((state: IReduxState) => getMeetingIntelligenceState(state));

    // Fetch meetings on open
    useEffect(() => {
        if (isOpen) {
            dispatch(fetchMeetings() as any);
        }
    }, [ dispatch, isOpen ]);

    const handleClose = useCallback(() => {
        dispatch(toggleMeetingIntelligence());
    }, [ dispatch ]);

    const handleBack = useCallback(() => {
        dispatch(clearSelectedMeeting());
    }, [ dispatch ]);

    const handleTranscriptTab = useCallback(() => {
        dispatch(setActiveTab('transcript'));
    }, [ dispatch ]);

    const handleSummaryTab = useCallback(() => {
        dispatch(setActiveTab('summary'));
    }, [ dispatch ]);

    const handleRecordingsTab = useCallback(() => {
        dispatch(setActiveTab('recordings'));
    }, [ dispatch ]);

    const handleSearchTab = useCallback(() => {
        dispatch(setActiveTab('search'));
    }, [ dispatch ]);

    if (!isOpen) {
        return null;
    }

    return (
        <div className = 'meeting-intelligence-dashboard'>
            <div className = 'meeting-intelligence-header'>
                <div className = 'meeting-intelligence-header-left'>
                    {selectedMeeting && (
                        <button
                            className = 'meeting-intelligence-back-btn'
                            onClick = { handleBack }
                            type = 'button'>
                            <svg
                                fill = 'currentColor'
                                height = '20'
                                viewBox = '0 0 24 24'
                                width = '20'>
                                <path d = 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z' />
                            </svg>
                        </button>
                    )}
                    <h2>Meeting Intelligence</h2>
                </div>
                <button
                    className = 'meeting-intelligence-close-btn'
                    onClick = { handleClose }
                    type = 'button'>
                    <svg
                        fill = 'currentColor'
                        height = '24'
                        viewBox = '0 0 24 24'
                        width = '24'>
                        <path d = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' />
                    </svg>
                </button>
            </div>

            {selectedMeeting ? (
                <>
                    <div className = 'meeting-intelligence-tabs'>
                        <button
                            className = { `tab-btn ${activeTab === 'transcript' ? 'active' : ''}` }
                            onClick = { handleTranscriptTab }
                            type = 'button'>
                            Transcript
                        </button>
                        <button
                            className = { `tab-btn ${activeTab === 'summary' ? 'active' : ''}` }
                            onClick = { handleSummaryTab }
                            type = 'button'>
                            Summary
                        </button>
                    </div>

                    <div className = 'meeting-intelligence-content'>
                        {activeTab === 'transcript' && <TranscriptViewer />}
                        {activeTab === 'summary' && <SummaryPanel />}
                    </div>
                </>
            ) : (
                <>
                    <div className = 'meeting-intelligence-tabs'>
                        <button
                            className = { `tab-btn ${activeTab === 'recordings' ? 'active' : ''}` }
                            onClick = { handleRecordingsTab }
                            type = 'button'>
                            Recordings
                        </button>
                        <button
                            className = { `tab-btn ${activeTab === 'search' ? 'active' : ''}` }
                            onClick = { handleSearchTab }
                            type = 'button'>
                            Search
                        </button>
                    </div>

                    <div className = 'meeting-intelligence-content'>
                        {activeTab === 'recordings' && <RecordingsList />}
                        {activeTab === 'search' && <SearchPanel />}
                    </div>
                </>
            )}
        </div>
    );
};

export default MeetingIntelligenceDashboard;
