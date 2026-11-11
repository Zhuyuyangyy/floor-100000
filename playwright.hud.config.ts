import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// A dedicated server prevents a HUD review from accidentally testing an older
// checkout already running on the usual development port.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5175' },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
