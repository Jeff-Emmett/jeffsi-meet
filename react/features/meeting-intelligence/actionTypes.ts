/**
 * Action types for Meeting Intelligence feature.
 */

/**
 * Toggle the meeting intelligence dashboard visibility.
 */
export const TOGGLE_MEETING_INTELLIGENCE = 'TOGGLE_MEETING_INTELLIGENCE';

/**
 * Set the active tab in the dashboard.
 */
export const SET_ACTIVE_TAB = 'SET_MEETING_INTELLIGENCE_ACTIVE_TAB';

/**
 * Select a meeting for detailed view.
 */
export const SELECT_MEETING = 'SELECT_MEETING';

/**
 * Clear the selected meeting.
 */
export const CLEAR_SELECTED_MEETING = 'CLEAR_SELECTED_MEETING';

/**
 * Fetch meetings list.
 */
export const FETCH_MEETINGS_REQUEST = 'FETCH_MEETINGS_REQUEST';
export const FETCH_MEETINGS_SUCCESS = 'FETCH_MEETINGS_SUCCESS';
export const FETCH_MEETINGS_FAILURE = 'FETCH_MEETINGS_FAILURE';

/**
 * Fetch transcript for a meeting.
 */
export const FETCH_TRANSCRIPT_REQUEST = 'FETCH_TRANSCRIPT_REQUEST';
export const FETCH_TRANSCRIPT_SUCCESS = 'FETCH_TRANSCRIPT_SUCCESS';
export const FETCH_TRANSCRIPT_FAILURE = 'FETCH_TRANSCRIPT_FAILURE';

/**
 * Fetch summary for a meeting.
 */
export const FETCH_SUMMARY_REQUEST = 'FETCH_SUMMARY_REQUEST';
export const FETCH_SUMMARY_SUCCESS = 'FETCH_SUMMARY_SUCCESS';
export const FETCH_SUMMARY_FAILURE = 'FETCH_SUMMARY_FAILURE';

/**
 * Generate summary for a meeting.
 */
export const GENERATE_SUMMARY_REQUEST = 'GENERATE_SUMMARY_REQUEST';
export const GENERATE_SUMMARY_SUCCESS = 'GENERATE_SUMMARY_SUCCESS';
export const GENERATE_SUMMARY_FAILURE = 'GENERATE_SUMMARY_FAILURE';

/**
 * Fetch speaker stats for a meeting.
 */
export const FETCH_SPEAKER_STATS_SUCCESS = 'FETCH_SPEAKER_STATS_SUCCESS';

/**
 * Search transcripts.
 */
export const SEARCH_REQUEST = 'MEETING_INTELLIGENCE_SEARCH_REQUEST';
export const SEARCH_SUCCESS = 'MEETING_INTELLIGENCE_SEARCH_SUCCESS';
export const SEARCH_FAILURE = 'MEETING_INTELLIGENCE_SEARCH_FAILURE';
export const SET_SEARCH_QUERY = 'SET_MEETING_INTELLIGENCE_SEARCH_QUERY';
export const CLEAR_SEARCH = 'CLEAR_MEETING_INTELLIGENCE_SEARCH';

/**
 * Export meeting.
 */
export const EXPORT_REQUEST = 'MEETING_INTELLIGENCE_EXPORT_REQUEST';
export const EXPORT_SUCCESS = 'MEETING_INTELLIGENCE_EXPORT_SUCCESS';
export const EXPORT_FAILURE = 'MEETING_INTELLIGENCE_EXPORT_FAILURE';
export const SET_EXPORT_FORMAT = 'SET_MEETING_INTELLIGENCE_EXPORT_FORMAT';

/**
 * Update meeting status (from polling).
 */
export const UPDATE_MEETING_STATUS = 'UPDATE_MEETING_STATUS';
