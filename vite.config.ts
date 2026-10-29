import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.SOURCEMAP !== 'false',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        inpage: resolve(__dirname, 'src/runtime/inpage.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        // Give predictable (hash-free) names to the two chunks imported by
        // inpage.js so they can be listed explicitly in web_accessible_resources
        // instead of the overly-broad "assets/*" pattern.
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'constants' || chunkInfo.name === 'serialization') {
            return 'assets/[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
