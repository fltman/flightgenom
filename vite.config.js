import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: {
    port: 5190,
    proxy: {
      '/ws': { target: 'ws://localhost:8099', ws: true },
      '/api': { target: 'http://localhost:8099' },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
