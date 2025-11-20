# Chrome Extension Image Storage

A Chrome extension that allows you to save web images locally (not just URLs) and manage them with a built-in viewer. Export your saved images as a ZIP file with metadata.

## Features

### Core Features
- **Right-click to save**: Right-click any image and select "Save to Image Storage"
- **Local storage**: Images are saved as blobs in IndexedDB (not just URLs)
- **Metadata tracking**: Saves image URL, source page, dimensions, file size, and type
- **Image viewer**: Click the extension icon to view all saved images
- **Grid view**: Browse images in a responsive grid layout
- **Native context menu**: Extension adds menu item alongside browser's default menu

### Organization & Filtering
- **Search**: Filter images by image URL, page URL, or page title
- **Danbooru-style tag search**: Unified search syntax for powerful filtering
  - Tag search (AND): `girl cat` - Images with both tags
  - OR operator: `girl or cat` - Images with either tag
  - Exclude tags: `-dog` - Images without specific tags
  - Rating filter: `rating:s` or `rating:g,s` - Filter by ratings
  - Type filter: `is:png` or `is:jpg,webp` - Filter by image types
  - Tag count filter: `tagcount:2`, `tagcount:>5`, `tagcount:1..10` - Filter by tag count
  - Unrated filter: `is:unrated` - Show only unrated images
  - Combine filters: `girl cat -dog rating:s is:png tagcount:>2` - Mix any filters
- **Tag sidebar**: Dynamic sidebar showing tags from filtered results
  - Click tag name to include/remove from search
  - Click + to include, - to exclude tags
  - Selected tags highlighted and sorted to top
  - Always shows active filters even with 0 results
- **Sorting**: Sort by date, file size, dimensions, or URL
- **Grouping**: Organize images by source domain or show duplicates
- **Duplicate detection**: Groups images by dimensions + file size to find duplicates

### Tag Management
- **Individual tagging**: Add tags to images with autocomplete
- **Bulk tag operations**: Add or remove tags from multiple images at once
- **Auto-tagging rules**: Automatically apply tags to new images based on page title patterns
- **Clickable tags**: Click tags on image cards to toggle them in/out of search
- **Tag sidebar**: Interactive sidebar for quick tag filtering
  - Shows tags from currently filtered results
  - Click tag names to add/remove filters
  - Visual highlighting for included (green) and excluded (red) tags

### Rating Management
- **Individual rating**: Set content rating for images (General/Sensitive/Questionable/Explicit)
- **Bulk rating operations**: Set rating for multiple images at once
- **Rating tags**: Apply `rating:g`, `rating:s`, `rating:q`, or `rating:e` tags to automatically set rating
- **Quick rating filter**: Click rating pills above tag sidebar for fast multi-select filtering
- **Color-coded badges**: Visual indicators on image cards (Green/Yellow/Orange/Red)
- **Danbooru integration**: Ratings automatically pre-fill when uploading to Danbooru

### Selection & Bulk Operations
- **Multi-select**: Select multiple images with checkboxes
- **Select all**: Quickly select or deselect all visible images
- **Keyboard navigation**: Arrow keys to navigate, Shift+Arrow for range selection
- **Bulk delete**: Delete selected images
- **Bulk export**: Export selected images as a ZIP
- **Bulk tagging**: Add or remove tags from selected images
- **Bulk rating**: Set content rating for selected images

### Trash & Restore
- **Soft delete**: Deleted images move to trash instead of permanent deletion
- **Trash view**: View and manage deleted images separately
- **Restore**: Recover images from trash
- **Permanent delete**: Delete images forever from trash
- **Empty trash**: Clear all trashed images at once

### Viewing & Preview
- **Lightbox**: Click images to view full-size with keyboard navigation
- **Preview pane**: Collapsible side panel showing selected image details and metadata
- **View page button**: Open the original source page in a new tab

### Metadata Management
- **Local file upload**: Import images from your computer via "Upload" button in header
- **Edit metadata**: Update page title and page URL for individual images
  - **Preview sidebar**: Always editable inputs with auto-save on blur (quick editing)
  - **Lightbox**: Read-only by default, click "Edit Metadata" to enable editing
