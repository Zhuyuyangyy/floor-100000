import { defineConfig, devices } from '@playwright/test';

// Local runs use the installed Google Chrome (channel: 'chrome') so no extra
// browser download is needed. CI runs the bundled Chromium from the pinned
// Playwright image instead: the runner's preinstalled Chrome version changed
// between runs, which is one of the reasons the same commit could pass or fail.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Keep the artefacts of a failure: without them a red CI run gives no way
    // to tell a real regression from a timing miss.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI: bundled Chromium from the pinned image. Local: the installed
        // Chrome, so a dev never has to download a second browser.
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
