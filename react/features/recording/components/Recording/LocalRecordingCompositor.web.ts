import { getInitials } from '../../../base/avatar/functions';
import {
    CLEAR_TIMEOUT,
    SET_TIMEOUT,
    TIMEOUT_TICK,
    timerWorkerScript
} from '../../../stream-effects/virtual-background/TimerWorker';

/**
 * One thing to draw: a participant's camera tile or a screen share.
 */
export interface ICompositorSource {

    /**
     * Stable key for the tile (participant id, or `<id>-screen`).
     */
    id: string;

    /**
     * Whether this tile is a screen share (drawn large, letterboxed).
     */
    isScreen: boolean;

    /**
     * Label drawn on the tile.
     */
    name: string;

    /**
     * Whether the participant is the current dominant speaker.
     */
    speaking: boolean;

    /**
     * The live video track, or undefined when the camera is off (a name card is drawn instead).
     */
    track?: MediaStreamTrack;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

/**
 * Tile list (who is in the call, which tracks are live) is re-read this often
 * rather than every frame.
 */
const SOURCES_REFRESH_MS = 250;
const GAP = 6;
const BACKGROUND = '#0b0d10';
const TILE_BACKGROUND = '#1c1f24';
const SPEAKER_BORDER = '#3d9bff';

interface IRect {
    h: number;
    w: number;
    x: number;
    y: number;
}

/**
 * Splits a rectangle into a grid of n cells, choosing the column count that
 * makes the cells closest to 16:9.
 *
 * @param {IRect} area - The area to split.
 * @param {number} n - Number of cells.
 * @returns {IRect[]}
 */
function grid(area: IRect, n: number): IRect[] {
    if (n === 0) {
        return [];
    }

    let best = 1;
    let bestScore = Infinity;

    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const ratio = (area.w / cols) / (area.h / rows);
        const score = Math.abs(Math.log(ratio / (16 / 9)));

        if (score < bestScore) {
            best = cols;
            bestScore = score;
        }
    }

    const cols = best;
    const rows = Math.ceil(n / cols);
    const w = (area.w - (GAP * (cols - 1))) / cols;
    const h = (area.h - (GAP * (rows - 1))) / rows;
    const cells: IRect[] = [];

    for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - (row * cols) : cols;

        // Center a short last row.
        const offset = (cols - inRow) * (w + GAP) / 2;

        cells.push({
            x: area.x + offset + ((i % cols) * (w + GAP)),
            y: area.y + (row * (h + GAP)),
            w,
            h
        });
    }

    return cells;
}

/**
 * Composites every participant's camera and every screen share into one
 * canvas video track, independently of what the recording user's own UI is
 * showing (open panels, pinned tiles, self-view hidden, etc.).
 *
 * Frames are driven from a worker timer because requestAnimationFrame stops
 * entirely and main-thread timers are throttled when the tab is in the
 * background.
 */
export default class LocalRecordingCompositor {
    private _canvas: HTMLCanvasElement;
    private _container: HTMLDivElement;
    private _ctx: CanvasRenderingContext2D;
    private _getSources: () => ICompositorSource[];
    private _sources: ICompositorSource[] = [];
    private _sourcesAt = 0;
    private _stream: MediaStream | undefined;
    private _videos = new Map<string, HTMLVideoElement>();
    private _worker: Worker | undefined;

    /**
     * Creates the compositor.
     *
     * @param {Function} getSources - Called every frame for the current tiles.
     */
    constructor(getSources: () => ICompositorSource[]) {
        this._getSources = getSources;
        this._canvas = document.createElement('canvas');
        this._canvas.width = WIDTH;
        this._canvas.height = HEIGHT;
        this._ctx = this._canvas.getContext('2d') as CanvasRenderingContext2D;

        // The <video> elements live off-screen but in the DOM so the browser
        // keeps decoding frames for them.
        this._container = document.createElement('div');
        this._container.setAttribute('aria-hidden', 'true');
        this._container.style.cssText
            = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
    }

    /**
     * Starts drawing and returns the composited video track.
     *
     * @returns {MediaStreamTrack}
     */
    start(): MediaStreamTrack {
        document.body.appendChild(this._container);
        this._draw();
        this._stream = this._canvas.captureStream(FPS);

        this._worker = new Worker(timerWorkerScript, { name: 'Local recording compositor' });
        this._worker.onmessage = (e: MessageEvent) => {
            if (e.data.id === TIMEOUT_TICK) {
                const started = performance.now();

                this._draw();
                this._worker?.postMessage({
                    id: SET_TIMEOUT,
                    timeMs: Math.max(0, (1000 / FPS) - (performance.now() - started))
                });
            }
        };
        this._worker.postMessage({ id: SET_TIMEOUT, timeMs: 1000 / FPS });

        return this._stream.getVideoTracks()[0];
    }

    /**
     * Stops drawing and releases all elements.
     *
     * @returns {void}
     */
    stop() {
        this._worker?.postMessage({ id: CLEAR_TIMEOUT });
        this._worker?.terminate();
        this._worker = undefined;
        this._stream?.getTracks().forEach(t => t.stop());
        this._stream = undefined;
        for (const video of this._videos.values()) {
            video.srcObject = null;
        }
        this._videos.clear();
        this._container.remove();
    }

