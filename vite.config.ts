import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  publicDir: 'public',
  plugins: [
    webExtension({
      manifest: './src/manifest.json',
      watchFilePaths: ['src/**/*'],
      additionalInputs: ['src/viewer/index.html'],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
