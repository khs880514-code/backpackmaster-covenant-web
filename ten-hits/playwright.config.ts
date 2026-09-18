import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * This machine ships a pre-installed Chromium whose build number may not match
 * the one this Playwright version downloads. Point at it when it is there and
 * fall back to Playwright's own browser otherwise.
 */
function preinstalledChromium(): string | undefined {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (!root) return undefined;
  const candidates = [
    `${root}/chromium-1194/chrome-linux/chrome`,
    `${root}/chromium/chrome-linux/chrome`
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

const executablePath = preinstalledChromium();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './tests/e2e',
  // Software-rasterized WebGL is CPU bound here, so three pages at once starve
  // each other. One worker keeps every viewport honest instead of flaky.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    launchOptions,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'iphone-12-pro',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      }
    },
    {
      name: 'fold-portrait',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 904, height: 2316 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      }
    }
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000
  }
});
