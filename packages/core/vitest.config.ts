import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `tsc` compiles in place (no outDir), leaving .js artifacts next to
    // every .ts source. Prefer the TypeScript sources so tests never
    // silently run stale compiled code.
    extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.ts', '**/*.config.ts'],
    },
  },
});
