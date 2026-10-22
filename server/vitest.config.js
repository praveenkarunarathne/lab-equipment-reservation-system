import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each integration suite starts a replica set; serialize first-run binary downloads.
  test: { fileParallelism: false },
});
