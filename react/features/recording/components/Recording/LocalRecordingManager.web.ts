// @ts-ignore
import * as ebml from 'ts-ebml/dist/EBML.min.js';

import { IStore } from '../../../app/types';
import { getRoomName } from '../../../base/conference/functions';
import { isMobileBrowser } from '../../../base/environment/utils';
import { browser } from '../../../base/lib-jitsi-meet';
import { MEDIA_TYPE, VIDEO_TYPE } from '../../../base/media/constants';
import {
    getLocalParticipant,
    getParticipantById,
    getParticipantDisplayName,
    getRemoteParticipants,
    isRecordingOptedOut
} from '../../../base/participants/functions';
import { IParticipant } from '../../../base/participants/types';
import { getLocalTrack, getTrackState } from '../../../base/tracks/functions';
import { ITrack } from '../../../base/tracks/types';
import { JSON_TYPE_TRANSCRIPTION_RESULT } from '../../../subtitles/constants';
import { LOCAL_RECORDING_ERROR } from '../../constants';
import logger from '../../logger';

import LocalRecordingCompositor, { ICompositorSource } from './LocalRecordingCompositor.web';
import LocalRecordingTranscript from './LocalRecordingTranscript.web';

interface ISelfRecording {
    on: boolean;
    withVideo: boolean;
}

/**
 * The per-participant audio file. Every participant's audio is also recorded
 * on its own so the transcript can be attributed to speakers exactly, and so
 * it can be re-transcribed later at higher accuracy. A stem keeps running
 * (silent) after its participant leaves so its offset stays a simple constant.
 */
interface IStem {
    destination: MediaStreamAudioDestinationNode;
    file: string;
    name: string;
    offsetMs: number;
    participantId: string;
    recorder: MediaRecorder;
    stopped: Promise<void>;
    writer: WebmWriter;
}

interface IAudioSource {
    node: MediaStreamAudioSourceNode;
    participantId: string;
}

interface ITranscriptionResult {
    is_interim?: boolean;
    language?: string;
    participant?: { id?: string; name?: string; };
    timestamp?: string | number;
    transcript?: Array<{ text?: string; }>;
    type?: string;
}

interface ILocalRecordingManager {
    isRecordingLocally: () => boolean;
    isSupported: () => boolean;
    onTranscriptionResult: (json: ITranscriptionResult) => void;
    selfRecording: ISelfRecording;
    startLocalRecording: (store: IStore, onlySelf: boolean) => Promise<void>;
    stopLocalRecording: () => void;
    syncSources: () => void;
}

type State = 'idle' | 'starting' | 'recording' | 'stopping';

/**
 * After a lot of trial and error, this is the preferred media type for
 * local recording. It is the only one that works across all platforms, with the
 * only caveat being that the resulting file wouldn't be seekable.
 *
 * We solve that by fixing the first Blob in order to reserve the space for the
 * corrected metadata, and after the recording is done, we do it again, this time with
 * the real duration, and overwrite the first part of the file.
 */
const PREFERRED_MEDIA_TYPE = 'video/webm;codecs=vp8,opus';

const SELF_AUDIO_MEDIA_TYPE = 'audio/webm;';

const STEM_MEDIA_TYPE = 'audio/webm;codecs=opus';

const VIDEO_BIT_RATE = 2500000; // 2.5Mbps in bits

const STEM_BIT_RATE = 48000;

const AUDIO_BIT_RATE = 128000;

const CHUNK_MS = 5000;

/**
 * How often the audio sources are re-checked in case a track changed without
 * a redux action (e.g. the screen-share audio mixer swapping the mic track).
 */
const SYNC_INTERVAL_MS = 1000;

const TRANSCRIPT_FLUSH_MS = 30000;

/**
 * Makes a string safe as a file or folder name on every OS.
 *
 * @param {string} name - The name.
 * @returns {string}
 */
function safeName(name: string) {
    return name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim()
        .slice(0, 60) || 'unnamed';
}

/**
 * Streams MediaRecorder chunks to a file and makes the WebM seekable at the end.
 */
class WebmWriter {
    private _chain: Promise<void>;
    private _first: Blob | undefined;
    private _seekable = false;
    private _writable: FileSystemWritableFileStream | undefined;

