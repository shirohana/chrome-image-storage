# Native App + Bridge Extension — Requirements

> Status: **DRAFT for owner review.** Decisions marked `[OPEN]` need the owner's call before
> implementation planning starts. Everything else is settled unless the owner objects.
> Audience: the agent that will turn this into an implementation plan. Not a spec — it says
> what and why, not how.

## 1. Goal

Move image storage and management out of the browser into a standalone desktop app
(macOS + Windows). The user picks a folder; everything lives there as plain files plus a
metadata database. The browser extension shrinks to a **bridge**: right-click → capture →
hand off to the app, and show the delivery history.

Why: browser-extension storage is fragile (uninstall = data loss, updates can break, backup
is a manual export), and it caps what features are possible. Once the app exists, new
features are built in the app; the extension only carries images across.

## 2. Hard guarantees (non-negotiable)

1. **No breaking change for the current flow.** A user who upgrades the extension and does
   nothing else keeps saving to and managing images in the browser exactly as today. Nothing
   in the new work is on the critical path of the existing save/view/edit code.
2. **Existing images stay visible in the browser** until the user has migrated them **and**
   actively switched the extension's serving mode. The library UI never hides while
   IndexedDB still holds images.
3. **Never lose a captured image.** If the app cannot be reached, the capture is kept in the
   extension until delivered. "Clearing history" must never be able to discard an
   undelivered capture.
4. **The user is never told "safe to delete" on a guess.** The migration-complete notice must
   be backed by a verified comparison (see §7), not by "the import ran without errors".

## 3. What the extension becomes

Two **serving modes**, stored in `chrome.storage.local`, default `browser`:

