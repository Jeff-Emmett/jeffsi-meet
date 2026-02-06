/**
 * Type definitions for Meeting Intelligence feature.
 */

/**
 * A single transcript segment with speaker and timing info.
 */
export interface ITranscriptSegment {
    confidence?: number;
    end_time: number;
    id: string;
    speaker_label?: string;
    start_time: number;
    text: string;
}

/**
 * An action item extracted from a meeting.
 */
export interface IActionItem {
    assignee?: string;
    due_date?: string;
    task: string;
}

/**
 * AI-generated meeting summary.
 */
export interface IMeetingSummary {
    action_items: IActionItem[];
    decisions: string[];
    generated_at: string;
    key_points: string[];
    sentiment?: string;
    summary_text: string;
    topics: string[];
}

/**
 * A meeting record.
 */
export interface IMeeting {
    conference_id: string;
    conference_name?: string;
    created_at: string;
    duration_seconds?: number;
    ended_at?: string;
    id: string;
    recording_path?: string;
    started_at?: string;
    status: MeetingStatus;
    title?: string;
}

/**
 * Meeting status values.
 */
export type MeetingStatus =
    | 'recording'
    | 'extracting_audio'
    | 'transcribing'
    | 'diarizing'
    | 'summarizing'
    | 'ready'
    | 'failed';

/**
 * Speaker statistics.
 */
export interface ISpeakerStats {
    percentage: number;
    segment_count: number;
    speaker_label: string;
    total_duration: number;
}

/**
 * Search result item.
 */
export interface ISearchResult {
    conference_id: string;
    meeting_id: string;
    score: number;
    segment_text: string;
    speaker_label?: string;
    start_time: number;
    started_at?: string;
    title?: string;
}

/**
 * Meeting Intelligence Redux state.
 */
export interface IMeetingIntelligenceState {
    activeTab: 'recordings' | 'transcript' | 'summary' | 'search';
    // Export
    exportFormat: 'pdf' | 'markdown' | 'json';

    exportLoading: boolean;
    // Dashboard state
    isOpen: boolean;
    // Meetings list
    meetings: IMeeting[];

    meetingsError?: string;
    meetingsLoading: boolean;

    searchError?: string;
    searchLoading: boolean;
    // Search
    searchQuery: string;

    searchResults: ISearchResult[];
    selectedMeeting?: IMeeting;
    // Selected meeting
    selectedMeetingId?: string;

    // Speaker stats
    speakerStats: ISpeakerStats[];

    // Summary
    summary?: IMeetingSummary;
    summaryError?: string;
    summaryLoading: boolean;
    // Transcript
    transcript: ITranscriptSegment[];

    transcriptError?: string;
    transcriptLoading: boolean;
}
