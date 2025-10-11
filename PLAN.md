# Chrome Image Storage Extension - Implementation Plan

## Architecture Decisions

### Technology Stack
- **Manifest Version**: V3 (current Chrome standard)
- **Language**: TypeScript
- **Build Tool**: Vite
- **Storage**: IndexedDB (for binary image data)
- **UI Framework**: Vanilla JS initially (keep it simple)
- **Export**: JSZip library

### Storage Strategy
- **IndexedDB** for storing images as Blobs with metadata
- Handles large amounts of binary data efficiently
- Asynchronous API for better performance

### User Interaction
- **Context Menu** on right-click (appears alongside native menu, doesn't replace it)
- Context menu only shows on images (`contexts: ["image"]`)
- Users retain full access to browser's default context menu

### Image Metadata Schema
```typescript
interface SavedImage {
  id: string;              // Unique identifier
  blob: Blob;              // Actual image data
  imageUrl: string;        // Original image URL
  pageUrl: string;         // Source page URL
  pageTitle?: string;      // Page title
  mimeType: string;        // e.g., "image/jpeg"
  fileSize: number;        // Bytes
  width: number;           // Image width
  height: number;          // Image height
  savedAt: number;         // Timestamp
  tags?: string[];         // Optional categorization
}
```

### Export Format
```
images-export.zip
├── metadata.json       # All image info in JSON
└── images/
    ├── 001.jpg
    ├── 002.png
    └── ...
```

## Implementation Phases

### Phase 1: Project Setup
1. Initialize TypeScript + Vite build setup for Chrome extension
2. Create Manifest V3 configuration with required permissions
3. Set up basic folder structure (background, content, viewer, storage)

### Phase 2: Core Storage Layer
4. Implement IndexedDB wrapper for storing images and metadata
5. Create storage service with add/get/delete/list operations
6. Define TypeScript interfaces for SavedImage schema

### Phase 3: Image Capture
7. Implement background service worker for context menu
8. Create content script to capture image on right-click (adds menu item alongside native menu)
9. Handle cross-origin images (fetch + convert to blob)
10. Extract metadata (dimensions, file size, MIME type, URLs)

### Phase 4: Viewer Page
11. Build viewer HTML page with image grid layout
12. Display saved images with metadata
13. Implement delete functionality
14. Add search/filter capabilities

### Phase 5: Export Feature
15. Implement ZIP export with JSZip library
16. Bundle images + metadata.json
17. Trigger browser download

## Development Philosophy

Following "make it work first" principle:
- Build the happy path for save → view → export
- No defensive validation until we see real failures
- Keep code readable and debuggable
- Add guards only for actual breaking cases discovered during testing
