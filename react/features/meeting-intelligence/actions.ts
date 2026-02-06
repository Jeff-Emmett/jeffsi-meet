/**
 * Action creators for Meeting Intelligence feature.
 */

import { IStore } from '../app/types';

import {
    CLEAR_SEARCH,
    CLEAR_SELECTED_MEETING,
    EXPORT_FAILURE,
    EXPORT_REQUEST,
    EXPORT_SUCCESS,
    FETCH_MEETINGS_FAILURE,
    FETCH_MEETINGS_REQUEST,
    FETCH_MEETINGS_SUCCESS,
    FETCH_SPEAKER_STATS_SUCCESS,
    FETCH_SUMMARY_FAILURE,
    FETCH_SUMMARY_REQUEST,
    FETCH_SUMMARY_SUCCESS,
    FETCH_TRANSCRIPT_FAILURE,
    FETCH_TRANSCRIPT_REQUEST,
    FETCH_TRANSCRIPT_SUCCESS,
    GENERATE_SUMMARY_FAILURE,
    GENERATE_SUMMARY_REQUEST,
    GENERATE_SUMMARY_SUCCESS,
    SEARCH_FAILURE,
    SEARCH_REQUEST,
    SEARCH_SUCCESS,
    SELECT_MEETING,
    SET_ACTIVE_TAB,
    SET_EXPORT_FORMAT,
    SET_SEARCH_QUERY,
    TOGGLE_MEETING_INTELLIGENCE,
    UPDATE_MEETING_STATUS
} from './actionTypes';
import { API_BASE_URL } from './constants';
import {
    IMeeting,
    IMeetingSummary,
    ISearchResult,
    ISpeakerStats,
    ITranscriptSegment
} from './types';

/**
 * Toggle the meeting intelligence dashboard.
 *
 * @returns {Object} The action object.
 */
export function toggleMeetingIntelligence() {
    return {
        type: TOGGLE_MEETING_INTELLIGENCE
    };
}

/**
 * Set the active tab.
 *
 * @param {string} tab - The tab to set active.
 * @returns {Object} The action object.
 */
export function setActiveTab(tab: 'recordings' | 'transcript' | 'summary' | 'search') {
    return {
        type: SET_ACTIVE_TAB,
        tab
    };
}

/**
 * Select a meeting for detailed view.
 *
 * @param {string} meetingId - The meeting ID to select.
 * @returns {Function} Async thunk action.
 */
export function selectMeeting(meetingId: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: SELECT_MEETING, meetingId });

        // Fetch transcript and summary for the selected meeting
        dispatch(fetchTranscript(meetingId));
        dispatch(fetchSummary(meetingId));
        dispatch(fetchSpeakerStats(meetingId));
    };
}

/**
 * Clear the selected meeting.
 *
 * @returns {Object} The action object.
 */
export function clearSelectedMeeting() {
    return {
        type: CLEAR_SELECTED_MEETING
    };
}

/**
 * Fetch the list of meetings.
 *
 * @returns {Function} Async thunk action.
 */
export function fetchMeetings() {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: FETCH_MEETINGS_REQUEST });

        try {
            const response = await fetch(`${API_BASE_URL}/meetings`);

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            dispatch({
                type: FETCH_MEETINGS_SUCCESS,
                meetings: data.meetings as IMeeting[]
            });
        } catch (error) {
            dispatch({
                type: FETCH_MEETINGS_FAILURE,
                error: error instanceof Error ? error.message : 'Failed to fetch meetings'
            });
        }
    };
}

/**
 * Fetch transcript for a meeting.
 *
 * @param {string} meetingId - The meeting ID.
 * @returns {Function} Async thunk action.
 */
export function fetchTranscript(meetingId: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: FETCH_TRANSCRIPT_REQUEST });

        try {
            const response = await fetch(`${API_BASE_URL}/meetings/${meetingId}/transcript`);

            if (!response.ok) {
                if (response.status === 404) {
                    dispatch({
                        type: FETCH_TRANSCRIPT_SUCCESS,
                        transcript: []
                    });

                    return;
                }
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            dispatch({
                type: FETCH_TRANSCRIPT_SUCCESS,
                transcript: data.segments as ITranscriptSegment[]
            });
        } catch (error) {
            dispatch({
                type: FETCH_TRANSCRIPT_FAILURE,
                error: error instanceof Error ? error.message : 'Failed to fetch transcript'
            });
        }
    };
}

/**
 * Fetch summary for a meeting.
 *
 * @param {string} meetingId - The meeting ID.
 * @returns {Function} Async thunk action.
 */
