import { defineConfig } from 'vitest/config';

// Core and its tests are DOM-free, so the plain node environment is used.
// Tests import describe/it/expect from 'vitest' explicitly (no globals).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
