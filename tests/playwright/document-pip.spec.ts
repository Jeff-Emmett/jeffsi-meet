import { expect, test } from '@playwright/test';

const ROOM = `test-document-pip-${Date.now()}`;

const joinRoom = async (page: any) => {
    await page.goto(`/${ROOM}`, { waitUntil: 'networkidle' });

    const joinButton = page.locator('[data-testid="prejoin.joinMeeting"]');

    if (await joinButton.isVisible({ timeout: 8000 }).catch(() => false)) {
        const nameInput = page.locator('[data-testid="prejoin.screen"] input[type="text"]');

        if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nameInput.fill('PiP Tester');
        }

        // Device enumeration ("Configuring devices...") can hold the join
        // button in a not-yet-actionable state briefly even once visible.
        await page.getByText('Configuring devices').waitFor({ state: 'hidden', timeout: 15000 })
            .catch(() => { /* already hidden or never shown - fine either way */ });

        // webpack-dev-server's HMR error-overlay iframe (dev-only, not present
        // in production) sits over the page and intercepts pointer events even
        // when empty - force through it.
        await joinButton.click({ force: true });

        // Confirm we actually left the prejoin screen (not just that
        // #videospace exists in the DOM, which it does even during prejoin).
        await page.getByRole('heading', { name: 'Join meeting' }).waitFor({ state: 'hidden', timeout: 20000 });
    }

    await page.waitForSelector('#videospace', { timeout: 20000 });
    await page.waitForSelector('#new-toolbox', { timeout: 20000 });
    await page.waitForTimeout(3000);
};

test.describe('Meeting pop-out on tab blur', () => {

    /**
     * NOTE on scope: documentPictureInPicture.requestWindow() and
     * HTMLVideoElement.requestPictureInPicture() both require real transient
     * user activation. Playwright's context.newPage()+bringToFront() does not
     * reliably produce a genuine browser `blur`/`visibilitychange` on the
     * original page (confirmed empirically - no pip/actions.ts log lines fire
     * at all after bringToFront(), meaning handleWindowBlur never even runs),
     * and a synthetic dispatchEvent('blur') is deliberately untrusted, so
     * neither tier can succeed under automation. What IS reliably verifiable
     * here: the handleWindowBlur code path runs, attempts both tiers, and
     * fails closed (no crash, no unhandled rejection) when activation is
     * unavailable - which is exactly the class of regression (e.g. a typo'd
     * JSX attribute, a thrown error escaping the .catch()) this guards
     * against. Confirming an actual popout appears requires a human manually
     * switching tabs/apps in a real desktop session.
     */
    test('tab-blur handling runs and fails closed without a real user gesture', async ({ page }) => {
        const pipLogs: string[] = [];
        const pageErrors: string[] = [];

        page.on('console', msg => {
            if (/\[app:pip\]/.test(msg.text())) {
                pipLogs.push(msg.text());
            }
        });
        page.on('pageerror', err => {
            // Unrelated pre-existing whiteboard/excalidraw chunk-load flake on
            // this dev server - not something this test is responsible for.
            if (!/Loading chunk vendor failed/.test(err.message)) {
                pageErrors.push(err.message);
            }
        });

        await joinRoom(page);

        const debugInfo = await page.evaluate(() => ({
            pipEnabled: document.pictureInPictureEnabled,
            documentPiPSupported: 'documentPictureInPicture' in window,
            pipVideoEl: Boolean(document.getElementById('pipVideo'))
        }));

        expect(debugInfo.pipVideoEl).toBe(true);

        // Best available automated approximation of backgrounding the tab.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.waitForTimeout(2000);

        // The app must still be alive and interactive afterward - a crash
        // here is exactly what an unguarded exception in the PiP blur
        // handler would cause.
        await expect(page.locator('#new-toolbox')).toBeVisible();
        expect(pageErrors).toEqual([]);

        if (debugInfo.documentPiPSupported) {
            expect(pipLogs.some(l => /Document PiP unavailable, falling back to video PiP/.test(l))).toBe(true);
        }

        expect(pipLogs.some(l => /requestPictureInPicture failed|Entered Picture-in-Picture mode/.test(l))).toBe(true);
    });
});
