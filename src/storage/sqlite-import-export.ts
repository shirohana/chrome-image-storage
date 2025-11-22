import initSqlJs, { Database } from 'sql.js';
import type { SavedImage } from '../types';
import { getImageBlob } from './service';

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
    updatedAt INTEGER,
    tags TEXT,
    isDeleted INTEGER DEFAULT 0,
    rating TEXT,
    blob BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_savedAt ON images(savedAt);
  CREATE INDEX IF NOT EXISTS idx_updatedAt ON images(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_pageUrl ON images(pageUrl);
  CREATE INDEX IF NOT EXISTS idx_rating ON images(rating);
`;

export interface ImportConflict {
  id: string;
  existingImage: SavedImage;
  importedMetadata: {
    imageUrl: string;
    pageUrl: string;
    pageTitle?: string;
    savedAt: number;
    updatedAt?: number;
    tags?: string[];
    rating?: 'g' | 's' | 'q' | 'e';
  };
}

export interface ImportAnalysis {
  totalCount: number;
  newCount: number;
  conflictCount: number;
  conflicts: ImportConflict[];
  db: Database; // Keep database open for blob fetching during review
}

export async function exportDatabase(
  imagesMetadata: Omit<SavedImage, 'blob'>[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob[]> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  // Split into multiple database files to avoid memory allocation errors
  // Each chunk contains max 200 images (~500MB-1GB per file)
  const IMAGES_PER_FILE = 200;
  const chunks: Blob[] = [];
  const totalImages = imagesMetadata.length;

  for (let fileIndex = 0; fileIndex < Math.ceil(totalImages / IMAGES_PER_FILE); fileIndex++) {
    const db = new SQL.Database();
    db.run(SCHEMA);

    const stmt = db.prepare(`
      INSERT INTO images VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const startIdx = fileIndex * IMAGES_PER_FILE;
    const endIdx = Math.min(startIdx + IMAGES_PER_FILE, totalImages);
    const chunkMetadata = imagesMetadata.slice(startIdx, endIdx);

    // Process images in smaller batches for blob loading
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkMetadata.length; i += BATCH_SIZE) {
      const batch = chunkMetadata.slice(i, i + BATCH_SIZE);

      for (const metadata of batch) {
        // Load blob on-demand for each image
        const blob = await getImageBlob(metadata.id);
        if (!blob) {
          console.warn(`Skipping image ${metadata.id}: blob not found`);
          continue;
        }

        const blobArrayBuffer = await blob.arrayBuffer();
        stmt.run([
          metadata.id,
          metadata.imageUrl,
          metadata.pageUrl,
          metadata.pageTitle || null,
          metadata.mimeType,
          metadata.fileSize,
          metadata.width,
          metadata.height,
          metadata.savedAt,
          metadata.updatedAt || null,
          metadata.tags ? JSON.stringify(metadata.tags) : null,
          metadata.isDeleted ? 1 : 0,
          metadata.rating || null,
          new Uint8Array(blobArrayBuffer)
        ]);
      }
    }

    stmt.free();

    const data = db.export();
    db.close();

    chunks.push(new Blob([data], { type: 'application/x-sqlite3' }));

    if (onProgress) {
      onProgress(endIdx, totalImages);
    }
  }

  return chunks;
}

export async function analyzeImport(file: File, existingImages: SavedImage[]): Promise<ImportAnalysis> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const arrayBuffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));

  const result = db.exec('SELECT id, imageUrl, pageUrl, pageTitle, savedAt, updatedAt, tags, rating FROM images');

  if (result.length === 0) {
    db.close();
    return { totalCount: 0, newCount: 0, conflictCount: 0, conflicts: [], db };
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
          updatedAt: (row[5] as number) || undefined,
          tags: row[6] ? JSON.parse(row[6] as string) : undefined,
          rating: (row[7] as string) || undefined,
        }
      });
    } else {
      newCount++;
    }
  }

  // Don't close database - caller needs it for blob fetching during review
  // Caller is responsible for closing it with closeImportDatabase(db)

  return {
    totalCount: rows.length,
    newCount,
    conflictCount: conflicts.length,
    conflicts,
    db
  };
}

export async function importDatabase(
  file: File,
  mode: 'skip' | 'override',
  specificIds?: Set<string>
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
      updatedAt: rowData.updatedAt || undefined,
      tags: rowData.tags ? JSON.parse(rowData.tags) : undefined,
      isDeleted: rowData.isDeleted === 1,
      rating: rowData.rating || undefined,
    });
  }

  db.close();

  return images;
}

export function getImageBlobFromDatabase(db: Database, imageId: string): Blob | null {
  const result = db.exec('SELECT blob, mimeType FROM images WHERE id = ?', [imageId]);

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const blobData = row[0] as Uint8Array;
  const mimeType = row[1] as string;

  return new Blob([blobData], { type: mimeType });
}

export function getImageMetadataFromDatabase(db: Database, imageId: string): { fileSize: number; width: number; height: number; mimeType: string } | null {
  const result = db.exec('SELECT fileSize, width, height, mimeType FROM images WHERE id = ?', [imageId]);

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  return {
    fileSize: row[0] as number,
    width: row[1] as number,
    height: row[2] as number,
    mimeType: row[3] as string,
  };
}

export function closeImportDatabase(db: Database) {
  db.close();
}
