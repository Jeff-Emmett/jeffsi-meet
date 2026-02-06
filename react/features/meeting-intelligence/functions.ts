/**
 * Utility functions and selectors for Meeting Intelligence feature.
 */

import { IReduxState } from '../app/types';

import { SPEAKER_COLORS, STATUS_COLORS, STATUS_LABELS } from './constants';
import { IMeetingIntelligenceState, ISpeakerStats, ITranscriptSegment } from './types';

/**
 * Get the meeting intelligence state.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {IMeetingIntelligenceState} The meeting intelligence state.
 */
export function getMeetingIntelligenceState(state: IReduxState): IMeetingIntelligenceState {
    return state['features/meeting-intelligence'];
}

/**
 * Check if the dashboard is open.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {boolean} True if the dashboard is open.
 */
export function isDashboardOpen(state: IReduxState): boolean {
    return getMeetingIntelligenceState(state)?.isOpen ?? false;
}

/**
 * Get the active tab.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {string} The active tab name.
 */
export function getActiveTab(state: IReduxState): string {
    return getMeetingIntelligenceState(state)?.activeTab ?? 'recordings';
}

/**
 * Get the selected meeting.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {IMeeting|undefined} The selected meeting or undefined.
 */
export function getSelectedMeeting(state: IReduxState) {
    return getMeetingIntelligenceState(state)?.selectedMeeting;
}

/**
 * Get the current transcript.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {ITranscriptSegment[]} The transcript segments.
 */
export function getTranscript(state: IReduxState): ITranscriptSegment[] {
    return getMeetingIntelligenceState(state)?.transcript ?? [];
}

/**
 * Get the current summary.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {IMeetingSummary|undefined} The meeting summary or undefined.
 */
export function getSummary(state: IReduxState) {
    return getMeetingIntelligenceState(state)?.summary;
}

/**
 * Get speaker statistics.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {ISpeakerStats[]} The speaker statistics array.
 */
export function getSpeakerStats(state: IReduxState): ISpeakerStats[] {
    return getMeetingIntelligenceState(state)?.speakerStats ?? [];
}

/**
 * Format time in seconds to MM:SS or HH:MM:SS.
 *
 * @param {number} seconds - Time in seconds.
 * @returns {string} Formatted time string.
 */
export function formatTime(seconds: number): string {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format duration in seconds to human readable.
 *
 * @param {number} seconds - Duration in seconds.
 * @returns {string} Human readable duration.
 */
export function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
}

/**
 * Format date to display string.
 *
 * @param {string} dateString - ISO date string.
 * @returns {string} Formatted date string.
 */
export function formatDate(dateString: string): string {
    const date = new Date(dateString);

    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Get color for a speaker based on label.
 *
 * @param {string} speakerLabel - The speaker label.
 * @param {string[]} speakerLabels - All speaker labels.
 * @returns {string} The color for the speaker.
 */
export function getSpeakerColor(speakerLabel: string, speakerLabels: string[]): string {
    const index = speakerLabels.indexOf(speakerLabel);

    return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

/**
 * Get unique speaker labels from transcript.
 *
 * @param {ITranscriptSegment[]} transcript - The transcript segments.
 * @returns {string[]} Unique speaker labels.
 */
export function getUniqueSpeakers(transcript: ITranscriptSegment[]): string[] {
    const speakers = new Set<string>();

    transcript.forEach(segment => {
        if (segment.speaker_label) {
            speakers.add(segment.speaker_label);
        }
    });

    return Array.from(speakers);
}

/**
 * Get status label.
 *
 * @param {string} status - The status key.
 * @returns {string} Human readable status label.
 */
export function getStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

/**
 * Get status color.
 *
 * @param {string} status - The status key.
 * @returns {string} The color hex code.
 */
export function getStatusColor(status: string): string {
    return STATUS_COLORS[status] ?? '#9E9E9E';
}

/**
 * Group transcript segments by speaker.
 *
 * @param {ITranscriptSegment[]} transcript - The transcript segments.
 * @returns {Array<{segments: ITranscriptSegment[], speaker: string}>} Grouped segments.
 */
export function groupSegmentsBySpeaker(
        transcript: ITranscriptSegment[]
): Array<{ segments: ITranscriptSegment[]; speaker: string; }> {
    const groups: Array<{ segments: ITranscriptSegment[]; speaker: string; }> = [];
    let currentGroup: { segments: ITranscriptSegment[]; speaker: string; } | null = null;

    transcript.forEach(segment => {
        const speaker = segment.speaker_label || 'Speaker';

        if (!currentGroup || currentGroup.speaker !== speaker) {
            currentGroup = { speaker, segments: [] };
            groups.push(currentGroup);
        }

        currentGroup.segments.push(segment);
    });

    return groups;
}

/**
 * Check if meeting intelligence is enabled in config.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {boolean} True if meeting intelligence is enabled.
 */
export function isMeetingIntelligenceEnabled(state: IReduxState): boolean {
    const config = state['features/base/config'];

    return config?.meetingIntelligence?.enabled ?? true;
}

/**
 * Get the API URL from config or use default.
 *
 * @param {IReduxState} state - The Redux state.
 * @returns {string} The API URL.
 */
export function getApiUrl(state: IReduxState): string {
    const config = state['features/base/config'];

    return config?.meetingIntelligence?.apiUrl ?? '/api/intelligence';
}
