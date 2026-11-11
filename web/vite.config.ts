import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const OUT = resolve(__dirname, '../app/web');

/** Traegt die Version in den Service Worker ein, damit jede Version ihren eigenen Puffer hat. */
function stampServiceWorker(): Plugin {
  return {
    name: 'kestrel-stamp-sw',
    apply: 'build',
    closeBundle() {
      const version = readFileSync(resolve(__dirname, '../VERSION'), 'utf8').trim();
      const file = resolve(OUT, 'sw.js');
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__KESTREL_VERSION__', version));
    },
  };
}

// Gebaut wird nach ../app/web - von dort liefert das Python-Backend die Oberflaeche aus.
export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  base: './',
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: { '/api': 'http://localhost:5000' },
  },
});
