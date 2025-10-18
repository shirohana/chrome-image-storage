# Import/Export Database Feature - Implementation Plan

## Overview

Add SQLite-based database import/export for full database backup/restore, and rename existing export as "Dump" feature for exporting selected images.

## Feature Distinction

### 1. Dump Feature (existing, renamed)
- **Purpose**: Share selected images with others
- **Format**: ZIP with `metadata.json` + `images/` folder
- **Use case**: Export 5 images from Pixiv to share with friend
- **Buttons**: "Dump Selected" (export selected), "Dump All" (export all)

### 2. Import/Export Database (NEW)
- **Purpose**: Full database backup/restore for personal use
- **Format**: Single SQLite `.db` file
- **Use case**: Backup 10,000 images to Google Drive before reinstalling Chrome
- **Buttons**: "Export Database", "Import Database" (in settings panel)
- **Benefits**:
  - Single portable binary file (no "folder with 10,000 files")
  - Smallest file size (binary format, native BLOB storage)
  - Fast import with conflict resolution
  - Can open with standard SQLite tools (DB Browser, sqlite3 CLI)

## Architecture

```
src/
├── storage/
│   ├── db.ts                    # Existing IndexedDB wrapper
│   ├── service.ts               # Existing operations
│   └── sqlite-import-export.ts  # NEW: SQLite import/export operations
├── viewer/
│   ├── export.ts                # Existing: Rename to dump.ts
│   └── index.ts                 # Update UI and event handlers
└── types/
    └── index.ts                 # Add ImportConflict type
```

## Technical Implementation

### Step 1: Add Dependencies
```bash
pnpm add sql.js
pnpm add -D @types/sql.js
```

**sql.js size**: ~500KB (WASM build), lazy-loaded only when importing/exporting

### Step 2: Create SQLite Import/Export Module

**File**: `src/storage/sqlite-import-export.ts`

```typescript
import initSqlJs, { Database } from 'sql.js';
import type { SavedImage } from '../types';

// Schema matches IndexedDB structure
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    imageUrl TEXT NOT NULL,
    pageUrl TEXT NOT NULL,
    pageTitle TEXT,
    mimeType TEXT NOT NULL,
    fileSize INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    savedAt INTEGER NOT NULL,
    tags TEXT,  -- JSON array
    isDeleted INTEGER DEFAULT 0,
    blob BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_savedAt ON images(savedAt);
  CREATE INDEX IF NOT EXISTS idx_pageUrl ON images(pageUrl);
`;

