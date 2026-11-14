// QA worktree runner (ag-03): the shared dev server on :5173 belongs to the
// main workspace, so e2e run from this worktree boots its own Vite on a private
// port — reusing the main workspace's server would test the main tree's code.
// The private outputDir keeps this tree's 1.1G of legacy test-results/ traces
// out of Playwright's startup cleanup, which the environment's bulk-delete
// guard rejects.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5183' },
  outputDir: 'test-results-qa',
  webServer: {
    command: 'npm run dev -- --port 5183 --strictPort',
    url: 'http://localhost:5183',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome' as const,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
