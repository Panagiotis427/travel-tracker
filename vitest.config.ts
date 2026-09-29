import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic (sync bookkeeping, share codec, dates, markers, fit maths).
// A separate config so tests don't load the app's PWA/build plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
