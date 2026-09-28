import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname } },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
