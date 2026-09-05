# Native App + Bridge Extension — Requirements

> Status: **v3 — decisions closed** (§11 is the decision log). Ready to hand to the planner.
> Audience: the agent that will turn this into an implementation plan. Not a spec — it says
> what and why, not how.

## 1. Goal

Move image storage and management out of the browser into a standalone desktop app
(macOS + Windows, Tauri v2). The user picks a folder; everything lives there as plain files
plus metadata. The app is the product. A browser extension is **one of several sources**
that feed it — right-click → capture → hand off; it also imports plain local image files.

The app is also a **staging area in front of boorus**: images are saved here first, tagged and
rated, then posted to Danbooru or a self-hosted booru via its API (today's upload feature).
Booru integration is a first-class, two-way concept — not a side button — and will grow (§6).

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

- **New monorepo** — name from the §11 shortlist (booru-flavored; the owner's first pick
  `localbooru` is taken on GitHub, and `image-storage` is rejected because that name predates
  the tagging system): `packages/app` (Tauri), `packages/extension` (bridge-only
  Chrome extension), `packages/shared` (transport contract types, site adapters' output types,
  anything both need). The app must be fully usable without the extension.
- **This repo** becomes the legacy extension: ships Phase 0, then a README notice pointing to
  the app, then archived. No further feature work. **The unreleased refactor commits after
  v0.0.33 are kept, not dropped.** Reversal of an earlier call, with the argument: the owner
  first wanted them dropped because they were never released and the reactive-grid plan is
  abandoned. That was right for a repo that continues; it is wrong for a frozen one. Those
  commits are where `filters`, `grouping`, `navigation-math`, `format` and 14 of the 19 test
  files exist as standalone modules — at v0.0.33 the same logic is inlined in a 5260-line
  `index.ts` with 5 test files. §6 tells the planner to lift exactly those modules, so dropping
  the commits would delete the thing being lifted. Keeping costs nothing in a repo that gets
  no further UI work; the SolidJS pieces are inert. Phase 0 builds on top of `main` as it is
  and may ship as v0.0.34.
- **Two extensions coexist during migration** (different IDs). Both add a right-click menu
  entry, so the user sees two; the new one uses a distinct label (e.g. "Save to Image Storage
  app"), and the migration notice ends with "disable the old extension". Accepted as-is.

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
- App listens on `127.0.0.1:47201` by default (unassigned, outside common dev-server ranges),
  configurable and shown in app settings; the extension has a matching setting.
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
  **Frontend: Svelte 5 + shadcn-svelte (on Bits UI).** Constraint from the owner: anything
  suited to Tauri, **no React**. Svelte is the most common Tauri pairing (first-class
  `create-tauri-app` template), compiles to small output, and shadcn-svelte gives a complete,
  themeable kit with copy-in components. Alternatives if the planner hits a wall: SolidJS +
  a Kobalte-based kit (Park UI / shadcn-solid), or Vue 3 + PrimeVue. Pure logic worth lifting
  from this repo verbatim, framework-free and tested: `tag-utils` (search parser), `filters`,
  `grouping`, `navigation-math`.
- **Booru integration** (two-way, per configured site — official Danbooru and self-hosted):
  Phase 2 ports today's upload flow. Each image records *where it has been posted* (site +
  post id), shown as a label and usable as a search filter ("posted:danbooru",
  "unposted"). Later: pin/save booru posts back into the library with their tags, and
  reconcile tags between the local copy and the post. Model this from day one — a
  `posts` relation (image ↔ site ↔ remote id ↔ posted at), so the label and filter are cheap
  and the pull-back feature has somewhere to land.
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
| **SQLite** (rusqlite / tauri-plugin-sql) with normalized `images` / `tags` / `image_tags` + **FTS5** for title/URL text | **Locked for day one.** Single file, embedded, ACID, mature Rust support, FTS built in. Every comparable local media manager uses it (Hydrus, digiKam, Lightroom catalogs). We chose it before for browser compatibility; it happens to also be the right desktop choice, for different reasons. |
| Per-image JSON sidecars as the canonical record, SQLite as a **rebuildable index** (Eagle-style) | Attractive add-on, not a replacement: makes the folder self-describing and lets a corrupted DB (e.g. cloud sync) be rebuilt by re-scanning. Costs a second write per edit. **Deferred**: SQLite-only on day one; sidecars are a Phase-3 candidate. |
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
| 2 — Parity | monorepo | Tags/ratings editing, bulk ops, auto-tag rules, trash, notes, booru upload (official + self-hosted) recording the resulting post per image. |
| 3 — App-only features | monorepo | First candidates: "posted to <site>" label + `posted:`/`unposted` filters, pull booru posts back into the library, tag reconciliation with the remote post. |

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

## 11. Decision log (all closed 2026-09-06)

| Decision | Outcome |
|---|---|
| Old extension gains modes / history? | **No.** Bridge-only extension lives in the monorepo; this repo gets Phase 0 only. |
| Drop unreleased commits here | **No** — kept; the extracted modules and tests are the lift source for the app (§3). |
| Transport | Localhost HTTP, port 47201, Origin check (§5). |
| App stack | Tauri v2; Svelte 5 + shadcn-svelte; no React (§6). |
| Storage | SQLite + FTS5, files on disk, no sidecars yet (§7). |
| Browsers | Chrome only; others on request. |
| Monorepo name | Owner picks from the shortlist below (all verified name-free on GitHub 2026-09-06). |

**Repo name shortlist** — booru-flavored because the tag system descends from Danbooru and
the app is a staging area in front of booru sites (images land here, get tagged, ship out to a
booru, and may come back). Taken on GitHub: `localbooru` (owner's pick, 73★), `homebooru`,
`mybooru`, `deskbooru`, `pocketbooru`, `prebooru` (an existing Danbooru-adjacent project),
`boorusync`. No GitHub repo carries any of these names as of 2026-09-06:
- `boorudock` — a dock: images arrive, wait, ship out to boorus, and can dock back. Two-way and local at once. Recommended.
- `boorubay` — same harbor image, softer sound.
- `stagebooru` / `draftbooru` / `boorudraft` — say "before posting" clearly, but read one-directional; weaker once pull-back exists.
- `boorubridge` / `boorulink` / `booruport` — emphasize the connection to boorus; underplay "this is where my images live".
- `boorustash` / `boorunest` / `boorudesk` / `boorupad` — emphasize the local home; underplay the booru workflow.
- From the earlier list, still free and still fine: `sourcebooru`, `keepbooru`, `nestbooru`.
