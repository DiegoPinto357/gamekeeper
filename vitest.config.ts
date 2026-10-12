import { defineConfig } from 'vitest/config';

// Root vitest config: runs tests across all workspaces via projects
export default defineConfig({
  test: {
    projects: [
      './packages/core/vitest.config.ts',
      './apps/server/vitest.config.ts',
      './apps/web/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.ts', '**/*.config.ts'],
    },
  },
});
