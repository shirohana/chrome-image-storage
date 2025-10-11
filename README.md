# Chrome Extension Image Storage

A Chrome extension that allows you to save web images locally (not just URLs) and manage them with a built-in viewer. Export your saved images as a ZIP file with metadata.

## Features

- **Right-click to save**: Right-click any image and select "Save to Image Storage"
- **Local storage**: Images are saved as blobs in IndexedDB (not just URLs)
- **Metadata tracking**: Saves image URL, source page, dimensions, file size, and type
- **Image viewer**: Click the extension icon to view all saved images
- **View modes**: Grid, compact, and list views for browsing images
- **Search**: Filter images by URL or page title
- **Type filter**: Filter by image type (PNG, JPEG, WebP, GIF, SVG)
- **Sorting**: Sort by date, file size, dimensions, or URL
- **Grouping**: Organize images by source domain
- **Multi-select**: Select multiple images with checkboxes
- **Bulk operations**: Delete or export multiple selected images
- **Lightbox**: Click images to view full-size
- **Export**: Export all or selected images as a ZIP with metadata.json
- **Native context menu**: Extension adds menu item alongside browser's default menu

## Installation

### Development Mode

1. Clone this repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the extension:
   ```bash
   pnpm build
   ```
4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder from this project

### Development with Hot Reload

```bash
pnpm dev
```

This will watch for changes and rebuild automatically.

## Usage

### Saving Images

1. Right-click on any image on a webpage
2. Select "Save to Image Storage" from the context menu
3. A notification will confirm the image was saved

### Viewing Saved Images

1. Click the extension icon in your toolbar
2. This opens the image viewer in a new tab
3. View all your saved images with their metadata

### Managing Images

**View Modes**: Switch between grid, compact, and list views using the buttons in the toolbar.

**Search**: Use the search bar to filter images by image URL, source page URL, or page title.

**Filter by Type**: Use the type dropdown to filter by image format (PNG, JPEG, WebP, GIF, SVG).

**Sorting**: Sort images by newest/oldest, largest/smallest file size, dimensions, or URL using the sort dropdown.

**Grouping**: Group images by source domain to organize by website.

**Lightbox**: Click any image to view it in full size. Close with the × button or by clicking outside.

### Multi-Select and Bulk Operations

1. Click checkboxes on image cards to select multiple images
2. Use "Select All" or "Deselect All" for quick selection
3. Click "Delete Selected" to remove multiple images at once
4. Click "Export Selected" to export only selected images

### Deleting Images

- **Single delete**: Click the "Delete" button on any image card
- **Delete selected**: Select multiple images and click "Delete Selected"
- **Delete all**: Click "Delete All" to remove all images

### Exporting Images

1. Open the image viewer
2. Choose one of the export options:
   - **Export All**: Export all images
   - **Export Selected**: Export only selected images
3. Download a ZIP file containing:
   - Images in `images/` folder (named by image ID)
   - `metadata.json` with complete image information

## Architecture

### Tech Stack

- **TypeScript**: Type-safe development
- **Vite**: Fast build tool with HMR
- **Manifest V3**: Latest Chrome extension standard
- **IndexedDB**: Local storage for binary image data
- **JSZip**: ZIP file generation for export

### Project Structure

```
src/
├── background/       # Service worker (context menu, event handling)
├── content/          # Content script (injected into pages)
├── viewer/           # Image viewer page (HTML/CSS/TS)
├── storage/          # IndexedDB wrapper and storage service
├── types/            # TypeScript type definitions
├── icons/            # Extension icons
└── manifest.json     # Extension manifest
```

### Storage Schema

Images are stored in IndexedDB with this structure:

```typescript
interface SavedImage {
  id: string;              // UUID
  blob: Blob;              // Actual image data
  imageUrl: string;        // Original image URL
  pageUrl: string;         // Source page URL
  pageTitle?: string;      // Page title
  mimeType: string;        // e.g., "image/jpeg"
  fileSize: number;        // Bytes
  width: number;           // Pixels
  height: number;          // Pixels
  savedAt: number;         // Timestamp
  tags?: string[];         // Optional tags
}
```

## Development

### Scripts

- `pnpm dev` - Development mode with hot reload
- `pnpm build` - Production build
- `node scripts/generate-icons.js` - Regenerate icons from SVG

### Building

The build outputs to the `dist/` folder which can be loaded directly into Chrome as an unpacked extension.

## License

ISC
