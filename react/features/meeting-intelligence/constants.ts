/**
 * Constants for Meeting Intelligence feature.
 */

/**
 * API base URL for meeting intelligence endpoints.
 * Uses the integrated path on the same domain.
 */
export const API_BASE_URL = '/api/intelligence';

/**
 * Status to display text mapping.
 */
export const STATUS_LABELS: Record<string, string> = {
    recording: 'Recording',
    extracting_audio: 'Extracting Audio',
    transcribing: 'Transcribing',
    diarizing: 'Identifying Speakers',
    summarizing: 'Generating Summary',
    ready: 'Ready',
    failed: 'Failed'
};

/**
 * Status to color mapping.
 */
export const STATUS_COLORS: Record<string, string> = {
    recording: '#FF5722',
    extracting_audio: '#2196F3',
    transcribing: '#9C27B0',
    diarizing: '#00BCD4',
    summarizing: '#4CAF50',
    ready: '#8BC34A',
    failed: '#F44336'
};

/**
 * Speaker colors for transcript display.
 */
export const SPEAKER_COLORS = [
    '#4FC3F7', // Light Blue
    '#81C784', // Light Green
    '#FFB74D', // Orange
    '#F06292', // Pink
    '#BA68C8', // Purple
    '#4DB6AC', // Teal
    '#FFD54F', // Amber
    '#7986CB', // Indigo
    '#A1887F', // Brown
    '#90A4AE' // Blue Grey
];

/**
 * Export format options.
 */
export const EXPORT_FORMATS = [
    { value: 'markdown', label: 'Markdown (.md)' },
    { value: 'pdf', label: 'PDF (.pdf)' },
    { value: 'json', label: 'JSON (.json)' }
] as const;

/**
 * Polling interval for meeting status updates (ms).
 */
export const STATUS_POLL_INTERVAL = 5000;

/**
 * Maximum number of meetings to fetch per page.
 */
export const MEETINGS_PAGE_SIZE = 20;