- **Auto-tagging on import**: Local uploads automatically apply auto-tagging rules based on filename

### Import & Export
- **Upload from computer**: Import images from local files via header button
- **ZIP export**: Export all or selected images as a ZIP with metadata.json
- **SQLite export**: Export database as SQLite format for backups with folder picker
- **Progress indicator**: Visual progress modal shows export status in real-time
- **Multi-file export**: Automatically splits large datasets into multiple files (200 images per file)
- **Memory efficient**: Batched processing prevents memory allocation errors with thousands of images
- **SQLite import**: Import from SQLite backups with multi-file selection support
- **Conflict resolution**: Choose to skip, override, or review conflicts individually

### Danbooru Integration
- **Upload to Danbooru**: Upload images to self-hosted Danbooru instances
- **Auto-fill metadata**: Automatically extracts tags, artist, and source from images
- **Artist detection**: Recognizes artists from Pixiv, Twitter, Fanbox, DeviantArt, ArtStation URLs
- **Settings**: Configure Danbooru instance URL, username, and API key

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

**URL/Page Search**: Use the top search bar to filter images by image URL, source page URL, or page title.

**Tag Search**: Use the bottom search bar with Danbooru-style syntax for powerful filtering. Features autocomplete suggestions as you type (first match auto-selected, press Enter to accept).

**Basic Tag Search**:
- `girl cat` - Images with BOTH tags (AND logic)
- `girl or cat` - Images with EITHER tag (OR logic)
- `-dog` - Exclude images with "dog" tag
- `girl cat -dog` - Combine: has girl AND cat, but NOT dog

**Rating Filter**:
- `rating:g` - General only
- `rating:s` - Sensitive only
- `rating:g,s` - General OR Sensitive (comma-separated)
- `is:unrated` - Show only unrated images

**Type Filter**:
- `is:png` - PNG images only
- `is:jpg` or `is:jpeg` - JPEG images
- `is:webp`, `is:gif`, `is:svg` - Other formats
- `is:png,jpg` - PNG OR JPEG (comma-separated)

**Tag Count Filter**:
- `tagcount:2` - Exactly 2 tags
- `tagcount:1,3,5` - 1, 3, or 5 tags (list)
- `tagcount:>5` - More than 5 tags
- `tagcount:<3` - Less than 3 tags
- `tagcount:>=2` - 2 or more tags
- `tagcount:<=10` - 10 or fewer tags
- `tagcount:1..10` - Between 1-10 tags (range)

**Combine Everything**:
- `girl cat -dog rating:s is:png tagcount:>2` - Mix any filters
- `pixiv tagcount:2,4` - Pixiv images with 2 or 4 tags

**Tag Sidebar**:
- Left sidebar shows tags from currently filtered results
- **Click tag name** to include (or remove if already selected)
- **Click +** to include tag in search
- **Click -** to exclude tag from search
- Selected tags highlighted: green (included), red (excluded)
- Selected tags always visible at top, even with 0 results

**Sorting**: Sort images by newest/oldest, largest/smallest file size, dimensions, or URL using the sort dropdown.

**Grouping**:
- Group images by source domain to organize by website
- Use "Duplicates" mode to find images with matching dimensions and file size

**Lightbox**: Click any image to view it in full size. Use arrow keys to navigate between images. Close with Space, Escape, × button, or by clicking outside.

**Preview Pane**: Toggle the preview pane to see details about selected images. Shows full preview + metadata for single selection, or a thumbnail grid for multiple selections.

### Tagging Images

**Add tags to single image**:
1. Select an image and open the preview pane or lightbox
2. Enter tags in the tag input field (space-separated)
3. Use autocomplete suggestions (first match auto-selected when typing, press Enter to accept)
4. Tags auto-save when you press Enter or blur the input (click away)

**Bulk tag operations**:
1. Select multiple images using checkboxes
2. Click "Tag Selected" button
3. In the modal:
   - **Add Tags**: Enter tags to add to all selected images
   - **Remove Tags**: Enter tags to remove from all selected images
   - **Set Rating**: Choose a rating to apply to all selected images (or "No Change")
