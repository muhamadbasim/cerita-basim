import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@lib': resolve(__dirname, 'src/lib'),
      '@components': resolve(__dirname, 'src/components'),
      '@content': resolve(__dirname, 'src/content'),
    },
  },
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{astro,wrangler,git,cache}/**',
      // Local conflict archive — not part of the project, only noise in CI.
      '**/.archive-from-home-*/**',
    ],
  },
});
