# Handoff: UI-Lib / Light-MVC Migration (next phase)

> Written at the end of the viewer-modularization phase, for whoever picks up the UI-lib
> migration next. Read this before touching `src/viewer/`.

## Where we are

The viewer was a **5260-line `src/viewer/index.ts` monolith**. It's now **2873 lines + 15
sibling modules** (`refactor/modularize-viewer`, merged to `main`). **173 tests** pass,
build + ESLint clean. Every extraction was verified in-browser.

This was a deliberately **behavior-preserving** refactor — no framework, no reactive store,
no visual changes. The goal was to create clean seams so a UI-lib migration can happen
incrementally.

## Progress (2026-06-21)

**Route A chosen. Step 1 (init refactor) DONE.** `src/viewer/index.ts` no longer touches the
DOM at import time: the whole bootstrap region is wrapped in `export function init()` with a
guarded auto-call (`if (document.getElementById('image-grid')) init()`), so tests can import the
module without the viewer HTML fixture and call `init()` themselves. The three self-wiring
siblings got the same treatment — `notes.ts` → `initNotes()`, `danbooru.ts` → `initDanbooru()`,
`tag-rules-ui.ts` → `initTagRules()` — all called at the top of `index.init()`. Proven by
`tests/_init-importable.test.ts` (imports `index.ts` under happy-dom). **174 tests, eslint 0
errors, build clean.** Caveat: the bootstrap body was left un-reindented inside `init()` (still
col-1) to keep the diff reviewable — purely cosmetic, fold it in during the view-split.

**Lib LOCKED: SolidJS** (owner: JSX fine, no React). Installed `solid-js` + `vite-plugin-solid`;
wired into `tsconfig.json` (`jsx: preserve`, `jsxImportSource: solid-js`), `vite.config.ts`
(`solid()` first plugin), `vitest.config.ts` (`solid()` plugin + `resolve.conditions:
['development','browser']`). Toolchain proven by `tests/_solid-smoke.test.tsx`. NOTE: did **not**
add `@solidjs/testing-library` — `solid-js/web`'s `render` works directly in happy-dom tests
(zero extra deps); add it only if test ergonomics demand.

**First component migrated: `ImageCard.tsx`** — now the single source of truth for image-card
markup. The legacy string pipeline still consumes cards as HTML, so `createImageCardHTML(image)`
is a temporary **bridge**: it renders `<ImageCard>` into a detached node and returns
`innerHTML` (re-exported from `render.ts`, so `index.ts` + tests are untouched). Fidelity gate =
the 16 existing `render.test.ts` tests, all green. Gotcha handled: checkbox `checked` must use
Solid `attr:checked` (property form does NOT serialize through `innerHTML`).

**Step 2 — characterization safety net DONE.** `tests/helpers/viewer-harness.ts` boots the real
`init()` against `index.html` with `chrome` + the data layer mocked, under happy-dom. KEY harness
rules (learned the hard way): it boots **once per file** and imports `index.ts` **before**
installing the DOM fixture (so the guarded auto-init doesn't fire and you call `init()` exactly
once) — otherwise document-level keydown listeners accumulate and a single keypress fires N×;
`resetState()` clears state + grid, restores selection-UI via the real deselect-all handler, and
restores the closed/hidden lightbox+preview baseline (never wipe the body — it orphans the
grid-delegated listeners). Locked: **selection** (11), **keyboard nav** (29 — grid clamps at edges
via `offsetIndexClamped`, lightbox is a bounded no-op via `offsetIndexBounded`; grouped nav follows
`getVisualOrder`; columns fall back to 4 under happy-dom), **lightbox** (13 — open via
`.image-preview` click or Space-with-one-selected; metadata/edit/close), **preview pane** (12 —
toggle, selection-driven content, blur auto-save asserted via the mocked service, quick-remove
pills). **242 tests, eslint 0 errors.** Documented-not-fixed: grid vertical clamp jumps columns at
the bottom edge; lightbox metadata + preview render are async (tests flush microtasks).

**Next step — the big one (only remaining piece of the migration):**
1. **Finish render.ts migration**: convert the pipeline (`renderImages`/group/chunked) + the two
   `index.ts` surgical-update sites (`insertNewImageCard`, `updateSingleImageCardInDOM`) to mount
   Solid nodes directly, dropping the string round-trip; then a reactive `<For>` grid driven by a
   signal. This is where the real win lands — it dissolves the manual "mutate state → call every
   `update*()`" orchestration in `index.ts`'s `applyFilters`.

## Goal of the next phase