    /**
     * Opens the file for writing.
     *
     * @param {Promise<FileSystemFileHandle>} handle - The target file.
     */
    constructor(handle: Promise<FileSystemFileHandle>) {
        this._chain = handle
            .then(h => h.createWritable())
            .then(w => {
                this._writable = w;
            })
            .catch(e => logger.error('Error while opening a local recording file', e));
    }

    /**
     * Appends a chunk (writes are serialised).
     *
     * @param {Blob} blob - Recorded data.
     * @returns {void}
     */
    write(blob: Blob) {
        this._chain = this._chain.then(async () => {
            let data = blob;

            if (!this._first) {
                // Never drop the first chunk: it carries the WebM header. If the
                // header can't be patched, the file is kept, just not seekable.
                try {
                    data = await fixDuration(data, 864000000); // Reserve 24h.
                    this._seekable = true;
                } catch (e) {
                    logger.warn('Local recording file will not be seekable', e);
                }
                this._first = data;
            }
            await this._writable?.write(data);
        })
        .catch(e => logger.error('Error while writing to a local recording file', e));
    }

    /**
     * Rewrites the header with the real duration and closes the file.
     *
     * @param {number} duration - Duration in ms.
     * @returns {Promise<void>}
     */
    finish(duration: number) {
        this._chain = this._chain.then(async () => {
            if (this._seekable && this._first && this._writable) {
                await this._writable.seek(0);
                await this._writable.write(await fixDuration(this._first, duration));
            }
            await this._writable?.close();
        })
        .catch(e => logger.error('Error while finalising a local recording file', e));

        return this._chain;
    }
}

/**
 * Returns the raw microphone track of the local audio track. While a screen
 * share with audio is running the local track is replaced by a mic+screen
 * mix; we take the mic and the screen audio separately instead so neither is
 * counted twice.
 *
 * @param {any} jitsiTrack - The local JitsiLocalTrack.
 * @returns {MediaStreamTrack|undefined}
 */
function getRawMicTrack(jitsiTrack: any): MediaStreamTrack | undefined {
    const effect = jitsiTrack?._streamEffect;

    if (typeof effect?.setMuted === 'function' && effect?._originalTrack) {
        return effect._originalTrack;
    }

    return jitsiTrack?.getTrack?.();
}

/**
 * Whether the track is a screen share.
 *
 * @param {ITrack} t - Track.
 * @returns {boolean}
 */
function isScreenTrack(t: ITrack) {
    return t.mediaType === MEDIA_TYPE.SCREENSHARE || t.videoType === VIDEO_TYPE.DESKTOP;
}

/**
 * Returns a live MediaStreamTrack for a redux track, unless it is muted.
 *
 * @param {ITrack} t - Track.
 * @returns {MediaStreamTrack|undefined}
 */
function liveTrack(t: ITrack | undefined): MediaStreamTrack | undefined {
    const track: MediaStreamTrack | undefined = t?.jitsiTrack?.getTrack?.();

    return t && !t.muted && track?.readyState === 'live' ? track : undefined;
}

