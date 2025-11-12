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
    tags TEXT,
    isDeleted INTEGER DEFAULT 0,
    rating TEXT,
    blob BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_savedAt ON images(savedAt);
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

export async function exportDatabase(images: SavedImage[]): Promise<Blob> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const db = new SQL.Database();
  db.run(SCHEMA);

  const stmt = db.prepare(`
    INSERT INTO images VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      image.rating || null,
      new Uint8Array(blobArrayBuffer)
    ]);
  }

  stmt.free();

  const data = db.export();
  db.close();

  return new Blob([data], { type: 'application/x-sqlite3' });
}

export async function analyzeImport(file: File, existingImages: SavedImage[]): Promise<ImportAnalysis> {
  const SQL = await initSqlJs({
    locateFile: file => `/sql-wasm.wasm`
  });

  const arrayBuffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));

  const result = db.exec('SELECT id, imageUrl, pageUrl, pageTitle, savedAt, tags, rating FROM images');

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
          tags: row[5] ? JSON.parse(row[5] as string) : undefined,
          rating: (row[6] as string) || undefined,
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
