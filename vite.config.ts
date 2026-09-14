import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { benchApi } from './server/api.ts';

const root = import.meta.dirname;

// Cross-origin isolation unlocks high-resolution performance.now() (Firefox/Safari clamp to ~1ms otherwise).
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [benchApi(root)],
  build: {
    target: 'es2022',
    outDir: 'dist',
    // public/assets holds the glTF models; keep emitted chunks out of that folder.
    assetsDir: 'bundle',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        bench: resolve(root, 'bench.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true, headers },
  preview: { port: 5173, strictPort: true, headers },
});
