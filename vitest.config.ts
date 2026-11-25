import { defineConfig } from 'vitest/config';

// Unit tests cover pure, framework-free logic only (no Phaser/DOM import),
// so they run fast in Node. Runtime behaviour is verified by Playwright e2e.
//
// server/ is included because the deploy proxy's security boundaries (key
// isolation, rate limiting, breaker) are only meaningful over real HTTP; those
// tests spawn the actual service rather than mocking it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.mts'],
    // 代理测试会真的起进程、等端口，比纯函数慢，但不该拖累整个套件。
    testTimeout: 30_000,
  },
});
