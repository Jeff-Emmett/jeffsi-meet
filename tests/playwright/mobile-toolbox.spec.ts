import { test, expect } from '@playwright/test';

const ROOM = `test-mobile-toolbox-${Date.now()}`;

const joinRoom = async (page: any) => {
    await page.goto(`/${ROOM}`, { waitUntil: 'networkidle' });

    const joinButton = page.locator('[data-testid="prejoin.joinMeeting"]');

    if (await joinButton.isVisible({ timeout: 8000 }).catch(() => false)) {
        const nameInput = page.locator('[data-testid="prejoin.screen"] input[type="text"]');

        if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nameInput.fill('Mobile Tester');
        }
        await joinButton.click();
    }

    await page.waitForSelector('#videospace', { timeout: 20000 });
    await page.waitForTimeout(3000);
};

const tapVideospace = async (page: any) => {
    const box = await page.locator('#videospace').boundingBox();

    if (!box) {
        throw new Error('#videospace has no bounding box');
    }
    await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
};

test.describe('Mobile in-call toolbox visibility', () => {

    test('toolbox is hidden on conference join', async ({ page }) => {
        await joinRoom(page);

        // With auto-hide enabled, the toolbox should NOT be visible on mount.
        const toolbox = page.locator('#new-toolbox');

        await expect(toolbox).not.toHaveClass(/visible/, { timeout: 2000 });

        await page.screenshot({ path: 'test-results/mobile-toolbox-hidden-on-join.png', fullPage: true });
    });

    test('tap shows toolbox, which auto-hides after the timeout', async ({ page }) => {
        await joinRoom(page);

        const toolbox = page.locator('#new-toolbox');

        // Initially hidden
        await expect(toolbox).not.toHaveClass(/visible/, { timeout: 2000 });

        // Tap to show
        await tapVideospace(page);
        await expect(toolbox).toHaveClass(/visible/, { timeout: 2000 });

        // Hangup button should be reachable while visible
        const hangupButton = page.locator('.hangup-button, [aria-label*="Leave"], [aria-label*="Hang"]');

        await expect(hangupButton.first()).toBeVisible({ timeout: 2000 });

        // Wait slightly longer than TOOLBAR_TIMEOUT (4000ms) and verify auto-hide fired
        await page.waitForTimeout(5000);
        await expect(toolbox).not.toHaveClass(/visible/, { timeout: 2000 });

        await page.screenshot({ path: 'test-results/mobile-toolbox-autohide.png', fullPage: true });
    });

    test('tapping while visible hides the toolbox immediately', async ({ page }) => {
        await joinRoom(page);

        const toolbox = page.locator('#new-toolbox');

        // Tap once to show
        await tapVideospace(page);
        await expect(toolbox).toHaveClass(/visible/, { timeout: 2000 });

        // Tap again to hide (before the auto-hide timer)
        await tapVideospace(page);
        await expect(toolbox).not.toHaveClass(/visible/, { timeout: 2000 });

        await page.screenshot({ path: 'test-results/mobile-toolbox-tap-toggle.png', fullPage: true });
    });
});
