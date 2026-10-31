import { defineConfig } from 'vitest/config';

// Requires both desktop and mobile dependencies; kept out of standalone builds.
export default defineConfig({
  test: { environment: 'node', include: ['integration/**/*.test.ts'] },
});