export function fetchSummary(meetingId: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: FETCH_SUMMARY_REQUEST });

        try {
            const response = await fetch(`${API_BASE_URL}/meetings/${meetingId}/summary`);

            if (!response.ok) {
                if (response.status === 404) {
                    dispatch({
                        type: FETCH_SUMMARY_SUCCESS,
                        summary: null
                    });

                    return;
                }
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            dispatch({
                type: FETCH_SUMMARY_SUCCESS,
                summary: data as IMeetingSummary
            });
        } catch (error) {
            dispatch({
                type: FETCH_SUMMARY_FAILURE,
                error: error instanceof Error ? error.message : 'Failed to fetch summary'
            });
        }
    };
}

/**
 * Generate AI summary for a meeting.
 *
 * @param {string} meetingId - The meeting ID.
 * @returns {Function} Async thunk action.
 */
export function generateSummary(meetingId: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: GENERATE_SUMMARY_REQUEST });

        try {
            const response = await fetch(`${API_BASE_URL}/meetings/${meetingId}/summary`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            dispatch({
                type: GENERATE_SUMMARY_SUCCESS,
                summary: data as IMeetingSummary
            });
        } catch (error) {
            dispatch({
                type: GENERATE_SUMMARY_FAILURE,
                error: error instanceof Error ? error.message : 'Failed to generate summary'
            });
        }
    };
}

/**
 * Fetch speaker statistics for a meeting.
 *
 * @param {string} meetingId - The meeting ID.
 * @returns {Function} Async thunk action.
 */
export function fetchSpeakerStats(meetingId: string) {
    return async (dispatch: IStore['dispatch']) => {
        try {
            const response = await fetch(`${API_BASE_URL}/meetings/${meetingId}/speakers`);

            if (!response.ok) {
                return;
            }

            const data = await response.json();

            dispatch({
                type: FETCH_SPEAKER_STATS_SUCCESS,
                speakerStats: data.speakers as ISpeakerStats[]
            });
        } catch {
            // Silently ignore speaker stats errors
        }
    };
}

/**
 * Search transcripts.
 *
 * @param {string} query - The search query.
 * @returns {Function} Async thunk action.
 */
export function searchTranscripts(query: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: SET_SEARCH_QUERY, query });

        if (!query.trim()) {
            dispatch({ type: CLEAR_SEARCH });

            return;
        }

        dispatch({ type: SEARCH_REQUEST });

        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: 50 })
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            dispatch({
                type: SEARCH_SUCCESS,
                results: data.results as ISearchResult[]
            });
        } catch (error) {
            dispatch({
                type: SEARCH_FAILURE,
                error: error instanceof Error ? error.message : 'Search failed'
            });
        }
    };
}

/**
 * Clear search results.
 *
 * @returns {Object} The action object.
 */
export function clearSearch() {
    return { type: CLEAR_SEARCH };
}

/**
 * Set export format.
 *
 * @param {string} format - The export format.
 * @returns {Object} The action object.
 */
export function setExportFormat(format: 'pdf' | 'markdown' | 'json') {
    return {
        type: SET_EXPORT_FORMAT,
        format
    };
}

/**
 * Export a meeting.
 *
 * @param {string} meetingId - The meeting ID.
 * @param {string} format - The export format.
 * @returns {Function} Async thunk action.
 */
export function exportMeeting(meetingId: string, format: string) {
    return async (dispatch: IStore['dispatch']) => {
        dispatch({ type: EXPORT_REQUEST });

        try {
            const response = await fetch(
                `${API_BASE_URL}/meetings/${meetingId}/export?format=${format}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            // Get filename from content-disposition header
            const contentDisposition = response.headers.get('content-disposition');
            let filename = `meeting-${meetingId}.${format === 'markdown' ? 'md' : format}`;

            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);

                if (match) {
                    filename = match[1];
                }
            }

            // Download the file
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            dispatch({ type: EXPORT_SUCCESS });
        } catch (error) {
            dispatch({
                type: EXPORT_FAILURE,
                error: error instanceof Error ? error.message : 'Export failed'
            });
        }
    };
}

/**
 * Update meeting status (from polling).
 *
 * @param {string} meetingId - The meeting ID.
 * @param {string} status - The new status.
 * @returns {Object} The action object.
 */
export function updateMeetingStatus(meetingId: string, status: string) {
    return {
        type: UPDATE_MEETING_STATUS,
        meetingId,
        status
    };
}
