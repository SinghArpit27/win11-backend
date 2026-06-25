import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ root: path.resolve(__dirname) })],
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['tests/unit/**/*.unit.test.ts'],
    setupFiles: ['./tests/setup/env.ts'],
    testTimeout: 30_000,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@common': path.resolve(__dirname, './src/common'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@modules': path.resolve(__dirname, './src/modules'),
    },
  },
});
