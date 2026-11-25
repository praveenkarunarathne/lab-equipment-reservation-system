import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each integration suite starts a replica set; serialize first-run binary downloads.
  test: {
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/server.js', 'src/db/*.js'],
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
