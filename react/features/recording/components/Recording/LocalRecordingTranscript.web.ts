/**
 * One finalised utterance. Speaker attribution is exact, not inferred: the
 * transcriber (Jigasi) receives every participant's audio as its own stream
 * and labels each result with the participant it came from.
 */
export interface ITranscriptSegment {

    /**
     * Seconds from the start of the recording.
     */
    end: number;
    language?: string;
    speaker: string;
    speakerId: string;

    /**
     * Seconds from the start of the recording (estimated, see {@link estimateStart}).
     */
    start: number;
    text: string;
}

/**
 * Average speaking rate used to estimate when an utterance began, since the
 * transcriber only reports when it was finalised.
 */
const SECONDS_PER_WORD = 0.4;

/**
 * Formats seconds as a WebVTT timestamp.
 *
 * @param {number} seconds - Time.
 * @returns {string}
 */
function vttTime(seconds: number) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad = (n: number, l = 2) => String(n).padStart(l, '0');

    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/**
 * Collects transcription results during a local recording and renders them.
 */
export default class LocalRecordingTranscript {
    segments: ITranscriptSegment[] = [];
    private _lastEnd = new Map<string, number>();
    private _startedAt: number;

    /**
     * Creates a transcript for a recording that started at the given time.
     *
     * @param {number} startedAt - Epoch ms of the recording start.
     */
    constructor(startedAt: number) {
        this._startedAt = startedAt;
    }

    /**
     * Adds a final result.
     *
     * @param {Object} result - The result.
     * @returns {void}
     */
    add({ language, speaker, speakerId, text, timestamp }: {
        language?: string; speaker: string; speakerId: string; text: string; timestamp?: string | number;
    }) {
        const clean = text?.trim();

        if (!clean) {
            return;
        }

        const parsed = typeof timestamp === 'undefined' ? NaN : new Date(timestamp).getTime();

        // Fall back to arrival time when the transcriber's clock is missing or
        // implausibly far from ours.
        const at = Number.isFinite(parsed) && Math.abs(parsed - Date.now()) < 60000 ? parsed : Date.now();
        const end = Math.max(0, (at - this._startedAt) / 1000);
        const words = clean.split(/\s+/).length;
        const estimated = end - Math.max(1, words * SECONDS_PER_WORD);
        const start = Math.max(0, estimated, this._lastEnd.get(speakerId) ?? 0);

        this._lastEnd.set(speakerId, end);
        this.segments.push({ start: Math.min(start, end), end, speaker, speakerId, text: clean, language });
    }

    /**
     * Segments ordered by time.
     *
     * @returns {ITranscriptSegment[]}
     */
    sorted() {
        return [ ...this.segments ].sort((a, b) => a.start - b.start);
    }

    /**
     * Renders the transcript as Markdown, merging consecutive lines from the
     * same speaker.
     *
     * @param {string} title - Heading.
     * @returns {string}
     */
    toMarkdown(title: string) {
        const lines = [ `# ${title}`, '', `Recorded ${new Date(this._startedAt).toLocaleString()}`, '' ];
        let current: { speaker: string; start: number; text: string[]; } | undefined;
        const flush = () => {
            current && lines.push(`**${current.speaker}** [${vttTime(current.start).slice(0, 8)}]: ${
                current.text.join(' ')}`, '');
        };

        for (const s of this.sorted()) {
            if (current?.speaker === s.speaker) {
                current.text.push(s.text);
            } else {
                flush();
                current = { speaker: s.speaker, start: s.start, text: [ s.text ] };
            }
        }
        flush();

        if (!this.segments.length) {
            lines.push('_No live transcription was received during this recording. The per-speaker audio in'
                + ' `stems/` can be transcribed afterwards — see `manifest.json`._', '');
        }

        return lines.join('\n');
    }

    /**
     * Renders WebVTT captions with voice tags, playable next to the video.
     *
     * @returns {string}
     */
    toVtt() {
        const cues = this.sorted().map(s =>
            `${vttTime(s.start)} --> ${vttTime(s.end)}\n<v ${s.speaker.replace(/[<>]/g, '')}>${s.text}`);

        return `WEBVTT\n\n${cues.join('\n\n')}\n`;
    }

    /**
     * Renders the raw segments as JSON.
     *
     * @returns {string}
     */
    toJson() {
        return JSON.stringify({
            startedAt: new Date(this._startedAt).toISOString(),
            source: 'live',
            segments: this.sorted()
        }, null, 2);
    }
}