4. Click "Save" to apply changes

**Filter by tags**:
- **Click tags on image cards** to toggle them in the tag search (click again to remove)
- **Use tag sidebar** for quick filtering:
  - Click any tag name to include it in search
  - Click + button to include tag
  - Click - button to exclude tag
  - Click selected tag name again to remove from search
- **Use tag search syntax** for complex queries:
  - `girl cat` - AND logic (both tags required)
  - `girl or cat` - OR logic (either tag)
  - `-dog` - Exclude specific tags
  - Combine: `girl cat or boy -dog`
- Active filtered tags are highlighted in green on image cards
- Selected tags in sidebar are highlighted (green = included, red = excluded)

**Auto-tagging rules**:
1. Open Settings (⚙ button in header)
2. Scroll to "Auto-Tagging Rules" section
3. Create a rule:
   - **Rule Name**: Descriptive name (e.g., "Pixiv Images")
   - **Pattern**: Text or regex to match page title (leave empty to match all images)
   - **Use Regex**: Check to enable regex pattern matching
   - **Tags**: Space-separated tags to apply (e.g., "pixiv illustration")
4. Click "Add Rule" to save
5. Manage existing rules:
   - **Toggle**: Enable/disable rules without deleting
   - **Edit**: Click ✎ to modify a rule
   - **Delete**: Click × to remove a rule

When you save a new image, all enabled rules that match the page title will automatically apply their tags to the image.

### Rating Images

Images can have content ratings to help organize and filter them:

**Set rating for single image**:
1. Select an image and open the preview pane
2. Choose a rating using the radio buttons:
   - **General (G)**: Safe for work content
   - **Sensitive (S)**: Slightly suggestive content
   - **Questionable (Q)**: Questionable/suggestive content
   - **Explicit (E)**: Explicit/adult content
   - **Unrated**: No rating applied
3. Rating updates immediately

**Set rating for multiple images**:
1. Select multiple images using checkboxes
2. Click "Tag Selected" button
3. In the "Set Rating" section, choose a rating (or "No Change" to keep existing)
4. Click "Save" to apply

**Using rating tags**:
- Add `rating:g` tag to set General rating
- Add `rating:s` tag to set Sensitive rating
- Add `rating:q` tag to set Questionable rating
- Add `rating:e` tag to set Explicit rating
- Rating tags are automatically converted to the rating field and removed from tags

**Filter by rating**:
- Use the rating filter pills above the tag sidebar (G/S/Q/E/Unrated)
- Click rating pills to toggle filters on/off (multi-select supported)
- Active pills show with colored backgrounds
- Alternatively, use tag search syntax: `rating:g,s` or `rating:g or s`
- Shows images matching any of the selected ratings

**Visual indicators**:
- Each image card displays a color-coded badge:
  - Green badge (G) = General
  - Yellow badge (S) = Sensitive
  - Orange badge (Q) = Questionable
  - Red badge (E) = Explicit
  - Gray badge (—) = Unrated

### Multi-Select and Bulk Operations

1. Click checkboxes on image cards to select multiple images
2. Use "Select All" or "Deselect All" for quick selection
3. Use keyboard shortcuts:
   - **Arrow keys**: Navigate and select items
   - **Shift + Arrow keys**: Extend selection range
   - **Cmd/Ctrl + Click**: Toggle individual item selection
   - **Shift + Click**: Select range from last selected item
4. Bulk actions available:
   - **Tag Selected**: Add/remove tags or set rating for selected images
   - **Delete Selected**: Move selected images to trash
   - **Dump Selected**: Export selected images as a ZIP file

### Trash & Restore

Images are soft-deleted (moved to trash) instead of permanent deletion:

1. **Delete images**: Click "Delete" button - images move to trash
2. **View trash**: Click the "Trash" tab to see deleted images
3. **Restore images**: Click "Restore" button on trashed images
4. **Permanent delete**: In trash view, click "Delete Forever" to permanently remove
5. **Empty trash**: Click "Empty Trash" to permanently delete all trashed images

