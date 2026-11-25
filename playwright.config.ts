import { defineConfig, devices } from '@playwright/test';

// Local runs use the installed Google Chrome (channel: 'chrome') so no extra
// browser download is needed. CI runs the bundled Chromium from the pinned
// Playwright image instead: the runner's preinstalled Chrome version changed
// between runs, which is one of the reasons the same commit could pass or fail.
// Port is overridable so concurrent work does not collide on a single dev
// server. The main suite (5173) and the art audit (5731) can then run
// side by side with a third suite on its own port. The default is unchanged,
// which is what CI relies on — CI passes no E2E_PORT and gets 5173 as before.
//
// Why a variable rather than a second config file: this suite and the audit
// suite differ only in port and browser channel. A whole second config would
// drift from this one (the audit config already has, on `reuseExistingServer`),
// and a drifting duplicate is worse than one file with a knob.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    // Keep the artefacts of a failure: without them a red CI run gives no way
    // to tell a real regression from a timing miss.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // The command has to carry the port too: `npm run dev` is pinned to 5173 by
    // vite.config.ts's strictPort, so a different E2E_PORT without a matching
    // flag would either fail to bind or silently serve the wrong port.
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
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
