# Native App + Bridge Extension — Requirements

> Status: **DRAFT v2, owner-reviewed once.** Remaining `[OPEN]` items are listed in §11.
> Audience: the agent that will turn this into an implementation plan. Not a spec — it says
> what and why, not how.

## 1. Goal

Move image storage and management out of the browser into a standalone desktop app
(macOS + Windows, Tauri v2). The user picks a folder; everything lives there as plain files
plus metadata. The app is the product. A browser extension is **one of several sources**
that feed it — right-click → capture → hand off; it also imports plain local image files.

Why: browser-extension storage is fragile (uninstall = data loss, updates can break, backup is
a manual export) and caps what features are possible. New features are built in the app only.

## 2. Hard guarantees

1. **The current extension keeps working unchanged.** Users of this repo's extension who do
   nothing keep saving to and managing images in the browser as today. This repo receives
   exactly one functional change (the export bundle, §8 Phase 0) and is then frozen/archived.
2. **Migrated data stays in the browser until the user removes it.** Nothing auto-deletes.
3. **Never lose a capture.** A capture the app did not acknowledge stays in the extension as
   `failed` with its blob and a Retry button. Clearing history never removes `failed` entries;
   they are discarded one at a time, explicitly.
4. **We never claim "safe to delete".** The app shows what it holds (counts, and per-source
   counts); the migration notice tells the user to verify in the app before dropping browser
   data. The decision and its wording are the user's.

## 3. Repositories

- **New monorepo** (name `[OPEN]`): `packages/app` (Tauri), `packages/extension` (bridge-only
  Chrome extension), `packages/shared` (transport contract types, site adapters' output types,
  anything both need). The app must be fully usable without the extension.
- **This repo** becomes the legacy extension: ships Phase 0, then a README notice pointing to
  the app, then archived. No further feature work. `[OPEN]` The unreleased refactor commits
  after `130b0c7` (v0.0.33) — module extraction + SolidJS/characterization work — are dropped
  or left as-is per the owner; either way nobody continues them.
- **Two extensions coexist during migration** (different IDs). Both add a right-click "Save
  image" menu; the new one must use a distinct label (e.g. "Save to Image Storage app") so the
  user can tell them apart, and the migration notice ends with "disable the old extension".

## 4. The bridge extension (new, in the monorepo)

Single mode; no library UI; no IndexedDB image store. It does three things:

1. **Capture.** Same technique as today: content-script canvas capture first, background
   fetch with a `Referer` rule as fallback. Port this code, do not rewrite it.
2. **Extract source context — the one thing only the browser can do.** Beyond image URL,
   page URL and title, **site adapters** for known sites pull extra context: X/Twitter (author
   handle, tweet URL, tweet text, original-size media URL), Pixiv (artist, work id, title,
   original URL), more as needed. Adapters produce a plain `{ site, fields }` record; the
   **app decides what to do with it** (tags, artist field, etc.). Rule of thumb: *extraction*
   lives in the extension, *policy* lives in the app. Auto-tag rules, tag sorting, rating
   extraction, Danbooru upload — all in the app. Rationale: CLAUDE.md "ONE TRUTH, ZERO
   COPIES"; two runtimes with the same rules drift.
3. **Deliver + show Download History.** POST to the app (§5). History entries: thumbnail
   (small, generated at capture), source URL, page title, timestamp, size, status
   `delivered` / `failed`. "Clear history" removes `delivered` only. Badge count = failed
   entries needing attention, not total saves.

## 5. Transport: localhost HTTP (decided)

**Why not Native Messaging** (recorded so it is not re-argued): the browser spawns a binary
registered per-browser (a JSON host manifest on macOS, a registry key on Windows) that lists
the extension's ID, and talks JSON over stdin/stdout. Upside: works with the app closed.
Downside: base64 for binaries, per-browser registration by an installer, extension ID must be
pinned. The owner accepts "the app must be running to save", which removes its only real
advantage, and HTTP lets **any local source** (CLI, scripts, another browser) post images with
zero registration.