### Keyboard Navigation

**Grid navigation**:
- **Arrow keys**: Navigate grid (respects columns for up/down)
- **Shift + Arrow keys**: Extend selection range
- **Space**: Open/close lightbox for selected item
- **Escape**: Close lightbox

**Lightbox navigation**:
- **Left/Right arrows**: Previous/next image
- **Up/Down arrows**: Navigate by grid columns
- **Space or Escape**: Close lightbox

### Uploading Local Files

**Import images from your computer**:
1. Click "Upload" button in the header (between image count and "Select All")
2. Select one or multiple image files from your computer
3. Images are imported with metadata:
   - **Page Title**: Extracted from filename (without extension)
   - **Page URL**: Set to local file path (`file:///filename`)
   - **Tags**: Auto-tagging rules applied based on filename
4. Edit metadata afterwards using preview sidebar or lightbox

### Editing Metadata

**Preview sidebar (quick editing)**:
1. Select an image to open preview sidebar
2. Metadata inputs are always editable
3. Edit Page Title, Page URL, or Tags directly
4. Tag input features autocomplete from existing tags
5. Changes auto-save when you blur the input (click away or tab out)
6. No save button needed - completely silent updates

**Lightbox (viewing mode)**:
1. Open image in lightbox (click image or press Space)
2. Metadata shown as read-only text by default
3. Click "Edit Metadata" button to enable editing
4. Make changes to Page Title or Page URL
5. Click "Save Metadata" to apply and return to read-only view

### Exporting & Importing

**Export options**:
1. Open the image viewer
2. Choose export format:
   - **Dump Selected**: Export selected images as ZIP with metadata.json (or use Select All first)
   - **Export Database**: SQLite database backup for all images (Settings panel)

**Export Database (SQLite backup)**:
1. Click "Export Database" in Settings
2. Browser shows folder picker - choose where to save backup
3. Progress modal shows export status with visual progress bar
4. Extension creates organized backup folder with timestamp:
   ```
   image-storage-backup-2025-11-15-1731567890123/
   ├── manifest.json
   ├── database.db (if <200 images)
   └── database-part1of11.db, part2of11.db, ... (if >200 images)
   ```
5. **Large datasets**: Automatically splits into multiple files (200 images per file) to avoid memory issues
6. **Memory efficient**: Uses batched processing to handle thousands of large images

**Import from backup**:
1. Click "Import" button
2. **Multi-file support**: Select one or multiple SQLite database files (Ctrl/Cmd + Click or Shift + Click)
3. If importing multiple files from a backup, select all parts at once
4. Choose conflict resolution strategy:
   - **Skip conflicts**: Keep existing images, import only new ones
   - **Override conflicts**: Replace existing images with imported versions
   - **Review conflicts**: Review each conflict individually with side-by-side comparison
5. Click "Import" to complete - all selected files are imported sequentially

### Danbooru Integration

**Setup** (one-time):
1. Click "Settings" in the toolbar
2. Enter your self-hosted Danbooru instance details:
   - Danbooru URL (e.g., `https://your-danbooru.com`)
   - Username
   - API key
3. Save settings

**Upload images**:
1. Select a single image (preview pane must show the image)
2. Click "Upload to Danbooru" button
3. Review auto-filled metadata:
   - Tags (from image tags)
   - Artist (auto-detected from source URL)
   - Source (from page URL)
   - Rating (pre-filled from image rating, or defaults to Questionable)
   - Copyright, Character, Description (optional)
4. Click "Upload to Danbooru"
5. Wait for upload to complete (status shows in modal)

**Supported artist detection**:
- Pixiv (pixiv.net/users/*, pixiv.net/artworks/*)
- Twitter/X (twitter.com/*, x.com/*)
- Fanbox (*.fanbox.cc)
- DeviantArt (deviantart.com/*)
- ArtStation (artstation.com/*)

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
  isDeleted?: boolean;     // Soft delete flag for trash
  rating?: 'g' | 's' | 'q' | 'e';  // Content rating (General/Sensitive/Questionable/Explicit)
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
