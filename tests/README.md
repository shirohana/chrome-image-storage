# Test Suite

Comprehensive test coverage for Chrome Image Storage extension's core logic functions.

## Quick Start

```bash
# Run all tests
pnpm test

# Watch mode (auto-rerun on file changes)
pnpm test:watch

# Visual UI for test debugging
pnpm test:ui

# Coverage report
pnpm test:coverage
```

## Test Files

### `tag-parser.test.ts` (50 tests)
Tests the Danbooru-style tag search parser (`parseTagSearch`).

**Coverage:**
- Empty/whitespace handling
- Basic tag inclusion (AND logic)
- Tag exclusion (`-tag`)
- OR logic (`tag1 or tag2`)
- Rating filters (`rating:g,s,q,e`)
- File type filters (`is:png`, `is:jpg`, `is:unrated`)
- Tag count filters (`tagcount:2`, `tagcount:>5`, `tagcount:1..10`, `tagcount:1,3,5`)
- Complex combinations of all filter types
- Edge cases (invalid syntax, case sensitivity, special characters)

**Why critical:**
- 15+ parsing rules with complex interactions
- User-facing search functionality
- Hard to manually verify all combinations

### `tag-query.test.ts` (11 tests)
Tests tag removal utility function (`removeTagFromQuery`).

**Coverage:**
- Tag removal with following "or" operator
- Tag removal with preceding "or" operator
- Tag removal without affecting other tags
- Tag at beginning/middle/end positions
- Only tag removal (results in empty string)
- Preserving "or" between remaining tags
- Case-insensitive "or" operator handling
- Multiple spaces handling
- Tag appearing multiple times
- Tag not present scenarios

**Why critical:**
- Used by tag sidebar and clickable tags for search manipulation
- Complex "or" operator cleanup logic prevents orphaned operators
- Extracted from duplicated code to prevent bugs (production bug history)
- Tag removal bugs directly affect UX - users can't properly filter images

### `auto-tagging.test.ts` (26 tests)
Tests auto-tagging rule matching logic (`matchesRule`, `getAutoTags`).

**Coverage:**
- Enabled/disabled rule handling
- Empty pattern (match-all rules)
- Plain text matching (case-insensitive substring)
- Regex pattern matching
- Invalid regex handling
- Multiple rules merging and deduplication
- Mixed regex/plain text rules
- Edge cases (empty tags, special characters)

**Why critical:**
- User-configured regex patterns can be error-prone
- Multiple rules need proper merging/deduplication
- Silent failures are hard to debug

### `rating-extraction.test.ts` (25 tests)
Tests rating tag extraction logic (`extractRatingFromTags`).

**Coverage:**
- Basic rating extraction (g/s/q/e)
- Case-insensitive matching
- Multiple rating tags (first wins, all removed)
- No rating tag scenarios
- Edge cases (invalid values, partial matches, tag ordering)
- Integration with other tag types
- Real-world Danbooru-style tag lists

**Why important:**
- Affects data integrity (rating field vs tags array)
- Called in multiple places (save, update, bulk operations)
- Tag cleanup must be consistent

### `grouping.test.ts` (9 tests)
Tests image grouping (`src/viewer/grouping.ts`): `getXAccountFromUrl`,
`groupImagesByXAccount`, `groupImagesByDuplicates`, and `getVisualOrder` ordering for
each grouping mode (none / x-account / duplicates).

### `filters.test.ts` (11 tests)
Tests the filter/sort core (`src/viewer/filters.ts`): `parseSearchQuery`, `filterImages`
(view + URL + tag search incl. rating), `computeRatingCounts` (same filters but rating
skipped, so pills show all-rating counts), and `sortImages` for each sort key.

### `format.test.ts` (11 tests)
Tests `src/viewer/format.ts`: `formatFileSize`, `extractArtistFromUrl` (incl. a documented
pre-existing greedy-capture quirk for fanbox URLs), and `debounce`.

### `navigation-math.test.ts` (11 tests)
Tests pure grid/lightbox index math (`src/viewer/navigation-math.ts`). Locks in the
deliberate edge-behavior difference that used to diverge: grid CLAMPS at the boundary,
lightbox returns "no movement".

### `toast.test.ts` (4 tests, happy-dom)
Tests `showToast` (`src/viewer/toast.ts`): message/styling, lazy one-time style injection,
auto-dismiss timeout.

### `render.test.ts` (16 tests, happy-dom)
Tests `createImageCardHTML` (`src/viewer/render.ts`): selection/checkbox state, rating
badges (g/s/q/e + unrated), tag sorting + active-search highlighting, X-account button +
active state, and trash-vs-normal action buttons.

## DOM tests (happy-dom)

Pure-logic tests run in the `node` env (default). DOM-dependent tests opt into happy-dom
per-file with a `// @vitest-environment happy-dom` docblock at the top, so the fast node
tests are unaffected. `@testing-library/dom` is available for queries.

## Test Performance

All 173 tests run in ~0.3s total. Fast execution enables TDD workflow and pre-commit hooks.

## Architecture Decision: Function Extraction

**Why not jsdom?**
- Heavy dependency (~10MB)
- Slow tests (~100-200ms DOM initialization per file)
- Imports entire UI code (1200+ lines) just to test one function

**Why extract to separate files?**
- ✅ Fast tests (Node environment, no DOM overhead)
- ✅ No extra dependencies
- ✅ Clean imports (test only loads what it needs)
- ✅ Pure functions separated from UI code

**Extracted files:**
- `src/viewer/tag-utils.ts`: Tag search parser, tag query manipulation, and types
  - `parseTagSearch()`: Danbooru-style search parser
  - `removeTagFromQuery()`: Tag removal with "or" operator cleanup
- `src/viewer/grouping.ts`: account/duplicate grouping + visual-order helpers
- `src/viewer/filters.ts`: view/URL/tag filtering, rating counts, sorting, `parseSearchQuery`
- `src/viewer/format.ts`: file size, artist-from-URL, debounce
- `src/viewer/navigation-math.ts`: grid/lightbox index math (one truth)

When `index.ts` logic only reads the DOM for an input value or card order, parameterize
that out into one of these modules and leave a thin DOM-reading wrapper in `index.ts`.

**Exported for testing:**
- `extractRatingFromTags` in `src/storage/service.ts`
- `matchesRule` in `src/storage/tag-rules.ts`

## What's NOT tested (yet)

Skip for now, add if needed:
- Storage operations (IndexedDB/SQLite) - require complex mocking
- UI interactions - simple event delegation, low risk
- Chrome extension APIs - hard to test, rarely break
- Lazy loading/memory management - integration concerns

Can add later:
- Integration tests for full save/load flows
- E2E tests for critical user journeys

## Coverage Configuration

Located in `vitest.config.ts`:
- Provider: v8 (fast, accurate)
- Reporters: text (console) + html (browsable report)
- Includes: `src/**/*.ts`
- Excludes: Type definitions, UI glue code, extension APIs

## Philosophy

Following project's "MAKE IT WORK FIRST" principle:
1. Test complex logic with many implicit rules
2. Focus on pure functions (high value, low effort)
3. Fast feedback loop for TDD
4. Prevent regressions during refactoring

Tests make the codebase predictable and safe to modify.