**Contract** (details are the planner's; these are the requirements):
- App listens on `127.0.0.1:<fixed default port>` `[OPEN: port]`, port shown in app settings.
- `POST /captures` — multipart: the file + one JSON part (id, imageUrl, pageUrl, pageTitle,
  capturedAt, site adapter record). **Idempotent by `id`** (UUID from the extension); a retry
  of an already-stored id returns success without duplicating.
- `GET /status` — app version, library path, image count. Used by the extension for the
  "connected / not running" indicator and by the migration notice.
- **Origin check**: accept only requests whose `Origin` is `chrome-extension://…` (web pages
  cannot forge `Origin`, so a malicious site cannot inject into the library). A pairing token
  is not needed for personal use; leave room for one.
- Extension manifest: host permission for `http://127.0.0.1/*`.
- App not running → capture is stored `failed` (blob kept) + a notification "Open Image
  Storage to receive this image", and Retry succeeds without re-fetching. Auto-launching the
  app is a possible later nicety, not a requirement.

## 6. The app

- **Tauri v2**, macOS + Windows. Rust side owns filesystem, storage, the HTTP listener, and
  ingestion; the webview owns UI only.
- **UI: redesign, not port.** The existing viewer is a reference for features and behaviors
  (Danbooru-style tag search, sidebars, lightbox, bulk ops, keyboard nav — see CLAUDE.md in
  this repo), not for code or look. Use a component library to stop hand-rolling CSS.
  `[OPEN]` frontend framework + kit: the owner previously locked SolidJS (JSX fine, no React)
  for the extension; if that still holds, a Kobalte-based kit (e.g. Park UI or shadcn-solid)
  is the obvious pick. Pure logic worth lifting from this repo verbatim: `tag-utils`
  (search parser), `filters`, `grouping`, `navigation-math` — all framework-free and tested.
- **Sources:** bridge extension; **local file import** (drop files/folders; metadata =
  filename, mtime, dimensions); import of this repo's export bundle (§8). Per-source counts
  are visible so the user can verify a migration.
- **Library folder** (user-picked on first launch, remembered):
  ```
  <library>/
    images/<id>.<ext>          the files — usable in Finder/Explorer; backup = copy folder
    library.sqlite             metadata + tags + search index (see §7)
    inbox/                     staging for uploads in progress (temp-write, then rename)
  ```
  The app must tolerate files removed or renamed externally (show as missing, offer to drop
  the row), never crash on it.

## 7. Storage research (metadata)

Requirements: thousands to tens of thousands of images; binaries stay as files; tag-rich
queries (AND/OR/NOT tags, rating, type, tag-count, account, free-text on title/URL); fast
startup; zero admin; safe to copy as a folder; Rust bindings.

| Candidate | Verdict |
|---|---|
| **SQLite** (rusqlite / tauri-plugin-sql) with normalized `images` / `tags` / `image_tags` + **FTS5** for title/URL text | **Recommended.** Single file, embedded, ACID, mature Rust support, FTS built in. Every comparable local media manager uses it (Hydrus, digiKam, Lightroom catalogs). We chose it before for browser compatibility; it happens to also be the right desktop choice, for different reasons. |
| Per-image JSON sidecars as the canonical record, SQLite as a **rebuildable index** (Eagle-style) | Attractive add-on, not a replacement: makes the folder self-describing and lets a corrupted DB (e.g. cloud sync) be rebuilt by re-scanning. Costs a second write per edit. `[OPEN]` Adopt from day one, or keep as a documented later step. |
| Embedded KV stores (redb, sled, LMDB, RocksDB) | No query language; tag search would be reimplemented by hand. No. |
| DuckDB | Analytical, columnar; poor fit for per-row edits. No. |
| Embedded document/graph DBs (SurrealDB, PoloDB) | Immature or heavy for this; no advantage over SQLite+FTS5. No. |
| Plain JSON/YAML only | Fine to 1k images, then every search is a full scan and every edit rewrites a big file. No. |

Design notes for the planner: **tags as rows, not a comma string** (today's `tags TEXT`
column is the browser-era shortcut); keep image blobs out of the DB; rollback-journal mode
(not WAL) so cloud-sync clients see one file; document "one machine writes at a time".

## 8. Phases

| Phase | Where | Deliverable |
|---|---|---|
| 0 — Export bundle | this repo | "Export for app": today's multi-file SQLite export **plus** tag rules, notes and settings from `chrome.storage.local` (today's export omits them). Behavior-preserving otherwise. Ship as the final feature release of this extension. |
| 1 — App MVP | monorepo | Pick folder · HTTP listener + ingest · import the Phase-0 bundle (trash imports as trash) with a report (imported / skipped / failed + reasons) · local file import · browse, tag search, lightbox · per-source counts. |
| 1b — Bridge extension | monorepo | Capture (ported) · X + Pixiv adapters · deliver · Download History with Retry. |
| 2 — Parity | monorepo | Tags/ratings editing, bulk ops, auto-tag rules, trash, Danbooru upload, notes. |
| 3 — App-only features | monorepo | Whatever comes next. |