| Mode | Save goes to | Viewer shows |
|---|---|---|
| `browser` (default, today's behavior) | IndexedDB | Library (unchanged) + new Download History section |
| `app` | The app's library folder via the bridge | Download History; Library only while IndexedDB still has images |

Switching to `app` is a deliberate user action and only succeeds after a live handshake with
the app (so the user cannot strand themselves in a mode with no destination).

**Download History** (new, both modes) is a log of captures: source URL, page URL, title,
timestamp, size, and a status: `delivered` / `pending` / `failed`. It holds **no image data**
except the blob of a `pending` entry (the outbox). "Clear history" removes `delivered` and
`failed` entries only; pending entries are shown separately and require an explicit
"discard" per item. In `browser` mode, `delivered` simply means "written to IndexedDB".

**In `app` mode the extension is dumb on purpose.** It sends raw capture data (blob + source
metadata). Auto-tag rules, tag sorting, rating extraction, Danbooru upload — all business
logic — run in the app. Rationale: the project's own lesson (CLAUDE.md "ONE TRUTH, ZERO
COPIES"); logic duplicated across extension and app will drift. The browser-mode code path
keeps its current in-extension logic untouched (guarantee #1); it is legacy, not shared.

## 4. Bridge: how image data reaches the app

The **library folder format is the real contract**, not the transport. Whatever carries the
capture, the app ends up ingesting a file + its metadata. That keeps the transport swappable.

### Options considered

| | Native Messaging (`chrome.runtime.connectNative`) | Localhost HTTP server in the app |
|---|---|---|
| Works when the app GUI is closed | Yes — browser launches the host binary on demand | No — needs the app (or a background helper) running |
| Binary payload | JSON only → base64 (+33%), chunk large images | Native multipart; no size games |
| Setup | Installer must register a host manifest per browser (macOS: `~/Library/Application Support/<Browser>/NativeMessagingHosts/`, Windows: registry key), listing the extension ID | None; extension talks to `127.0.0.1:<port>` |
| Extension ID | Must be pinned via `key` in `manifest.json` (unpacked IDs are path-derived and differ per machine) | Irrelevant |
| Security | Browser enforces allowed origins | Any local page can POST to localhost → needs a pairing token |
| Multi-browser (Edge/Brave/Firefox) | One registration per browser, different formats | Free |
| Extension permission | `nativeMessaging` (new permission; harmless for unpacked installs) | Host permission on `http://127.0.0.1/*` |

### Recommendation `[OPEN — owner decides]`

**Native Messaging**, because "save works even when the app is not open" is what makes the
extension feel reliable, and it removes the localhost port/token/CORS class of problems. The
native host is a tiny CLI shipped with the app whose only job is: read message → write
`<library>/inbox/<id>.<ext>` + `<id>.json` → reply `ok`. The GUI app ingests the inbox on
launch and via a folder watcher. Host and GUI never write the same file, so there is no
concurrency story to get wrong.

If the owner prefers the smaller build cost, HTTP is acceptable **with** a pairing token
(app shows a code once, extension stores it, every request carries it) and the same inbox
format on the app side.

Either way the extension keeps an **outbox**: if delivery fails (host missing, app folder
unmounted, error), the capture stays `pending` and is retried on next save and on a timer.
Delivery is idempotent by image `id` (UUID); the app dedupes on retry.

## 5. The app

- **Platforms:** macOS + Windows. Linux is out of scope unless free.
- **Stack `[OPEN — owner decides]`:** recommend **Tauri v2** (small binary, native FS, Rust
  side owns SQLite + the native-messaging host can be the same binary in `--host` mode).
  Electron is the fallback if Rust friction is unacceptable. In both cases the UI is the
  **SolidJS viewer being built now** — the reactive-grid work in HANDOFF.md is directly
  reusable; the app is its second consumer. The pure modules (`filters`, `tag-utils`,
  `grouping`, `navigation-math`) are already framework-free and move into a shared package.
- **Repo layout `[OPEN]`:** recommend a monorepo (`packages/extension`, `packages/app`,
  `packages/shared`) so the shared viewer + logic have one home. Alternative: a separate repo
  with the shared code published privately — more ceremony, no benefit at this scale.
- **Library folder** (user-picked, remembered; app asks on first launch):
  ```
  <library>/
    library.sqlite      metadata (same columns as today's export schema, minus blob, plus path)
    images/<id>.<ext>   the files — browsable in Finder/Explorer, backup = copy the folder
    inbox/              bridge drop zone; emptied on ingest
    rules.json, notes.md (or tables in library.sqlite — planner's call)
  ```
  Files on disk rather than blobs in SQLite so the folder is useful without the app and so a
  huge library never becomes one multi-GB database file. The app must tolerate a file
  deleted or renamed externally (show as missing, offer to remove the row) rather than crash.
- **Cloud-synced folders** (iCloud/Dropbox/OneDrive): supported for the files, but SQLite
  under live sync corrupts if two machines write. Document "one writer at a time" and keep
  the DB in rollback-journal mode (not WAL) so sync clients see a single file.

## 6. Phases

| Phase | Deliverable | Ships to users? |
|---|---|---|
| 0 — Extension groundwork | Download History section + outbox model + serving-mode setting (UI shows only `browser`); bundle export = images SQLite **+ rules + notes + settings** (today's export omits these) | Yes, safe: no behavior change |
| 1 — App MVP | Pick folder · import the export bundle with a verification report · browse/search/lightbox (reused viewer) · receive captures via the bridge · migration-complete check (§7) | Yes — this is the migration release; extension gains the `app` mode toggle |
| 2 — Parity | Tags, ratings, bulk ops, auto-tag rules, Danbooru upload, trash — in the app | Yes |
| 3 — App-only features | Whatever comes next; extension is frozen except bug fixes | — |

Phase 0 ships **before** the app exists and must be a no-op for anyone who ignores it.

## 7. Migration flow (user-facing)

1. Install the app; pick a library folder.
2. In the extension: **Export for app** (the bundle from Phase 0). Existing multi-file SQLite
   export is the base; 200 images/file is already there to avoid browser memory errors.
3. In the app: **Import**. Trash items (`isDeleted`) import as trash. The app reports:
   imported / skipped (already present) / failed, with per-item reasons.
4. **Verification, then the notice.** With the bridge connected, the extension asks the app
   for the set of ids + sizes it holds and compares against IndexedDB. Only when every
   browser image is accounted for does the extension show: "All N images are in
   `<library>`. You can switch to app mode and delete the browser copies." Deletion of
   browser copies is a separate, explicit button, enabled only after that check passes.
   Without a bridge connection the extension shows counts for a manual comparison and never
   claims safety.
5. User switches serving mode to `app`. From now on right-click saves go to the folder;
   the viewer shows history. Library section disappears once IndexedDB is empty.

Users who never do this keep working as before, indefinitely.

## 8. Risks (grilled)

- **Partial migration mistaken for complete.** Mitigated by §7 step 4. Do not ship the notice
  without the comparison.
- **Data outside IndexedDB is silently left behind.** Tag rules, notes, `showNotifications`
  live in `chrome.storage.local` and are not in today's SQLite export. Phase 0's bundle fixes
  this; the import must consume all of it.
- **App unreachable in `app` mode.** Outbox + retry + visible `pending` state. A save must
  never fail silently or claim success before the host acknowledged the write.
- **Duplicate delivery on retry.** UUID id + app-side dedupe. Cheap; do it from day one.
- **Extension ID drift (native messaging only).** Pin `key` in the manifest before shipping
  the host manifest, or every machine needs a hand-edited allowlist.
- **Large images over JSON (native messaging only).** Base64 + chunking for >~20 MB; or fall
  back to writing the blob via the host's stdin in chunks. Planner must test a 50 MB PNG.
- **Business logic duplicated in two runtimes.** Avoided by making the bridge dumb (§3). The
  temptation will be to "just apply rules in the extension too" — don't.
- **Gatekeeper / SmartScreen.** Unsigned builds show scary warnings. Personal use: document
  right-click-Open. Signing (Apple $99/yr, Windows cert) is a later decision, not a blocker.
- **Viewer migration and app work colliding.** Both touch the Solid viewer. Finish the
  reactive-grid step (HANDOFF.md) first, or at least land the shared package boundary before
  the app starts consuming it — otherwise two agents edit the same files with different goals.
- **Folder edited by hand / disappears (external drive).** App treats missing files as a
  state, not a crash; the host writes to a temp name and renames, so the inbox never holds a
  half-written file.
- **Windows specifics.** Paths with reserved characters are avoided by id-based filenames;
  registry write for the host manifest needs the installer, not the app at runtime.

## 9. Non-goals (for now)

- Cloud sync, multi-device merge, sharing.
- Serving images from the app *back* into the browser viewer. In `app` mode the browser is
  history-only; management happens in the app.
- Firefox/Safari support. `[OPEN]` Edge/Brave are nearly free with HTTP, one extra
  registration each with native messaging — owner to say whether they matter.
- Preserving the extension as a full-featured second UI after migration. It is frozen.

## 10. Decisions needed from the owner `[OPEN]`

1. Transport: native messaging (recommended) or localhost HTTP?
2. App stack: Tauri v2 (recommended) or Electron?
3. Repo: monorepo with a shared package (recommended) or separate repo?
4. Browsers: Chrome only, or also Edge/Brave?
5. Sequencing: finish the reactive-grid viewer step before app Phase 1 starts (recommended),
   or run them in parallel behind a shared-package boundary?
6. Library metadata: SQLite + files on disk (recommended) or a different shape you already
   have in mind?
