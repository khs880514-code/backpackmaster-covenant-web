import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '../play',
    emptyOutDir: true,
    target: 'es2022'
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
