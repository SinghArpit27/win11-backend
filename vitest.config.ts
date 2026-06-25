import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for backend integration tests.
 * Path aliases mirror `tsconfig.json` so tests import the same modules as production code.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ root: path.resolve(__dirname) })],
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['tests/integration/**/*.integration.test.ts'],
    setupFiles: ['./tests/setup/env.ts', './tests/setup/vitest.setup.ts'],
    globalSetup: ['./tests/setup/globalSetup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    /** Shared MongoDB — run files sequentially to avoid cross-test pollution. */
    fileParallelism: false,
    pool: 'forks',
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@loaders': path.resolve(__dirname, './src/loaders'),
      '@queues': path.resolve(__dirname, './src/queues'),
      '@sockets': path.resolve(__dirname, './src/sockets'),
      '@jobs': path.resolve(__dirname, './src/jobs'),
      '@events': path.resolve(__dirname, './src/events'),
    },
  },
});