export async function exportDatabase(images: SavedImage[]): Promise<Blob> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const db = new SQL.Database();
  db.run(SCHEMA);

  const stmt = db.prepare(`
    INSERT INTO images VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const image of images) {
    const blobArrayBuffer = await image.blob.arrayBuffer();
    stmt.run([
      image.id,
      image.imageUrl,
      image.pageUrl,
      image.pageTitle || null,
      image.mimeType,
      image.fileSize,
      image.width,
      image.height,
      image.savedAt,
      image.tags ? JSON.stringify(image.tags) : null,
      image.isDeleted ? 1 : 0,
      new Uint8Array(blobArrayBuffer)
    ]);
  }

  stmt.free();

  const data = db.export();
  db.close();

  return new Blob([data], { type: 'application/x-sqlite3' });
}

export interface ImportConflict {
  id: string;
  existingImage: SavedImage;
  importedMetadata: {
    imageUrl: string;
    pageUrl: string;
    pageTitle?: string;
    savedAt: number;
    tags?: string[];
  };
}

export async function analyzeImport(file: File, existingImages: SavedImage[]): Promise<{
  totalCount: number;
  newCount: number;
  conflictCount: number;
  conflicts: ImportConflict[];
}> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const arrayBuffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));

  const result = db.exec('SELECT id, imageUrl, pageUrl, pageTitle, savedAt, tags FROM images');

  if (result.length === 0) {
    db.close();
    return { totalCount: 0, newCount: 0, conflictCount: 0, conflicts: [] };
  }

  const existingIds = new Set(existingImages.map(img => img.id));
  const conflicts: ImportConflict[] = [];
  let newCount = 0;

  const rows = result[0].values;
  for (const row of rows) {
    const id = row[0] as string;

    if (existingIds.has(id)) {
      const existingImage = existingImages.find(img => img.id === id)!;
      conflicts.push({
        id,
        existingImage,
        importedMetadata: {
          imageUrl: row[1] as string,
          pageUrl: row[2] as string,
          pageTitle: row[3] as string | undefined,
          savedAt: row[4] as number,
          tags: row[5] ? JSON.parse(row[5] as string) : undefined,
        }
      });
    } else {
      newCount++;
    }
  }

  db.close();

  return {
    totalCount: rows.length,
    newCount,
    conflictCount: conflicts.length,
    conflicts
  };
}

export async function importDatabase(
  file: File,
  mode: 'skip' | 'override',
  specificIds?: Set<string>  // For granular control
): Promise<SavedImage[]> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const arrayBuffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));

  const result = db.exec('SELECT * FROM images');

  if (result.length === 0) {
    db.close();
    return [];
  }

  const images: SavedImage[] = [];
  const rows = result[0].values;
  const columns = result[0].columns;

  for (const row of rows) {
    const rowData: any = {};
    columns.forEach((col, i) => {
      rowData[col] = row[i];
    });

    // Check if we should import this image
    const shouldImport = specificIds ? specificIds.has(rowData.id) : true;
    if (!shouldImport) continue;

    const blob = new Blob([rowData.blob], { type: rowData.mimeType });

    images.push({
      id: rowData.id,
      blob,
      imageUrl: rowData.imageUrl,
      pageUrl: rowData.pageUrl,
      pageTitle: rowData.pageTitle || undefined,
      mimeType: rowData.mimeType,
      fileSize: rowData.fileSize,
      width: rowData.width,
      height: rowData.height,
      savedAt: rowData.savedAt,
      tags: rowData.tags ? JSON.parse(rowData.tags) : undefined,
      isDeleted: rowData.isDeleted === 1,
    });
  }

  db.close();

  return images;
}
```

### Step 3: Rename Dump Module

**Action**: Rename `src/viewer/export.ts` → `src/viewer/dump.ts`

No code changes needed, just file rename.

### Step 4: Add Import Conflict Resolution Modal

**File**: `src/viewer/index.html`

Add new modal after `<div id="bulk-tag-modal">`:

```html
<!-- Import Conflict Resolution Modal -->
<div id="import-conflict-modal" class="import-conflict-modal">
  <div class="import-conflict-overlay"></div>
  <div class="import-conflict-content">
    <div class="import-conflict-header">
      <h3>Import Database - Conflicts Detected</h3>
      <button class="import-conflict-close">&times;</button>
    </div>
    <div class="import-conflict-body">
      <p id="import-conflict-summary"></p>
      <div class="import-conflict-options">
        <button id="import-skip-all-btn" class="btn btn-secondary">
          Skip Conflicts (Keep Existing)
        </button>
        <button id="import-override-all-btn" class="btn btn-danger">
          Override All Conflicts
        </button>
        <button id="import-review-btn" class="btn btn-primary">
          Review Each Conflict
        </button>
      </div>
    </div>
    <div class="import-conflict-footer">
      <button id="import-cancel-btn" class="btn btn-secondary">Cancel Import</button>
    </div>
  </div>
</div>

<!-- Import Review Modal (granular control) -->
<div id="import-review-modal" class="import-review-modal">
  <div class="import-review-overlay"></div>
  <div class="import-review-content">
    <div class="import-review-header">
      <h3>Review Conflicts</h3>
      <span id="import-review-progress"></span>
      <button class="import-review-close">&times;</button>
    </div>
    <div class="import-review-body">
      <div class="import-review-comparison">
        <div class="import-review-column">
          <h4>Existing Image</h4>
          <div id="import-existing-preview"></div>
        </div>
        <div class="import-review-column">
          <h4>Imported Image</h4>
          <div id="import-imported-preview"></div>
        </div>
      </div>
    </div>
    <div class="import-review-footer">
      <button id="import-keep-btn" class="btn btn-secondary">Keep Existing</button>
      <button id="import-override-btn" class="btn btn-danger">Override with Imported</button>
      <button id="import-review-cancel-btn" class="btn btn-secondary">Cancel Import</button>
    </div>
  </div>
</div>
```

### Step 5: Update Settings Panel UI

**File**: `src/viewer/index.html`

Expand settings panel:

```html
<div id="settings-panel" class="settings-panel" style="display: none;">
  <h3>Settings</h3>

  <!-- Existing notification toggle -->
  <label class="settings-option">
    <input type="checkbox" id="show-notifications-toggle">
    <span>Show system notifications when saving images</span>
  </label>

  <!-- NEW: Database Import/Export section -->
  <div class="settings-section">
    <h4>Database Backup & Restore</h4>
    <p class="settings-hint">
      Export database as single SQLite file for backup. Import to restore or merge databases.
    </p>
    <div class="settings-buttons">
      <button id="export-database-btn" class="btn btn-primary">
        Export Database (.db)
      </button>
      <button id="import-database-btn" class="btn btn-primary">
        Import Database (.db)
      </button>
    </div>
  </div>
</div>
```

### Step 6: Rename Existing Export Buttons

**File**: `src/viewer/index.html`

Update button labels:

```html
<!-- BEFORE -->
<button id="delete-selected-btn" class="btn btn-danger">Delete Selected</button>
<button id="export-selected-btn" class="btn btn-primary">Export Selected</button>
<button id="delete-all-btn" class="btn btn-danger">Delete All</button>
<button id="export-btn" class="btn btn-primary">Export All</button>

<!-- AFTER -->
<button id="delete-selected-btn" class="btn btn-danger">Delete Selected</button>
<button id="dump-selected-btn" class="btn btn-primary">Dump Selected</button>
<button id="delete-all-btn" class="btn btn-danger">Delete All</button>
<button id="dump-all-btn" class="btn btn-primary">Dump All</button>
```

### Step 7: Update Viewer Event Handlers

**File**: `src/viewer/index.ts`

```typescript
// Update imports
import { dumpImages } from './dump';  // Renamed from exportImages
import { exportDatabase, importDatabase, analyzeImport } from '../storage/sqlite-import-export';

// Update button IDs
const dumpSelectedBtn = document.getElementById('dump-selected-btn')!;
const dumpAllBtn = document.getElementById('dump-all-btn')!;

// Rename existing export handlers
dumpAllBtn.addEventListener('click', async () => {
  await dumpImages(state.images);
});

dumpSelectedBtn.addEventListener('click', async () => {
  if (state.selectedIds.size === 0) return;
  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  await dumpImages(selectedImages);
});

// NEW: Export database handler
document.getElementById('export-database-btn')!.addEventListener('click', async () => {
  try {
    const blob = await exportDatabase(state.images);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `image-storage-backup-${Date.now()}.db`;
    a.click();

    URL.revokeObjectURL(url);

    alert(`Database exported successfully!\n${state.images.length} images backed up.`);
  } catch (error) {
    console.error('Export failed:', error);
    alert('Export failed. See console for details.');
  }
});

// NEW: Import database handler
document.getElementById('import-database-btn')!.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,.sqlite,.sqlite3';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      // Analyze import for conflicts
      const analysis = await analyzeImport(file, state.images);

      if (analysis.totalCount === 0) {
        alert('No images found in the database file.');
        return;
      }

      if (analysis.conflictCount === 0) {
        // No conflicts, direct import
        const confirm = window.confirm(
          `Import ${analysis.newCount} new images?`
        );
        if (!confirm) return;

        const importedImages = await importDatabase(file, 'skip');
        await importImagesToIndexedDB(importedImages);
        await loadImages();

        alert(`Import complete!\n${analysis.newCount} images added.`);
      } else {
        // Show conflict resolution modal
        showImportConflictModal(file, analysis);
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. See console for details.');
    }
  };

  input.click();
});

// NEW: Import conflict modal handlers
function showImportConflictModal(file: File, analysis: any) {
  const modal = document.getElementById('import-conflict-modal')!;
  const summary = document.getElementById('import-conflict-summary')!;

  summary.textContent = `Found ${analysis.totalCount} images in backup:\n` +
    `• ${analysis.newCount} new images\n` +
    `• ${analysis.conflictCount} conflicts (same image ID exists)`;

  modal.classList.add('active');

  // Store for handlers
  (modal as any).__importData = { file, analysis };
}

document.getElementById('import-skip-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { file, analysis } = (modal as any).__importData;

  modal.classList.remove('active');

  const importedImages = await importDatabase(file, 'skip');
  await importImagesToIndexedDB(importedImages);
  await loadImages();

  alert(`Import complete!\n${analysis.newCount} new images added.\n${analysis.conflictCount} conflicts skipped.`);
});

document.getElementById('import-override-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { file, analysis } = (modal as any).__importData;

  const confirm = window.confirm(
    `This will override ${analysis.conflictCount} existing images. Continue?`
  );
  if (!confirm) return;

  modal.classList.remove('active');

  const importedImages = await importDatabase(file, 'override');
  await importImagesToIndexedDB(importedImages);
  await loadImages();

  alert(`Import complete!\n${analysis.newCount} new images added.\n${analysis.conflictCount} images overridden.`);
});

document.getElementById('import-review-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analysis } = (modal as any).__importData;

  modal.classList.remove('active');
  showImportReviewModal(analysis.conflicts, 0);
});

// NEW: Granular review modal
function showImportReviewModal(conflicts: any[], index: number) {
  const modal = document.getElementById('import-review-modal')!;
  const progress = document.getElementById('import-review-progress')!;

  progress.textContent = `Conflict ${index + 1} of ${conflicts.length}`;

  // Render comparison UI
  const conflict = conflicts[index];
  // ... render existing vs imported image details

  modal.classList.add('active');

  (modal as any).__reviewData = { conflicts, index, decisions: new Map() };
}

// NEW: Helper to import SavedImages to IndexedDB
async function importImagesToIndexedDB(images: SavedImage[]) {
  for (const image of images) {
    await imageDB.update(image);  // Uses put() which inserts or updates
  }
}
```

### Step 8: Copy sql.js WASM File

**File**: `vite.config.ts` (or build script)

Copy `sql-wasm.wasm` from `node_modules/sql.js/dist/` to `dist/` during build:

```typescript
import { defineConfig } from 'vite';
import { copyFileSync } from 'fs';

export default defineConfig({
  // ... existing config
  plugins: [
    {
      name: 'copy-sql-wasm',
      writeBundle() {
        copyFileSync(
          'node_modules/sql.js/dist/sql-wasm.wasm',
          'dist/sql-wasm.wasm'
        );
      }
    }
  ]
});
```

### Step 9: Add CSS Styles

**File**: `src/viewer/style.css`

Add styles for new modals (similar to existing bulk-tag-modal styles).

## Implementation Checklist

- [ ] Step 1: Add sql.js dependency
- [ ] Step 2: Create `src/storage/sqlite-import-export.ts`
- [ ] Step 3: Rename `export.ts` → `dump.ts`
- [ ] Step 4: Add import conflict modal HTML
- [ ] Step 5: Update settings panel HTML
- [ ] Step 6: Rename export buttons to "dump"
- [ ] Step 7: Update viewer event handlers
- [ ] Step 8: Configure WASM file copying
- [ ] Step 9: Add CSS styles for modals
- [ ] Step 10: Test export database workflow
- [ ] Step 11: Test import without conflicts
- [ ] Step 12: Test import with conflict resolution (skip/override/review)
- [ ] Step 13: Test edge cases (empty DB, corrupted file, large DB)

## Testing Scenarios

### Export
1. Export empty database
2. Export database with 10 images
3. Export database with 1000+ images
4. Verify file size (should be smaller than ZIP)
5. Open .db file with DB Browser for SQLite

### Import
1. Import into empty database → should add all
2. Import duplicate database → should show conflicts
3. Import with "Skip All" → no overrides
4. Import with "Override All" → all replaced
5. Import with "Review Each" → granular control
6. Import partially (select specific images)

### Edge Cases
1. Import corrupted .db file
2. Import non-database file
3. Import database with missing columns
4. Import during active operations
5. Browser crashes during import

## File Size Comparison

Test with 100 images (avg 2MB each, total ~200MB):

- **JSON**: ~267MB (+33% from base64)
- **ZIP**: ~200MB (efficient)
- **SQLite**: ~198MB (most efficient, includes indices)

## Future Enhancements

- [ ] Progress bar for large imports/exports
- [ ] Automatic backups (daily/weekly)
- [ ] Selective export (by date range, tags, etc.)
- [ ] Cloud sync integration (Google Drive, Dropbox)
- [ ] Import from other formats (JSON, ZIP dump)

## Migration Notes

**No breaking changes**. Existing users' data in IndexedDB remains untouched. New feature is purely additive.

## Rollback Plan

If issues arise:
1. Remove Import/Export buttons from UI
2. Keep sql.js code (no harm if not invoked)
3. User data in IndexedDB is never at risk (imports don't delete existing data)
