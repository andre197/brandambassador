import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one Postgres test database.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // light-my-request require()s the ESM-only `cookie`; Node before 20.19 cannot, so let Vite transform it.
    server: { deps: { inline: ['light-my-request'] } },
  },
});
