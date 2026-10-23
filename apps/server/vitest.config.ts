import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @gamekeeper/core compiles in place (no outDir), leaving .js artifacts
    // next to every .ts source. Prefer TypeScript sources so tests never
    // silently run stale compiled code.
    extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