const LocalRecordingManager: ILocalRecordingManager & {
    _audioContext: AudioContext | undefined;
    _compositor: LocalRecordingCompositor | undefined;
    _compositorSources: () => ICompositorSource[];
    _folder: FileSystemDirectoryHandle | undefined;
    _getStemDestination: (participantId: string) => MediaStreamAudioDestinationNode;
    _mix: MediaStreamAudioDestinationNode | undefined;
    _recorder: MediaRecorder | undefined;
    _roomName: string;
    _sources: Map<string, IAudioSource>;
    _start: (store: IStore, onlySelf: boolean) => Promise<void>;
    _startTime: number;
    _state: State;
    _stems: Map<string, IStem>;
    _store: IStore | undefined;
    _teardown: () => void;
    _timers: number[];
    _transcript: LocalRecordingTranscript | undefined;
    _transcriptFlushed: number;
    _writeText: (name: string, content: string) => Promise<void>;
    _writeTranscript: () => Promise<void>;
} = {
    _audioContext: undefined,
    _compositor: undefined,
    _folder: undefined,
    _mix: undefined,
    _recorder: undefined,
    _roomName: '',
    _sources: new Map(),
    _startTime: 0,
    _state: 'idle',
    _stems: new Map(),
    _store: undefined,
    _timers: [],
    _transcript: undefined,
    _transcriptFlushed: 0,
    selfRecording: {
        on: false,
        withVideo: false
    },

    /**
     * Connects the audio of every participant (local mic, local screen-share
     * audio, every remote participant) to the mixed recording and to that
     * participant's own stem, and disconnects tracks that went away. Safe to
     * call at any time.
     *
     * @returns {void}
     */
    syncSources() {
        const ctx = this._audioContext;

        if (this._state !== 'recording' || !ctx || !this._mix || !this._store) {
            return;
        }

        const state = this._store.getState();
        const tracks = getTrackState(state);
        const localId = getLocalParticipant(state)?.id ?? 'local';
        const wanted = new Map<string, { participantId: string; track: MediaStreamTrack; }>();
        // People who opted out of recording are never captured, not even silently.
        const want = (track: MediaStreamTrack | undefined, participantId: string) => {
            track?.readyState === 'live' && !isRecordingOptedOut(state, participantId)
                && wanted.set(track.id, { participantId, track });
        };

        want(getRawMicTrack(getLocalTrack(tracks, MEDIA_TYPE.AUDIO)?.jitsiTrack), localId);
        want(state['features/screen-share']?.desktopAudioTrack?.getTrack?.(), localId);
        for (const t of tracks) {
            const owner = t.local ? undefined : getParticipantById(state, t.participantId);

            // Only real, visible participants: hidden service participants (the
            // Jigasi transcriber, a Jibri) publish tracks too but are not people.
            if (owner && !owner.fakeParticipant && t.mediaType === MEDIA_TYPE.AUDIO && t.jitsiTrack) {
                want(t.jitsiTrack.getTrack(), t.participantId);
            }
        }

        for (const [ id, source ] of this._sources) {
            if (!wanted.has(id)) {
                source.node.disconnect();
                this._sources.delete(id);
            }
        }

        for (const [ id, { participantId, track } ] of wanted) {
            if (this._sources.has(id)) {
                continue;
            }
            const node = ctx.createMediaStreamSource(new MediaStream([ track ]));

            node.connect(this._mix);
            node.connect(this._getStemDestination(participantId));
            this._sources.set(id, { node, participantId });
        }
    },

    /**
     * Returns (creating on first use) the audio node feeding a participant's
     * stem file.
     *
     * @param {string} participantId - Participant.
     * @returns {MediaStreamAudioDestinationNode}
     */
    _getStemDestination(participantId: string) {
        const existing = this._stems.get(participantId);

        if (existing) {
            return existing.destination;
        }

        const destination = this._audioContext!.createMediaStreamDestination();
        const name = getParticipantDisplayName(this._store!.getState(), participantId);
        const file = `${safeName(name)}-${safeName(participantId)}.webm`;
        const writer = new WebmWriter(this._folder!.getDirectoryHandle('stems', { create: true })
            .then(dir => dir.getFileHandle(file, { create: true })));
        const recorder = new MediaRecorder(destination.stream, {
            audioBitsPerSecond: STEM_BIT_RATE,
            mimeType: STEM_MEDIA_TYPE
        });
        const stopped = new Promise<void>(resolve => recorder.addEventListener('stop', () => resolve(), { once: true }));

        recorder.addEventListener('dataavailable', e => e.data?.size && writer.write(e.data));
        recorder.start(CHUNK_MS);
        this._stems.set(participantId, {
            destination,
            file: `stems/${file}`,
            name,
            offsetMs: Date.now() - this._startTime,
            participantId,
            recorder,
            stopped,
            writer
        });

        return destination;
    },

    /**
     * The tiles the compositor draws: one per real participant (camera, or a
     * name card while the camera is off) plus one per screen share.
     *
     * @returns {ICompositorSource[]}
     */
    _compositorSources() {
        const state = this._store!.getState();
        const local = getLocalParticipant(state);
        const byParticipant = new Map<string, { camera?: ITrack; screen?: ITrack; }>();

        for (const t of getTrackState(state)) {
            if (t.mediaType === MEDIA_TYPE.AUDIO) {
                continue;
            }
            const id = t.local ? local?.id ?? '' : t.participantId;
            const entry = byParticipant.get(id) ?? {};

            entry[isScreenTrack(t) ? 'screen' : 'camera'] = t;
            byParticipant.set(id, entry);
        }

        const participants: IParticipant[] = [
            ...local ? [ local ] : [],
            ...getRemoteParticipants(state).values()
        ].filter(p => !p.fakeParticipant);
        const sources: ICompositorSource[] = [];

        for (const p of participants) {
            const own = byParticipant.get(p.id);
            const name = getParticipantDisplayName(state, p.id);

            if (isRecordingOptedOut(state, p.id)) {
                sources.push({ id: p.id, isScreen: false, name: `${name} (not recorded)`, speaking: false });
                continue;
            }

            const screen = liveTrack(own?.screen);

            sources.push({
                id: p.id,
                isScreen: false,
                name,
                speaking: Boolean(p.dominantSpeaker),
                track: liveTrack(own?.camera)
            });
            screen && sources.push({ id: `${p.id}-screen`, isScreen: true, name, speaking: false, track: screen });
        }

        return sources;
    },

    /**
     * Writes a small text file into the recording folder.
     *
     * @param {string} name - File name.
     * @param {string} content - Content.
     * @returns {Promise<void>}
     */
    async _writeText(name: string, content: string) {
        try {
            const handle = await this._folder!.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();

            await writable.write(content);
            await writable.close();
        } catch (e) {
            logger.error(`Error while writing ${name}`, e);
        }
    },

    /**
     * Writes the transcript files.
     *
     * @returns {Promise<void>}
     */
    async _writeTranscript() {
        const transcript = this._transcript;

        if (!transcript || !this._folder) {
            return;
        }
        this._transcriptFlushed = transcript.segments.length;
        await Promise.all([
            this._writeText('transcript.md', transcript.toMarkdown(this._roomName)),
            this._writeText('transcript.vtt', transcript.toVtt()),
            this._writeText('transcript.json', transcript.toJson())
        ]);
    },

    /**
     * Releases everything a session holds and returns to idle. Safe to call
     * from any state, including a start that failed half way.
     *
     * @returns {void}
     */
    _teardown() {
        this._timers.forEach(t => clearInterval(t));
        this._timers = [];
        for (const stem of this._stems.values()) {
            stem.recorder.state !== 'inactive' && stem.recorder.stop();
        }
        this._compositor?.stop();
        for (const { node } of this._sources.values()) {
            node.disconnect();
        }
        this._audioContext?.close().catch(() => { /* already closed */ });

        this._audioContext = undefined;
        this._compositor = undefined;
        this._folder = undefined;
        this._mix = undefined;
        this._recorder = undefined;
        this._sources.clear();
        this._stems.clear();
        this._store = undefined;
        this._transcript = undefined;
        this._transcriptFlushed = 0;
        this._state = 'idle';
    },

    /**
     * Records a final transcription result (exactly attributed to the
     * participant whose audio stream it came from).
     *
     * @param {ITranscriptionResult} json - The transcriber's message.
     * @returns {void}
     */
    onTranscriptionResult(json) {
        if (!this._transcript || json?.type !== JSON_TYPE_TRANSCRIPTION_RESULT || json.is_interim) {
            return;
        }
        const speakerId = json.participant?.id ?? 'unknown';

        if (this._store && isRecordingOptedOut(this._store.getState(), speakerId)) {
            return;
        }

        this._transcript.add({
            language: json.language,
            speaker: json.participant?.name
                || (this._store ? getParticipantDisplayName(this._store.getState(), speakerId) : speakerId),
            speakerId,
            text: json.transcript?.[0]?.text ?? '',
            timestamp: json.timestamp
        });
    },

    /**
     * Stops local recording. Finalisation (closing the files, writing the
     * transcript) happens in the recorder's stop handler.
     *
     * @returns {void}
     * */
    stopLocalRecording() {
        if (this._state === 'recording' && this._recorder?.state === 'recording') {
            this._state = 'stopping';
            this._recorder.stop();
        }
    },

    /**
     * Starts a local recording into a folder the user picks: the composited
     * video, one audio file per participant, the live transcript and a
     * manifest tying them together.
     *
     * @param {IStore} store - The redux store.
     * @param {boolean} onlySelf - Whether to record only self streams.
     * @returns {void}
     */
    async startLocalRecording(store, onlySelf) {
        if (this._state !== 'idle') {
            throw new Error(LOCAL_RECORDING_ERROR.ALREADY_RUNNING);
        }
        this._state = 'starting';

        try {
            await this._start(store, onlySelf);
            this._state = 'recording';
            this.syncSources();
        } catch (e) {
            this._teardown();
            throw e;
        }
    },

    /**
     * The body of {@link startLocalRecording}; the caller tears down on any throw.
     *
     * @param {IStore} store - The redux store.
     * @param {boolean} onlySelf - Whether to record only self streams.
     * @returns {Promise<void>}
     */
    async _start(store: IStore, onlySelf: boolean) {
        const { getState } = store;
        const tracks = getTrackState(getState());
        let selfTracks: MediaStreamTrack[] = [];

        this._store = store;
        this._roomName = getRoomName(getState()) ?? '';
        this.selfRecording.on = onlySelf;

        if (onlySelf) {
            const audioTrack: MediaStreamTrack | undefined = getLocalTrack(tracks, MEDIA_TYPE.AUDIO)?.jitsiTrack?.track;
            let videoTrack: MediaStreamTrack | undefined = getLocalTrack(tracks, MEDIA_TYPE.VIDEO)?.jitsiTrack?.track;

            if (videoTrack && videoTrack.readyState !== 'live') {
                videoTrack = undefined;
            }
            if (!audioTrack && !videoTrack) {
                throw new Error(LOCAL_RECORDING_ERROR.NO_LOCAL_STREAMS);
            }
            this.selfRecording.withVideo = Boolean(videoTrack);
            selfTracks = [ audioTrack, videoTrack ].filter(Boolean) as MediaStreamTrack[];
        } else {
            // Created before the picker so it is still covered by the click
            // that started the recording (autoplay policy).
            this._audioContext = new AudioContext();
        }

        let parent: FileSystemDirectoryHandle;

        try {
            // @ts-expect-error
            parent = await window.showDirectoryPicker({ id: 'jeffsi-recordings', mode: 'readwrite',
                startIn: 'downloads' });
        } catch (e) {
            throw new Error(e instanceof DOMException && e.name === 'AbortError'
                ? LOCAL_RECORDING_ERROR.CANCELLED : LOCAL_RECORDING_ERROR.NO_FOLDER_ACCESS);
        }

        const startedAt = new Date();
        const base = safeName(`${this._roomName}_${startedAt.toISOString().replace(/[:.]/g, '-')}`);
        const videoFile = `${base}.webm`;

        try {
            this._folder = await parent.getDirectoryHandle(base, { create: true });
        } catch {
            throw new Error(LOCAL_RECORDING_ERROR.NO_FOLDER_ACCESS);
        }
        this._startTime = startedAt.getTime();

        let stream: MediaStream;

        if (onlySelf) {
            stream = new MediaStream(selfTracks);
        } else {
            const audioContext = this._audioContext!;

            audioContext.resume().catch(() => { /* resumes on the next gesture */ });
            this._mix = audioContext.createMediaStreamDestination();
            this._compositor = new LocalRecordingCompositor(() => this._compositorSources());
            this._transcript = new LocalRecordingTranscript(this._startTime);
            stream = new MediaStream([ ...this._mix.stream.getAudioTracks(), this._compositor.start() ]);

            this._timers.push(
                window.setInterval(() => this.syncSources(), SYNC_INTERVAL_MS),
                window.setInterval(() => {
                    if (this._transcript && this._transcript.segments.length !== this._transcriptFlushed) {
                        this._writeTranscript();
                    }
                }, TRANSCRIPT_FLUSH_MS));
        }

        const writer = new WebmWriter(this._folder.getFileHandle(videoFile, { create: true }));
        const recorder = new MediaRecorder(stream, {
            // @ts-ignore
            audioBitrateMode: 'constant',
            audioBitsPerSecond: AUDIO_BIT_RATE,
            mimeType: onlySelf && !this.selfRecording.withVideo ? SELF_AUDIO_MEDIA_TYPE : PREFERRED_MEDIA_TYPE,
            videoBitsPerSecond: VIDEO_BIT_RATE
        });

        recorder.addEventListener('dataavailable', e => e.data?.size && writer.write(e.data));

        recorder.addEventListener('stop', async () => {
            // The stop event is emitted when the recorder is done, and _after_ the last buffered
            // data has been handed over to the dataavailable event.
            const stoppedAt = Date.now();
            const duration = stoppedAt - this._startTime;
            const stems = [ ...this._stems.values() ];

            // Media can also end by itself (e.g. the self-recorded camera is turned off).
            this._state = 'stopping';

            try {
                this._timers.forEach(t => clearInterval(t));
                this._timers = [];
                stems.forEach(s => s.recorder.state !== 'inactive' && s.recorder.stop());
                await Promise.all(stems.map(s => s.stopped));

                // A self recording records the live call tracks directly; those must keep running.
                onlySelf || stream.getTracks().forEach(t => t.stop());

                await Promise.all([
                    writer.finish(duration),
                    ...stems.map(s => s.writer.finish(duration - s.offsetMs))
                ]);

                if (!onlySelf) {
                    await this._writeTranscript();
                    const state = store.getState();

                    await this._writeText('manifest.json', JSON.stringify({
                        room: this._roomName,
                        startedAt: startedAt.toISOString(),
                        durationMs: duration,
                        video: videoFile,
                        stems: stems.map(s => ({
                            file: s.file,
                            participantId: s.participantId,
                            name: getParticipantDisplayName(state, s.participantId) || s.name,
                            offsetMs: s.offsetMs,
                            durationMs: duration - s.offsetMs
                        })),
                        transcript: {
                            source: 'live',
                            segments: this._transcript?.segments.length ?? 0,
                            files: [ 'transcript.md', 'transcript.vtt', 'transcript.json' ]
                        }
                    }, null, 2));
                }
            } catch (e) {
                logger.error('Error while finalising the local recording', e);
            } finally {
                this._teardown();
            }
        });

        this._recorder = recorder;
        recorder.start(CHUNK_MS);
    },

    /**
     * Whether or not local recording is supported.
     *
     * @returns {boolean}
     */
    isSupported() {
        return browser.isChromiumBased()
            && !browser.isElectron()
            && !browser.isReactNative()
            && !isMobileBrowser()

            // @ts-expect-error
            && typeof window.showDirectoryPicker !== 'undefined'
            && typeof HTMLCanvasElement.prototype.captureStream === 'function'
            && MediaRecorder.isTypeSupported(PREFERRED_MEDIA_TYPE)
            && MediaRecorder.isTypeSupported(STEM_MEDIA_TYPE);
    },

    /**
     * Whether or not we're currently recording locally.
     *
     * @returns {boolean}
     */
    isRecordingLocally() {
        return this._state === 'recording';
    }

};

/**
 * Fixes the duration in the WebM container metadata.
 * Note: cues are omitted.
 *
 * @param {Blob} data - The first Blob of WebM data.
 * @param {number} duration - Actual duration of the video in milliseconds.
 * @returns {Promise<Blob>}
 */
async function fixDuration(data: Blob, duration: number): Promise<Blob> {
    const decoder = new ebml.Decoder();
    const reader = new ebml.Reader();

    reader.logging = false;
    reader.drop_default_duration = false;

    const dataBuf = await data.arrayBuffer();
    const elms = decoder.decode(dataBuf);

    for (const elm of elms) {
        reader.read(elm);
    }
    reader.stop();

    const newMetadataBuf = ebml.tools.makeMetadataSeekable(
        reader.metadatas,
        duration,
        [] // No cues
    );

    const body = new Uint8Array(dataBuf).subarray(reader.metadataSize);

    // @ts-ignore
    return new Blob([ newMetadataBuf, body ], { type: data.type });
}

export default LocalRecordingManager;