Phase 0 can start now and is independent of every other decision.

## 9. Migration flow (user-facing)

1. Install the app; pick a library folder.
2. Old extension → **Export for app** (Phase-0 bundle).
3. App → **Import**. Read the report.
4. App shows total images and the count imported from the extension. The old extension's
   viewer shows its own count. **Notice text (app side):** "Compare these numbers and spot-check
   a few images before removing anything from the browser. This app cannot verify the
   browser's data for you."
5. User installs the bridge extension and disables the old one. Old images remain in the
   browser until the user deletes them there (or uninstalls the old extension).

Users who never do this keep working as before, indefinitely.

## 10. Risks

- **Partial import mistaken for complete.** The report lists failures by item; counts are
  shown side by side; the notice says "verify". We do not say "safe".
- **Data outside IndexedDB left behind.** Rules, notes, settings live in
  `chrome.storage.local`, not in today's export. Phase 0 exists for this.
- **App not running when saving.** Explicit `failed` + blob kept + Retry. A save must never
  report success before the app's 2xx.
- **Duplicate delivery on retry.** Idempotent by UUID id, from day one.
- **Malicious page posting to localhost.** Origin check (§5). Bind 127.0.0.1 only.
- **Site adapters rot** (X and Pixiv change markup). Adapters are best-effort: on failure the
  capture still succeeds with the base metadata, never blocks the save.
- **Two "Save image" menus during migration.** Distinct labels; notice says disable the old.
- **Logic duplicated across runtimes.** Extraction in the extension, policy in the app (§4).
- **Cloud-synced library folder.** Files are fine; the DB needs one writer at a time and no
  WAL. The sidecar option (§7) makes this recoverable.
- **Gatekeeper / SmartScreen** on unsigned builds. Personal use: right-click → Open. Signing
  is a later decision.
- **Refactor commits in this repo attract continued work.** HANDOFF.md now says stop; the
  owner drops or leaves the commits (§3).

## 11. Decisions still open

1. **Does the dual-mode design from the first brief still stand?** The first brief asked the
   *existing* extension to gain a serving-mode toggle and a Download History section. A
   separate bridge-only extension makes that unnecessary, and this draft assumes it is
   dropped (this repo gets Phase 0 only). Confirm, or say the old extension must also grow
   history + mode.
2. Which unreleased commits to drop in this repo: everything after `130b0c7` (v0.0.33), or
   only the SolidJS/characterization steps from `2a8db63` onward (keeping the module split)?
3. Monorepo name; frontend framework + component kit (§6).
4. Sidecar JSON from day one, or SQLite-only first (§7)?
5. Default port.
