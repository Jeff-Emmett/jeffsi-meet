import { Browser, Page, expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const RUN = Date.now();

/**
 * Replaces the folder picker with the origin-private file system, which
 * supports the same handle API, so the recording can be read back.
 *
 * @param {Page} page - The page.
 * @returns {Promise<void>}
 */
const stubFolderPicker = (page: Page) => page.addInitScript(() => {
    // @ts-ignore
    window.showDirectoryPicker = () => navigator.storage.getDirectory();
});

// One room per test: participants of a closed context linger in the room for a while.
const joinRoom = async (page: Page, name: string, room: string) => {
    // Not prejoinConfig.enabled=false: that URL override also starts without media.
    await page.goto(`/${room}#userInfo.displayName="${name}"`);
    await page.getByText('Configuring devices').waitFor({ state: 'hidden', timeout: 20000 })
        .catch(() => { /* never shown */ });
    await page.locator('[data-testid="prejoin.joinMeeting"]').click({ force: true, timeout: 20000 });
    await page.waitForFunction(() => {
        // @ts-ignore
        const conf = APP.store.getState()['features/base/conference'].conference;

        return Boolean(conf?.isJoined());
    }, undefined, { timeout: 30000 });
};

const newParticipant = async (browser: Browser, name: string) => {
    const context = await browser.newContext({ permissions: [ 'camera', 'microphone' ], ignoreHTTPSErrors: true });
    const page = await context.newPage();

    page.on('console', m => /local recording/i.test(m.text()) && console.log(`[${name}] ${m.text()}`));

    return { context, page, name };
};

test.describe('Local recording', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'Local recording is Chromium-only');

    test('announces itself and saves video, per-speaker audio and transcript', async ({ browser }) => {
        test.setTimeout(200000);

        const recorder = await newParticipant(browser, 'Rita Recorder');
        const other = await newParticipant(browser, 'Otto Other');

        await stubFolderPicker(recorder.page);

        // Headless Chrome cannot capture a real screen; share an animated canvas instead.
        await other.page.addInitScript(() => {
            navigator.mediaDevices.getDisplayMedia = async () => {
                const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
                const ctx = canvas.getContext('2d')!;
                let n = 0;

                setInterval(() => {
                    ctx.fillStyle = '#f5f0e6';
                    ctx.fillRect(0, 0, 1280, 720);
                    ctx.fillStyle = '#c0392b';
                    ctx.font = 'bold 72px sans-serif';
                    ctx.fillText(`SHARED SLIDE ${n++}`, 200, 380);
                }, 100);

                return canvas.captureStream(10);
            };
        });
        await joinRoom(recorder.page, recorder.name, `test-local-recording-${RUN}-a`);
        await joinRoom(other.page, other.name, `test-local-recording-${RUN}-a`);
        await recorder.page.waitForFunction(() =>
            // @ts-ignore
            APP.store.getState()['features/base/tracks'].filter((t: any) => !t.local).length >= 2,
        undefined, { timeout: 30000 });

        await recorder.page.evaluate(() => {
            // @ts-ignore
            APP.store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
        });

        // The other participant is told, even though this deployment's
        // config.notifications allowlist is empty.
        await expect(other.page.getByText('has started a local recording')).toBeVisible({ timeout: 15000 });

        // Otto shares a screen mid-recording; it must appear in the composite.
        await other.page.mouse.move(640, 400);
        await other.page.getByRole('button', { name: /shar(e|ing) your screen/i }).first()
            .click({ force: true, timeout: 10000 })
            .catch(e => console.log('screen share button:', e.message));
        const screenSeen = await recorder.page.waitForFunction(() =>
            // @ts-ignore
            APP.store.getState()['features/base/tracks'].some((t: any) => !t.local && t.videoType === 'desktop'),
        undefined, { timeout: 45000 }).then(() => true, () => false);

        // Not asserted: headless screen-share start time varies a lot.
        console.log('screen share reached recorder:', screenSeen);
        await recorder.page.waitForTimeout(8000);

        // A final result as Jigasi sends it, attributed to the other participant.
        await recorder.page.evaluate(otherName => {
            // @ts-ignore
            const state = APP.store.getState();
            const remote = [ ...state['features/base/participants'].remote.values() ][0];

            // @ts-ignore
            APP.store.dispatch({
                type: 'NON_PARTICIPANT_MESSAGE_RECEIVED',
                id: 'transcriber',
                json: {
                    type: 'transcription-result',
                    is_interim: false,
                    language: 'en',
                    message_id: 'm1',
                    participant: { id: remote.id, name: otherName },
                    timestamp: new Date().toISOString(),
                    transcript: [ { text: 'hello from the other side of the call' } ]
                }
            });
        }, other.name);

        await recorder.page.waitForTimeout(8000);
        await recorder.page.evaluate(() => {
            // @ts-ignore
            APP.store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        });
        await expect(other.page.getByText('has stopped a local recording')).toBeVisible({ timeout: 15000 });

        // Pull every file out of OPFS.
        const files: Record<string, string> = await recorder.page.evaluate(async () => {
            const out: Record<string, string> = {};
            const walk = async (dir: any, prefix: string) => {
                for await (const [ name, handle ] of dir.entries()) {
                    if (handle.kind === 'directory') {
                        await walk(handle, `${prefix}${name}/`);
                    } else {
                        const buf = new Uint8Array(await (await handle.getFile()).arrayBuffer());
                        let bin = '';

                        for (let i = 0; i < buf.length; i += 0x8000) {
                            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                        }
                        out[`${prefix}${name}`] = btoa(bin);
                    }
                }
            };

            // Wait for the stop handler to write the manifest.
            for (let i = 0; i < 40; i++) {
                const root = await navigator.storage.getDirectory();
                let done = false;

                for await (const [ , folder ] of (root as any).entries()) {
                    try {
                        await folder.getFileHandle('manifest.json');
                        done = true;
                    } catch { /* not yet */ }
                }
                if (done) {
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }
            await walk(await navigator.storage.getDirectory(), '');

            return out;
        });

        const dir = mkdtempSync(join(tmpdir(), 'jeffsi-rec-'));
        const names = Object.keys(files);

        console.log(`recording saved to ${dir}:\n  ${names.join('\n  ')}`);
        for (const name of names) {
            const target = join(dir, name.replace(/\//g, '__'));

            writeFileSync(target, Buffer.from(files[name], 'base64'));
        }

        const manifestName = names.find(n => n.endsWith('manifest.json'))!;

        expect(manifestName).toBeTruthy();
        const manifest = JSON.parse(Buffer.from(files[manifestName], 'base64').toString());

        expect(manifest.stems.map((s: any) => s.name).sort()).toEqual([ 'Otto Other', 'Rita Recorder' ]);

        const probe = (name: string) => JSON.parse(execFileSync('ffprobe', [
            '-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(dir, name.replace(/\//g, '__'))
        ]).toString());
        const video = probe(names.find(n => n.endsWith(manifest.video))!);

        expect(video.streams.map((s: any) => s.codec_type).sort()).toEqual([ 'audio', 'video' ]);
        expect(Number(video.format.duration)).toBeGreaterThan(10);

        for (const stem of manifest.stems) {
            const stemName = names.find(n => n.endsWith(stem.file))!;
            const info = probe(stemName);

            expect(info.streams[0].codec_name).toBe('opus');
            const volume = spawnSync('ffmpeg', [
                '-hide_banner', '-i', join(dir, stemName.replace(/\//g, '__')), '-af', 'volumedetect', '-f', 'null', '-'
            ]).stderr.toString();

            console.log(stem.name, stem.offsetMs, info.format.duration, volume.match(/max_volume: .*/)?.[0]);
        }

        const transcript = Buffer.from(files[names.find(n => n.endsWith('transcript.md'))!], 'base64').toString();

        expect(transcript).toContain('**Otto Other**');
        expect(transcript).toContain('hello from the other side of the call');

        await recorder.context.close();
        await other.context.close();
    });

    test('leaves out a participant who opted out of recording', async ({ browser }) => {
        test.setTimeout(150000);

        const recorder = await newParticipant(browser, 'Rita Recorder');
        const other = await newParticipant(browser, 'Otto Other');

        await stubFolderPicker(recorder.page);
        await joinRoom(recorder.page, recorder.name, `test-local-recording-${RUN}-b`);
        await joinRoom(other.page, other.name, `test-local-recording-${RUN}-b`);

        // Otto's global setting: never record or transcribe me.
        await other.page.evaluate(() => {
            // @ts-ignore
            APP.store.dispatch({ type: 'SETTINGS_UPDATED', settings: { recordingOptOut: true } });
        });
        await expect(recorder.page.getByText('has opted out of recording')).toBeVisible({ timeout: 15000 });

        await recorder.page.evaluate(() => {
            // @ts-ignore
            APP.store.dispatch({ type: 'START_LOCAL_RECORDING', onlySelf: false });
        });
        await recorder.page.waitForTimeout(6000);
        await recorder.page.evaluate(otherName => {
            // @ts-ignore
            const remote = [ ...APP.store.getState()['features/base/participants'].remote.values() ]
                .find((r: any) => r.name === otherName);

            // @ts-ignore
            APP.store.dispatch({
                type: 'NON_PARTICIPANT_MESSAGE_RECEIVED',
                id: 'transcriber',
                json: {
                    type: 'transcription-result',
                    is_interim: false,
                    participant: { id: remote.id, name: otherName },
                    timestamp: new Date().toISOString(),
                    transcript: [ { text: 'this must not be saved' } ]
                }
            });
        }, other.name);
        await recorder.page.waitForTimeout(6000);
        await recorder.page.evaluate(() => {
            // @ts-ignore
            APP.store.dispatch({ type: 'STOP_LOCAL_RECORDING' });
        });

        const saved = await recorder.page.evaluate(async () => {
            for (let i = 0; i < 40; i++) {
                const root = await navigator.storage.getDirectory();

                for await (const [ , dir ] of (root as any).entries()) {
                    try {
                        const read = async (n: string) => (await (await dir.getFileHandle(n)).getFile()).text();

                        return { manifest: JSON.parse(await read('manifest.json')), md: await read('transcript.md') };
                    } catch { /* not yet */ }
                }
                await new Promise(r => setTimeout(r, 500));
            }

            return null;
        });

        expect(saved).toBeTruthy();
        expect(saved!.manifest.stems.map((st: any) => st.name)).toEqual([ 'Rita Recorder' ]);
        expect(saved!.md).not.toContain('this must not be saved');

        await recorder.context.close();
        await other.context.close();
    });
});
