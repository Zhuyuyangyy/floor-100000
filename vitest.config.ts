import { defineConfig } from 'vitest/config';

// Unit tests cover pure, framework-free logic only (no Phaser/DOM import),
// so they run fast in Node. Runtime behaviour is verified by Playwright e2e.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
