import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import { copyFileSync, existsSync, renameSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

export default defineConfig({
  publicDir: 'public',
  plugins: [
    webExtension({
      manifest: './src/manifest.json',
      watchFilePaths: ['src/**/*'],
      additionalInputs: ['src/viewer/index.html'],
    }),
    {
      name: 'copy-sql-wasm-and-fix-underscore-files',
      writeBundle() {
        const distDir = resolve(__dirname, 'dist');

        // Copy WASM file
        const wasmSrc = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
        const wasmDest = resolve(distDir, 'sql-wasm.wasm');

        if (existsSync(wasmSrc)) {
          copyFileSync(wasmSrc, wasmDest);
          console.log('Copied sql-wasm.wasm to dist/');
        } else {
          console.warn('Warning: sql-wasm.wasm not found in node_modules/sql.js/dist/');
        }

        // Fix underscore-prefixed files (Chrome extension restriction)
        const files = readdirSync(distDir);
        const renamedFiles: Record<string, string> = {};

        for (const file of files) {
          if (file.startsWith('_')) {
            const oldPath = join(distDir, file);
            const newName = file.substring(1); // Remove leading underscore
            const newPath = join(distDir, newName);
            renameSync(oldPath, newPath);
            renamedFiles[file] = newName;
            console.log(`Renamed ${file} -> ${newName}`);
          }
        }

        // Update references to renamed files in all JS files
        if (Object.keys(renamedFiles).length > 0) {
          function updateReferencesInDir(dir: string) {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = join(dir, entry.name);
              if (entry.isDirectory()) {
                updateReferencesInDir(fullPath);
              } else if (entry.name.endsWith('.js')) {
                let content = readFileSync(fullPath, 'utf-8');
                let modified = false;

                for (const [oldName, newName] of Object.entries(renamedFiles)) {
                  // Handle import statements: ./_commonjsHelpers.js
                  const oldRef = `./${oldName}`;
                  const newRef = `./${newName}`;
                  if (content.includes(oldRef)) {
                    content = content.replaceAll(oldRef, newRef);
                    modified = true;
                  }

                  // Handle string literals in arrays: "_commonjsHelpers.js"
                  const oldQuoted = `"${oldName}"`;
                  const newQuoted = `"${newName}"`;
                  if (content.includes(oldQuoted)) {
                    content = content.replaceAll(oldQuoted, newQuoted);
                    modified = true;
                  }
                }

                if (modified) {
                  writeFileSync(fullPath, content, 'utf-8');
                  console.log(`Updated references in ${entry.name}`);
                }
              }
            }
          }

          updateReferencesInDir(distDir);
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
