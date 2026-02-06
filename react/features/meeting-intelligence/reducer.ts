/**
 * Reducer for Meeting Intelligence feature.
 */

import ReducerRegistry from '../base/redux/ReducerRegistry';

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
import { IMeetingIntelligenceState } from './types';

/**
 * Initial state.
 */
const INITIAL_STATE: IMeetingIntelligenceState = {
    isOpen: false,
    activeTab: 'recordings',
    meetings: [],
    meetingsLoading: false,
    meetingsError: undefined,
    selectedMeetingId: undefined,
    selectedMeeting: undefined,
    transcript: [],
    transcriptLoading: false,
    transcriptError: undefined,
    summary: undefined,
    summaryLoading: false,
    summaryError: undefined,
    speakerStats: [],
    searchQuery: '',
    searchResults: [],
    searchLoading: false,
    searchError: undefined,
    exportFormat: 'markdown',
    exportLoading: false
};

/**
 * Reducer function.
 */
ReducerRegistry.register<IMeetingIntelligenceState>(
    'features/meeting-intelligence',
    (state = INITIAL_STATE, action): IMeetingIntelligenceState => {
        switch (action.type) {
        case TOGGLE_MEETING_INTELLIGENCE:
            return {
                ...state,
                isOpen: !state.isOpen
            };

        case SET_ACTIVE_TAB:
            return {
                ...state,
                activeTab: action.tab
            };

        case SELECT_MEETING:
            return {
                ...state,
                selectedMeetingId: action.meetingId,
                selectedMeeting: state.meetings.find(m => m.id === action.meetingId),
                transcript: [],
                summary: undefined,
                speakerStats: [],
                activeTab: 'transcript'
            };

        case CLEAR_SELECTED_MEETING:
            return {
                ...state,
                selectedMeetingId: undefined,
                selectedMeeting: undefined,
                transcript: [],
                summary: undefined,
                speakerStats: [],
                activeTab: 'recordings'
            };

        case FETCH_MEETINGS_REQUEST:
            return {
                ...state,
                meetingsLoading: true,
                meetingsError: undefined
            };

        case FETCH_MEETINGS_SUCCESS:
            return {
                ...state,
                meetings: action.meetings,
                meetingsLoading: false
            };

        case FETCH_MEETINGS_FAILURE:
            return {
                ...state,
                meetingsLoading: false,
                meetingsError: action.error
            };

        case FETCH_TRANSCRIPT_REQUEST:
            return {
                ...state,
                transcriptLoading: true,
                transcriptError: undefined
            };

        case FETCH_TRANSCRIPT_SUCCESS:
            return {
                ...state,
                transcript: action.transcript,
                transcriptLoading: false
            };

        case FETCH_TRANSCRIPT_FAILURE:
            return {
                ...state,
                transcriptLoading: false,
                transcriptError: action.error
            };

        case FETCH_SUMMARY_REQUEST:
        case GENERATE_SUMMARY_REQUEST:
            return {
                ...state,
                summaryLoading: true,
                summaryError: undefined
            };

        case FETCH_SUMMARY_SUCCESS:
        case GENERATE_SUMMARY_SUCCESS:
            return {
                ...state,
                summary: action.summary,
                summaryLoading: false
            };

        case FETCH_SUMMARY_FAILURE:
        case GENERATE_SUMMARY_FAILURE:
            return {
                ...state,
                summaryLoading: false,
                summaryError: action.error
            };

        case FETCH_SPEAKER_STATS_SUCCESS:
            return {
                ...state,
                speakerStats: action.speakerStats
            };

        case SET_SEARCH_QUERY:
            return {
                ...state,
                searchQuery: action.query
            };

        case SEARCH_REQUEST:
            return {
                ...state,
                searchLoading: true,
                searchError: undefined
            };

        case SEARCH_SUCCESS:
            return {
                ...state,
                searchResults: action.results,
                searchLoading: false
            };

        case SEARCH_FAILURE:
            return {
                ...state,
                searchLoading: false,
                searchError: action.error
            };

        case CLEAR_SEARCH:
            return {
                ...state,
                searchQuery: '',
                searchResults: [],
                searchError: undefined
            };

        case SET_EXPORT_FORMAT:
            return {
                ...state,
                exportFormat: action.format
            };

        case EXPORT_REQUEST:
            return {
                ...state,
                exportLoading: true
            };

        case EXPORT_SUCCESS:
        case EXPORT_FAILURE:
            return {
                ...state,
                exportLoading: false
            };

        case UPDATE_MEETING_STATUS: {
            const updatedMeetings = state.meetings.map(m =>
                m.id === action.meetingId
                    ? { ...m, status: action.status }
                    : m
            );
            const updatedSelectedMeeting = state.selectedMeeting && state.selectedMeeting.id === action.meetingId
                ? { ...state.selectedMeeting, status: action.status }
                : state.selectedMeeting;

            return {
                ...state,
                meetings: updatedMeetings,
                selectedMeeting: updatedSelectedMeeting
            };
        }

        default:
            return state;
        }
    }
);