Migrate the **view layer** to a UI lib for a **light MVC / clean architecture**, so the
view becomes importable, testable components. End state: **UI behavior under automated test
→ no manual UI testing** (the owner's explicit expectation for *after* this migration).

## Current architecture

```
storage/            MODEL — IndexedDB (db.ts) + high-level ops (service.ts) + sqlite I/O
src/viewer/
  state.ts          shared mutable `state` singleton (imported everywhere)
  blobs.ts          object-URL/blob lifecycle over state
  tag-utils.ts      \
  grouping.ts        }  PURE LOGIC (node-tested, no DOM)
  filters.ts         }  filterImages / computeRatingCounts / sortImages / parseSearchQuery
  format.ts          }  formatFileSize / extractArtistFromUrl / debounce
  navigation-math.ts /  pure grid/lightbox index math
  render.ts         VIEW (happy-dom-tested) — createImageCardHTML, render pipeline, observers
  toast.ts          \
  autocomplete.ts    }  leaf UI utils & feature blocks (side-effectful, imported by index.ts)
  danbooru.ts        }
  notes.ts           }
  tag-rules-ui.ts    }
  import-export-ui.ts/  initImportExport(reload) — DI, no cycle
  index.ts          CONTROLLER + remaining VIEW + bootstrap/event-wiring  ← migration target
```

## What is already clean — do NOT re-refactor

- **Model**: `storage/`, `state.ts`, `blobs.ts`.
- **Pure logic**: `grouping`, `filters`, `format`, `navigation-math`, `tag-utils`.
- **Feature blocks**: `danbooru`, `notes`, `tag-rules-ui`, `import-export-ui`.
- **View seam started**: `render.ts` (has happy-dom tests — the natural first migration target).

## What still lives in `index.ts` (the migration target)

- **Controller**: `applyFilters` / `applyFiltersWithoutRender` / `applyFiltersAndSave` (the hub),
  `update*` coordinators (count/badges/selection/rating-pills), event wiring, bootstrap.
- **View (not yet extracted)**: selection, keyboard nav, lightbox, preview pane + bulk tagging,
  tag/account/rating sidebars, context menus.
- **Data-coordination glue**: `loadImages`, `loadSingleImage`, `syncImageMetadataToState`,
  `updateSingleImageCardInDOM`, `insertNewImageCard` — these mix data + view-refresh (≈23 calls
  into view/controller). They are controller-layer, NOT model; separate controller↔view together.

## Decisions already made (don't relitigate)

- **`data.ts` was intentionally NOT extracted** — it's controller glue, and extracting it now
  would create import cycles with the entry module. Do it as part of controller/view separation.
- **View-layer split and visual polish were deferred** — the lib rewrites the view, so doing
  them in the plain refactor would be throwaway.
- **Recommended lib direction**: **Preact + `@preact/signals`** or **SolidJS**. The real pain
  isn't templating — it's the manual *"mutate `state`, then remember to call every `update*()`"*
  orchestration in `applyFilters`. That's a **reactivity** problem; signals solve it. `lit-html`
  is the minimal option if you want better templating but keep imperative control. (Tiny libs,
  no Vite upheaval.) Final choice is open — decide at kickoff.

## Recommended migration approach

Two routes were discussed with the owner (decide at kickoff):

- **Route A — net first (recommended):** do the `init()` refactor to make `index.ts` importable
  (move the **48 import-time `document.getElementById` lookups** into an init function), write
  happy-dom **characterization tests** for selection/nav/lightbox/preview as-is, THEN migrate
  with those tests as the safety net.
- **Route B — migrate with tests:** go straight to incremental migration (render first), writing
  component tests as each piece is rebuilt.

Either way: **incremental, module-by-module, `render.ts` first** (cleanest seam, already tested).
Each migrated piece ships with tests; manual testing shrinks to zero as coverage grows.

## Gotchas / conventions (learned the hard way)

- **`index.ts` can't be imported in tests** — it has 48 import-time DOM lookups + 2
  IntersectionObservers that run on import. The migration MUST move these into `init()`/lazy.
- **Build ≠ type-check.** `pnpm build` (Vite/esbuild) strips types without checking, and
  `pnpm test` runs in the `node` env (no DOM). So **dangling refs and DOM bugs pass build+test** —
  we shipped a latent dangling-`imageObserver` ref this way. **Always run ESLint** (`no-undef`
  catches these) and happy-dom tests before trusting an extraction.
- **ES-module circular imports are fine for *runtime* calls** (a module may call a sibling/
  controller inside a function body), but never at module-init time.
- **happy-dom per file**: add `// @vitest-environment happy-dom` as the first line; node tests
  stay default/fast. `@testing-library/dom` is installed.
- **Tooling quirks**: an `rtk` shell hook rewrites `eslint`/`grep`. Use
  `rtk proxy ./node_modules/.bin/eslint "src/**/*.ts"` for real linting; prefer `grep -F`
  (ripgrep chokes on unescaped parens). `pnpm lint`'s rtk wrapper points at a missing global
  eslint — use the `rtk proxy` form.
- **Commit style**: single-line, imperative, ≤50 chars, WHAT changed.

## Verification status (what's been hand-tested vs. not)

- ✅ Verified in-browser: grid render (all group modes), search/filter, rating pills, lightbox
  nav, surgical card updates (edit-in-preview + new-image-saved), import/export (skip/override/
  review), autocomplete, toast, tag-rules, notes.
- ⚠️ **Not fully tested**: **Danbooru upload** (modal opens/loads; an actual upload was not run)
  and the **preview panel** as a standalone (only the surgical-update-via-preview-edit path).
  Worth a pass during the migration.

## Commands

```
pnpm build                                          # Vite build to dist/ (no type-check!)
pnpm test                                           # vitest run (173 tests)
pnpm test:watch                                     # TDD
rtk proxy ./node_modules/.bin/eslint "src/**/*.ts"  # real lint (0 errors; ~73 pre-existing warnings)
```
