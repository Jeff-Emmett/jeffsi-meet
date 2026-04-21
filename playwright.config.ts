import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/playwright',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'https://meet.jeffemmett.com',
        ignoreHTTPSErrors: true,
        screenshot: 'on',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'Mobile Chrome',
            use: {
                ...devices['Pixel 7'],
                permissions: ['camera', 'microphone']
            }
        },
        {
            name: 'Mobile Safari',
            use: {
                ...devices['iPhone 14'],
                permissions: ['camera', 'microphone']
            }
        }
    ]
});