    /**
     * Returns a playing <video> for the track, creating it on first use, and
     * drops elements for tracks that are no longer present.
     *
     * @param {ICompositorSource[]} sources - Current sources.
     * @returns {void}
     */
    private _syncVideos(sources: ICompositorSource[]) {
        const live = new Set<string>();

        for (const { track } of sources) {
            if (!track || track.readyState !== 'live') {
                continue;
            }
            live.add(track.id);
            if (!this._videos.has(track.id)) {
                const video = document.createElement('video');

                video.muted = true;
                video.playsInline = true;
                video.srcObject = new MediaStream([ track ]);
                this._container.appendChild(video);
                video.play().catch(() => { /* retried by the next srcObject change */ });
                this._videos.set(track.id, video);
            }
        }

        for (const [ id, video ] of this._videos) {
            if (!live.has(id)) {
                video.srcObject = null;
                video.remove();
                this._videos.delete(id);
            }
        }
    }

    /**
     * Draws one frame.
     *
     * @returns {void}
     */
    private _draw() {
        if (performance.now() - this._sourcesAt >= SOURCES_REFRESH_MS) {
            try {
                this._sources = this._getSources();
                this._syncVideos(this._sources);
            } catch {
                // Keep the last layout if the state is mid-update.
            }
            this._sourcesAt = performance.now();
        }
        const sources = this._sources;

        const ctx = this._ctx;

        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        const screens = sources.filter(s => s.isScreen && s.track);
        const cameras = sources.filter(s => !s.isScreen);
        const full = { x: GAP, y: GAP, w: WIDTH - (2 * GAP), h: HEIGHT - (2 * GAP) };

        if (screens.length) {
            // Screen shares take the stage, cameras run down the right edge.
            const stripW = cameras.length ? Math.round(full.w * 0.2) : 0;
            const stage = { ...full, w: full.w - stripW - (stripW ? GAP : 0) };
            const strip = { x: stage.x + stage.w + GAP, y: full.y, w: stripW, h: full.h };

            grid(stage, screens.length).forEach((r, i) => this._drawTile(screens[i], r, true));
            if (cameras.length) {
                const cellH = Math.min((strip.w * 9) / 16, (strip.h - (GAP * (cameras.length - 1))) / cameras.length);

                cameras.forEach((s, i) => this._drawTile(s, {
                    x: strip.x,
                    y: strip.y + (i * (cellH + GAP)),
                    w: strip.w,
                    h: cellH
                }, false));
            }
        } else {
            grid(full, cameras.length).forEach((r, i) => this._drawTile(cameras[i], r, false));
        }
    }

    /**
     * Draws a tile: the video (contained for screens, covered for cameras) or a
     * name card, plus the name label and the dominant-speaker border.
     *
     * @param {ICompositorSource} source - What to draw.
     * @param {IRect} r - Where.
     * @param {boolean} contain - Letterbox instead of crop.
     * @returns {void}
     */
    private _drawTile(source: ICompositorSource, r: IRect, contain: boolean) {
        const ctx = this._ctx;
        const video = source.track && this._videos.get(source.track.id);

        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.fillStyle = TILE_BACKGROUND;
        ctx.fillRect(r.x, r.y, r.w, r.h);

        if (video?.videoWidth && video.readyState >= 2 && !source.track?.muted) {
            const scale = contain
                ? Math.min(r.w / video.videoWidth, r.h / video.videoHeight)
                : Math.max(r.w / video.videoWidth, r.h / video.videoHeight);
            const w = video.videoWidth * scale;
            const h = video.videoHeight * scale;

            ctx.drawImage(video, r.x + ((r.w - w) / 2), r.y + ((r.h - h) / 2), w, h);
        } else {
            const initials = getInitials(source.name) || '?';
            const radius = Math.min(r.w, r.h) * 0.2;

            ctx.fillStyle = '#3a4150';
            ctx.beginPath();
            ctx.arc(r.x + (r.w / 2), r.y + (r.h / 2), radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = `600 ${Math.round(radius * 0.8)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(initials, r.x + (r.w / 2), r.y + (r.h / 2));
        }

        const fontSize = Math.max(11, Math.min(18, Math.round(r.h / 14)));

        ctx.font = `500 ${fontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = source.isScreen ? `${source.name} (screen)` : source.name;
        const labelW = Math.min(ctx.measureText(label).width + (fontSize * 1.2), r.w - 8);
        const labelH = fontSize * 1.8;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(r.x + 4, r.y + r.h - labelH - 4, labelW, labelH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, r.x + 4 + (fontSize * 0.6), r.y + r.h - 4 - (labelH / 2), labelW - fontSize);

        if (source.speaking && !source.isScreen) {
            ctx.strokeStyle = SPEAKER_BORDER;
            ctx.lineWidth = 4;
            ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        }
        ctx.restore();
    }
}
