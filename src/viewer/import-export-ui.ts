import type { SavedImage } from '../types';
import { state } from './state';
import { getAllImagesMetadata } from '../storage/service';
import { loadImageBlob, getOrCreateObjectURL } from './blobs';
import { formatFileSize } from './format';

/**
 * Wires up the SQLite/local-files import & export UI.
 * Call once at bootstrap; `reload` refreshes the grid after an import.
 */
export function initImportExport(reload: () => Promise<void>) {
// Database Import/Export handlers
// Import local files button handler
document.getElementById('import-local-files-btn')!.addEventListener('click', async () => {
  // Create hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;

  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    try {
      const { importLocalFiles } = await import('../storage/service');
      const importedImages = await importLocalFiles(files);

      // Reload images to reflect the new imports
      await reload();
    } catch (error) {
      console.error('Failed to import files:', error);
      alert(`Failed to import files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  fileInput.click();
});

document.getElementById('export-database-btn')!.addEventListener('click', async () => {
  try {
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support folder selection. Please use Chrome/Edge 86+ or enable the feature flag.');
      return;
    }

    // Ask user to select export folder
    const dirHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });

    // Show progress modal
    const progressModal = document.getElementById('export-progress-modal')!;
    const progressText = document.getElementById('export-progress-text')!;
    const progressFill = document.getElementById('export-progress-fill')!;
    const progressDetail = document.getElementById('export-progress-detail')!;

    progressModal.classList.add('active');
    progressText.textContent = 'Preparing export...';
    progressFill.style.width = '0%';
    progressDetail.textContent = '';

    const { exportDatabase } = await import('../storage/sqlite-import-export');
    const allImagesMetadata = await getAllImagesMetadata();

    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const backupFolderName = `image-storage-backup-${dateStr}-${timestamp}`;

    // Create backup folder
    const backupDir = await dirHandle.getDirectoryHandle(backupFolderName, { create: true });

    const chunks = await exportDatabase(allImagesMetadata, (current, total) => {
      const percent = Math.round((current / total) * 100);
      progressText.textContent = `Exporting images...`;
      progressFill.style.width = `${percent}%`;
      progressDetail.textContent = `${current} / ${total} images`;
    });

    // Write each chunk to the backup folder
    progressText.textContent = 'Writing files...';
    progressDetail.textContent = `${chunks.length} file(s)`;

    for (let i = 0; i < chunks.length; i++) {
      const fileName = chunks.length === 1
        ? 'database.db'
        : `database-part${i + 1}of${chunks.length}.db`;

      progressDetail.textContent = `Writing ${fileName}...`;

      const fileHandle = await backupDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(chunks[i]);
      await writable.close();
    }

    // Write manifest file with backup metadata
    progressDetail.textContent = 'Writing manifest...';

    const manifest = {
      exportedAt: timestamp,
      totalImages: state.images.length,
      files: chunks.length,
      version: '1.0'
    };

    const manifestHandle = await backupDir.getFileHandle('manifest.json', { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(JSON.stringify(manifest, null, 2));
    await manifestWritable.close();

    // Close progress modal
    progressModal.classList.remove('active');

    const message = chunks.length === 1
      ? `Backup completed!\n${state.images.length} images exported to:\n${backupFolderName}/database.db`
      : `Backup completed!\n${state.images.length} images exported to:\n${backupFolderName}/ (${chunks.length} files)`;

    alert(message);
  } catch (error) {
    // Close progress modal on error
    const progressModal = document.getElementById('export-progress-modal')!;
    progressModal.classList.remove('active');

    console.error('Export failed:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      // User cancelled folder selection
      return;
    }
    alert('Export failed. See console for details.');
  }
});

document.getElementById('import-database-btn')!.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,.sqlite,.sqlite3';
  input.multiple = true; // Allow multiple file selection

  input.onchange = async () => {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    try {
      const { analyzeImport, closeImportDatabase } = await import('../storage/sqlite-import-export');

      // Analyze all files and aggregate results
      const analyses = [];
      let totalNew = 0;
      let totalConflicts = 0;
      let totalImages = 0;
      const allConflicts = [];

      for (const file of files) {
        const analysis = await analyzeImport(file, state.images);
        analyses.push({ file, analysis });
        totalNew += analysis.newCount;
        totalConflicts += analysis.conflictCount;
        totalImages += analysis.totalCount;
        allConflicts.push(...analysis.conflicts);
      }

      if (totalImages === 0) {
        // Close all databases
        for (const { analysis } of analyses) {
          closeImportDatabase(analysis.db);
        }
        alert('No images found in the selected files.');
        return;
      }

      if (totalConflicts === 0) {
        // No conflicts, direct import all files
        const fileText = files.length === 1 ? 'file' : `${files.length} files`;
        const confirmed = window.confirm(
          `Import ${totalNew} new images from ${fileText}?`
        );
        if (!confirmed) {
          for (const { analysis } of analyses) {
            closeImportDatabase(analysis.db);
          }
          return;
        }

        const { importDatabase } = await import('../storage/sqlite-import-export');

        // Import all files sequentially
        for (const { file, analysis } of analyses) {
          const importedImages = await importDatabase(file, 'skip');
          closeImportDatabase(analysis.db);
          await importImagesToIndexedDB(importedImages);
        }

        await reload();

        alert(`Import complete!\n${totalNew} images added from ${files.length} file(s).`);
      } else {
        // Show conflict resolution modal for all files (dbs will be closed by modal handlers)
        showImportConflictModal(analyses, { totalNew, totalConflicts, totalImages, allConflicts });
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. See console for details.');
    }
  };

  input.click();
});

// Helper to import SavedImages to IndexedDB
async function importImagesToIndexedDB(images: SavedImage[]) {
  const { imageDB } = await import('../storage/db');
  for (const image of images) {
    await imageDB.update(image);  // Uses put() which inserts or updates
  }
}

// Import conflict modal handlers
function showImportConflictModal(analyses: any[], aggregatedData: any) {
  const modal = document.getElementById('import-conflict-modal')!;
  const summary = document.getElementById('import-conflict-summary')!;

  const fileText = analyses.length === 1 ? 'file' : `${analyses.length} files`;
  summary.textContent = `Found ${aggregatedData.totalImages} images in ${fileText}:\n• ${aggregatedData.totalNew} new images\n• ${aggregatedData.totalConflicts} conflicts (same image ID exists)`;

  modal.classList.add('active');

  // Store for handlers (including dbs for blob fetching)
  (modal as any).__importData = { analyses, aggregatedData };
}

async function closeImportConflictModal() {
  const modal = document.getElementById('import-conflict-modal')!;
  const importData = (modal as any).__importData;

  // Close all databases if they exist
  if (importData?.analyses) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    for (const { analysis } of importData.analyses) {
      if (analysis?.db) {
        closeImportDatabase(analysis.db);
      }
    }
  }

  modal.classList.remove('active');
}

document.getElementById('import-skip-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const existingIds = new Set(state.images.map(img => img.id));

    // Import all files, skipping conflicts
    for (const { file, analysis } of analyses) {
      const importedImages = await importDatabase(file, 'skip');
      closeImportDatabase(analysis.db);

      // Filter out conflicts (only import new images)
      const newImages = importedImages.filter(img => !existingIds.has(img.id));

      await importImagesToIndexedDB(newImages);
    }

    await reload();

    alert(`Import complete!\n${aggregatedData.totalNew} new images added.\n${aggregatedData.totalConflicts} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-override-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  const confirmed = window.confirm(
    `This will override ${aggregatedData.totalConflicts} existing images. Continue?`
  );
  if (!confirmed) return;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');

    // Import all files, overriding conflicts
    for (const { file, analysis } of analyses) {
      const importedImages = await importDatabase(file, 'override');
      closeImportDatabase(analysis.db);
      await importImagesToIndexedDB(importedImages);
    }

    await reload();

    alert(`Import complete!\n${aggregatedData.totalNew} new images added.\n${aggregatedData.totalConflicts} images overridden.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-review-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  modal.classList.remove('active');

  // For review mode with multiple files, we need to keep track of which file each conflict belongs to
  // Create enhanced conflicts array with file and db references
  const enhancedConflicts = analyses.flatMap(({ file, analysis }) =>
    analysis.conflicts.map((conflict: any) => ({
      ...conflict,
      file,
      db: analysis.db
    }))
  );

  showImportReviewModal(analyses, enhancedConflicts, 0);
});

document.getElementById('import-cancel-btn')!.addEventListener('click', closeImportConflictModal);
document.querySelector('.import-conflict-close')!.addEventListener('click', closeImportConflictModal);

// Import review modal (granular control)
async function showImportReviewModal(analyses: any[], conflicts: any[], index: number) {
  const modal = document.getElementById('import-review-modal')!;
  const progress = document.getElementById('import-review-progress')!;
  const existingPreview = document.getElementById('import-existing-preview')!;
  const importedPreview = document.getElementById('import-imported-preview')!;

  progress.textContent = `Conflict ${index + 1} of ${conflicts.length}`;

  const conflict = conflicts[index];

  // Render existing image preview
  await loadImageBlob(conflict.existingImage.id);
  const existingUrl = getOrCreateObjectURL(conflict.existingImage.id);
  const existingDate = new Date(conflict.existingImage.savedAt).toLocaleString();
  const existingTags = conflict.existingImage.tags?.join(', ') || 'None';
  existingPreview.innerHTML = `
    <img src="${existingUrl}" alt="Existing" style="max-width: 100%; margin-bottom: 10px;">
    <div><strong>Saved:</strong> ${existingDate}</div>
    <div><strong>Size:</strong> ${formatFileSize(conflict.existingImage.fileSize)}</div>
    <div><strong>Dimensions:</strong> ${conflict.existingImage.width} × ${conflict.existingImage.height}</div>
    <div><strong>Type:</strong> ${conflict.existingImage.mimeType}</div>
    <div><strong>Tags:</strong> ${existingTags}</div>
    <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.existingImage.imageUrl}</div>
  `;

  // Fetch and render imported image preview (use conflict.db from enhanced conflicts)
  const { getImageBlobFromDatabase, getImageMetadataFromDatabase } = await import('../storage/sqlite-import-export');
  const importedBlob = getImageBlobFromDatabase(conflict.db, conflict.id);
  const importedMetadata = getImageMetadataFromDatabase(conflict.db, conflict.id);

  const importedDate = new Date(conflict.importedMetadata.savedAt).toLocaleString();
  const importedTags = conflict.importedMetadata.tags?.join(', ') || 'None';

  if (importedBlob && importedMetadata) {
    const importedUrl = URL.createObjectURL(importedBlob);
    importedPreview.innerHTML = `
      <img src="${importedUrl}" alt="Imported" style="max-width: 100%; margin-bottom: 10px;">
      <div><strong>Saved:</strong> ${importedDate}</div>
      <div><strong>Size:</strong> ${formatFileSize(importedMetadata.fileSize)}</div>
      <div><strong>Dimensions:</strong> ${importedMetadata.width} × ${importedMetadata.height}</div>
      <div><strong>Type:</strong> ${importedMetadata.mimeType}</div>
      <div><strong>Tags:</strong> ${importedTags}</div>
      <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.importedMetadata.imageUrl}</div>
    `;
  } else {
    importedPreview.innerHTML = `
      <div style="padding: 10px; background: #f0f0f0; margin-bottom: 10px;">Preview not available</div>
      <div><strong>Saved:</strong> ${importedDate}</div>
      <div><strong>Tags:</strong> ${importedTags}</div>
      <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.importedMetadata.imageUrl}</div>
    `;
  }

  modal.classList.add('active');

  // Store for handlers
  (modal as any).__reviewData = { analyses, conflicts, index, decisions: new Map() };
}

async function closeImportReviewModal() {
  const modal = document.getElementById('import-review-modal')!;
  const reviewData = (modal as any).__reviewData;

  // Close all databases if they exist
  if (reviewData?.analyses) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    for (const { analysis } of reviewData.analyses) {
      if (analysis?.db) {
        closeImportDatabase(analysis.db);
      }
    }
  }

  modal.classList.remove('active');
}

document.getElementById('import-keep-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { analyses, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "keep existing"
  decisions.set(conflicts[index].id, 'keep');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(analyses, conflicts, index + 1);
  } else {
    finishGranularImport(analyses, conflicts, decisions);
  }
});

document.getElementById('import-override-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { analyses, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "override"
  decisions.set(conflicts[index].id, 'override');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(analyses, conflicts, index + 1);
  } else {
    finishGranularImport(analyses, conflicts, decisions);
  }
});

async function finishGranularImport(analyses: any[], conflicts: any[], decisions: Map<string, 'keep' | 'override'>) {
  const modal = document.getElementById('import-review-modal')!;
  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const existingIds = new Set(state.images.map(img => img.id));

    let totalNew = 0;
    let totalOverride = 0;

    // Import all files with decisions applied
    for (const { file, analysis } of analyses) {
      const allImportedImages = await importDatabase(file, 'override');
      closeImportDatabase(analysis.db);

      // Filter based on decisions
      const imagesToImport = allImportedImages.filter(img => {
        if (!existingIds.has(img.id)) {
          // New image, always import
          totalNew++;
          return true;
        }
        // Conflict: check decision
        const shouldOverride = decisions.get(img.id) === 'override';
        if (shouldOverride) {
          totalOverride++;
        }
        return shouldOverride;
      });

      await importImagesToIndexedDB(imagesToImport);
    }

    await reload();

    const keepCount = conflicts.length - totalOverride;

    alert(`Import complete!\n${totalNew} new images added.\n${totalOverride} images overridden.\n${keepCount} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
}

document.getElementById('import-review-cancel-btn')!.addEventListener('click', closeImportReviewModal);
document.querySelector('.import-review-close')!.addEventListener('click', closeImportReviewModal);
}
