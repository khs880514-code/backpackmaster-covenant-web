import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Nothing in the shipped build should log; the messages only cost bytes and
  // a little main-thread time on a phone.
  esbuild: {
    drop: ['console', 'debugger']
  },
  build: {
    outDir: '../play',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Three.js is ~85% of the bundle and never changes between builds, so
        // it gets its own long-lived chunk instead of being re-downloaded with
        // every gameplay tweak.
        manualChunks: {
          three: ['three']
        }
      }
    }
  },
  server: {
    port: 4173,
    strictPort: true
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    css: false
  }
});
