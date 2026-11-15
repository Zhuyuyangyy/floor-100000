import { defineConfig, devices } from '@playwright/test';

// Local runs use the installed Google Chrome (channel: 'chrome') so no extra
// browser download is needed. CI runs the bundled Chromium from the pinned
// Playwright image instead: the runner's preinstalled Chrome version changed
// between runs, which is one of the reasons the same commit could pass or fail.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  // The dev-server identity guard. strictPort (below) only makes a PORT
  // collision loud; it cannot see the CODE behind the port, and
  // reuseExistingServer reuses any server that answers — including one rooted
  // in another worktree. This globalSetup fingerprints the server before any
  // test runs and fails loudly when the code it serves is not this worktree's.
  // Rationale and mechanics: e2e/verifyServerIdentity.ts.
  globalSetup: './e2e/verifyServerIdentity.ts',
  use: {
    // 5199, not the default 5173: several agents run `npm run dev` in parallel
    // worktrees, and when two servers raced for 5173 the loser either died
    // (strictPort) or silently took another port, so Playwright's health check
    // could land on a *different branch's* dev server — green runs that tested
    // the wrong code, red runs that were never broken. An uncommon port plus
    // --strictPort in the webServer command makes a collision loud instead of
    // silent (BUG-QA-05 的假失败来源之一). strictPort still cannot catch a
    // server that is already up and serving a DIFFERENT worktree's code — the
    // globalSetup above is what closes that hole.
    baseURL: 'http://localhost:5199',
    // Keep the artefacts of a failure: without them a red CI run gives no way
    // to tell a real regression from a timing miss.
    //
    // Policy is failure-only by design: trace retain-on-failure, screenshot
    // only-on-failure, video off. What made teardown pathological was NOT this
    // policy but accumulation — test-results/ had grown to 16738 files / 1.1G
    // of stale traces across runs (BUG-QA-03), and Playwright wipes outputDir
    // at startup. Clean the directory between rounds; the CI job keeps its own
    // copies as artifacts for 7 days, so local traces have no lasting value.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // The port override is required because vite.config.ts pins 5173; the CLI
    // flag wins over the config file. strictPort turns "port busy" into a loud
    // startup failure rather than a silent fallback to a random port.
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
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
