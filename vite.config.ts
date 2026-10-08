import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: './',
  cacheDir: runningAsRoot ? path.join(os.tmpdir(), 'agent-desk-vite-cache-root') : undefined,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/')) return 'terminal';
          if (id.includes('/node_modules/')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
