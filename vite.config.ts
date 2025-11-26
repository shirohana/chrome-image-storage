import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import { copyFileSync, existsSync, renameSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

export default defineConfig(({ mode }) => ({
  publicDir: 'public',
  plugins: [
    webExtension({
      manifest: './src/manifest.json',
      additionalInputs: ['src/viewer/index.html'],
      disableAutoLaunch: mode === 'development',
    }),
    {
      name: 'watch-viewer-files',
      buildStart() {
        // Make Rollup watch all viewer files explicitly
        this.addWatchFile(resolve(__dirname, 'src/viewer/index.html'));
        this.addWatchFile(resolve(__dirname, 'src/viewer/style.css'));
        this.addWatchFile(resolve(__dirname, 'src/viewer/index.ts'));
      }
    },
    {
      name: 'copy-sql-wasm',
      writeBundle() {
        const distDir = resolve(__dirname, 'dist');
        const wasmSrc = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
        const wasmDest = resolve(distDir, 'sql-wasm.wasm');

        if (!existsSync(wasmDest) && existsSync(wasmSrc)) {
          copyFileSync(wasmSrc, wasmDest);
          console.log('Copied sql-wasm.wasm to dist/');
        } else if (!existsSync(wasmSrc)) {
          console.warn('Warning: sql-wasm.wasm not found in node_modules/sql.js/dist/');
        }
      }
    },
    {
      name: 'fix-underscore-files',
      writeBundle() {
        const distDir = resolve(__dirname, 'dist');

        const renamedFiles = renameUnderscoreFiles(distDir);
        if (Object.keys(renamedFiles).length > 0) {
          updateJsFilesRecursively(distDir, renamedFiles);
        }

        function renameUnderscoreFiles(dir: string) {
          const renamed: Record<string, string> = {};
          for (const file of readdirSync(dir)) {
            if (file.startsWith('_')) {
              const withoutUnderscore = file.substring(1);
              renameSync(join(dir, file), join(dir, withoutUnderscore));
              renamed[file] = withoutUnderscore;
              console.log(`Renamed ${file} -> ${withoutUnderscore}`);
            }
          }
          return renamed;
        }

        function replaceImportPaths(content: string, oldName: string, newName: string) {
          return content
            .replaceAll(`./${oldName}`, `./${newName}`)
            .replaceAll(`"${oldName}"`, `"${newName}"`);
        }

        function updateJsFilesRecursively(dir: string, fileMapping: Record<string, string>) {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              updateJsFilesRecursively(fullPath, fileMapping);
            } else if (entry.name.endsWith('.js')) {
              let content = readFileSync(fullPath, 'utf-8');
              const original = content;
              for (const [oldName, newName] of Object.entries(fileMapping)) {
                content = replaceImportPaths(content, oldName, newName);
              }
              if (content !== original) {
                writeFileSync(fullPath, content, 'utf-8');
                console.log(`Updated references in ${entry.name}`);
              }
            }
          }
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: mode !== 'development',
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
