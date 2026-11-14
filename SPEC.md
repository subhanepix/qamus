# Qamus — next phase spec

Personal Arabic–English dictionary (static site on GitHub Pages, installed as a PWA on iPad/iPhone). This phase adds **username login, synced search history, and vocab folders with a flashcard study mode**.

Single user in practice (the owner), but the design should not break if a second username is used.

---

## 0. Ground rules

- **Do not change search, normalization, or the data build** (`norm()`, `analyze()`, `suggestions()`, `build/*.py`, `data/`). Every lookup in §8 must still resolve exactly as it does now.
- Stay **framework-free**: vanilla JS, one `app.js` (split into modules only if it passes ~1,500 lines), `style.css`, no bundler. The site must still deploy by pushing the folder to GitHub Pages.
- **Offline-first.** Everything works with no network; sync catches up later. Never block the UI on a network call.
- Keep the existing look (tokens in `style.css`, light + dark, safe-area padding, 44px+ touch targets).
- Bump `VERSION` in `sw.js` on every deploy and add any new files to `SHELL`.
- Keep the in-page router (`QAMUS_MEMORY_ROUTER`) working; it's used for a claude.ai preview build.

---

## 1. Backend: Cloudflare Worker + KV

New folder `worker/` with `wrangler.toml`, `src/index.js`, and a README with the one-time setup (`npx wrangler login`, `wrangler kv namespace create QAMUS`, `wrangler deploy`).

### Storage
One KV key per user: `user:<username>` → JSON document:

```json
{
  "v": 1,
  "updatedAt": 1731600000000,
  "history":  [ { "q": "مسءلة", "t": 1731600000000 } ],
  "folders":  [ { "id": "f_x", "name": "دع الأيام", "parent": null, "createdAt": 0, "updatedAt": 0, "deleted": false } ],
  "cards":    [ { "id": "c_x", "folder": "f_x", "word": "...", "...": "see §4", "updatedAt": 0, "deleted": false } ],
  "reviews":  { "c_x": { "due": 0, "interval": 0, "ease": 2.5, "reps": 0, "lapses": 0, "last": 0, "updatedAt": 0 } },
  "settings": { "updatedAt": 0 }
}
```

### Endpoints
| Method | Path | Behavior |
|---|---|---|
| `GET` | `/u/:username` | Return the document, or `404` if the user doesn't exist. |
| `PUT` | `/u/:username` | Body is the client's full document. Server **merges** (§3) with what's stored, saves, returns the merged doc. Creates the user if missing. |
| `HEAD` | `/u/:username` | `200`/`404` — used by the login screen to say "new" vs "existing". |

### Constraints
- **Username:** 3–32 chars, `[a-z0-9_-]`, lowercased on both client and server.
- **CORS:** allow only the GitHub Pages origin (from an env var `ALLOWED_ORIGIN`) plus `http://localhost:*` for dev.
- **Limits:** reject bodies > 1 MB; max 5,000 cards, 500 folders, 500 history items (trim oldest history server-side).
- **Rate limit:** ~60 writes/minute per username (simple counter key with a 60s TTL is fine).
- Validate shape; reject anything that isn't the schema above.
- No passwords. The username is effectively a shared secret — the login screen should suggest something unguessable (e.g. pre-fill `name-xxxx`).

---

## 2. Login (username only)

- First launch shows a small sheet: **"Choose a username to sync across devices"** with a field, a **Continue** button, and **Use without syncing**.
- On Continue: `HEAD` the username → show "Welcome back" (existing) or "New account" before confirming, so a typo doesn't silently create an empty account.
- Store the username in `localStorage`. Header gets a small account button showing the username, sync status (synced / syncing / offline / error), **Sync now**, and **Sign out** (sign-out keeps local data only if the user chooses; default clears it after confirmation, built into the page, no `confirm()`).
- Signing in on a device that already has local unsynced data **merges** it into the account (§3), never discards it.
- Worker URL lives in one constant in `app.js` (`SYNC_URL`). If it's empty, the app runs in local-only mode with no login UI.

---

## 3. Sync model

- Local source of truth: **IndexedDB** (one store holding the same document shape). Fall back to in-memory if IndexedDB throws.
- Every change updates the local doc and marks it dirty. A debounced push (~2s) sends the whole doc with `PUT`; on success replace local with the merged response.
- Pull on app open, on `visibilitychange` → visible, and on **Sync now**.
- **Merge rule (same code on client and server, put it in a shared `merge.js` the Worker imports and the client loads):**
  - Folders, cards: union by `id`; for the same `id` keep the one with the larger `updatedAt`. Deletes are tombstones (`deleted: true`, keep 30 days then drop).
  - Reviews: per card, larger `updatedAt` wins.
  - History: union by `(q, t)`, sort newest first, cap 500.
- Offline: queue nothing extra — the dirty doc is the queue. Show "offline" in the status.

---

## 4. Search history

- Replace the current `localStorage` `hist` with the synced `history` list (migrate existing entries on first run).
- Record a search when a result view is shown (not on every keystroke). Deduplicate consecutive repeats; re-searching moves it to the top.
- **History view** (reachable from the home screen and the account menu): list of past searches with relative time, tap to re-run, swipe or ✕ to delete one, **Clear history** with inline confirm.
- Home screen keeps showing the most recent ~12 as chips.
- Optional: a toggle in settings to pause history recording.

---

## 5. Vocab cards and folders

### Card data
```js
{
  id, folder,               // folder id (required; default folder "Inbox")
  word,                     // as shown, vocalized if available
  key,                      // norm(word), for dedupe/lookup
  root,                     // e.g. "ك ت ب" or ""
  source,                   // "hw" | "wikt" | "lane" | "lexicon" | "custom"
  ref,                      // source id (HW entry id, Wiktionary index, etc.) so the card links back
  gloss,                    // English meaning (pre-filled, editable)
  arGloss,                  // optional Arabic explanation
  translit,                 // optional
  context,                  // optional sentence/verse the word came from
  highlight,                // optional phrase inside context to highlight
  note,                     // free text
  tags: [],
  createdAt, updatedAt, deleted
}
```

### Saving words
- Every Hans Wehr word row, verb-form row, Wiktionary card, lexicon card, and Lane entry gets a **save (bookmark) button**.
- Tapping it opens a compact sheet: folder picker (last-used folder pre-selected, **New folder** inline), editable gloss, optional context + note. **Save**.
- Long-press (or a second tap) on an already-saved word shows which folder(s) it's in and lets you remove it.
- Pre-fill: `gloss` from the definition's first sense (strip markup, ~120 chars), `root`, `translit`, `source`/`ref`.
- Also allow **Add card manually** inside a folder (for words from class notes that aren't in any dictionary).
- Duplicate guard: warn if the same `key` already exists in that folder.

### Folders
- Nested folders (one level of nesting is enough; `parent` supports more if cheap).
- **Vocab view**: folder list with card counts and "N due"; create, rename, move, delete (inline confirm; deleting a folder asks whether to delete its cards or move them to Inbox).
- Inside a folder: card list (word, gloss, due status), search/filter within folder, select multiple → move/delete, **Study** button, **Export** button.
- Tapping a card's word opens its dictionary entry (via `source`/`ref`, falling back to a normal search on `word`).

### Import / export
- Export a folder (or all) as **CSV** (`word,gloss,arGloss,root,translit,context,note,tags`) and **JSON**.
- Import CSV/JSON into a folder (file input; show a preview with row count before committing).
- Anki `.apkg` export is a stretch goal — skip unless it's cheap (genanki-equivalent in JS is not cheap; CSV import into Anki is fine for now).

---

## 6. Study mode

Model the UI on the existing flashcard page the owner already uses (the "دع الأيام Vocabulary" artifact). Match its behavior:

- One centered card that **flips** (3D rotate, disabled under `prefers-reduced-motion`). Tap / Space to flip, ← → or swipe to move.
- **Front:** the Arabic word large (Amiri or the app's Naskh face). If `context` has a `highlight` that differs from `word`, show "In the text" with that phrase underneath.
- **Back:** word, Arabic gloss (if any), English gloss, translit, note, then the context with the highlighted phrase marked, and the root as a tappable link into the dictionary.
- Counter (`3 / 24`), a status badge on the card, and a running tally (`N got it · N again`).
- Fixed bottom control row: **‹ · Again · Got it · ›**, safe-area aware. Marking advances after a short delay.
- **Filters** (chips): folder or sub-folder, Shuffle, Only "again", Hide "got it". Remember filter state per folder.
- **Clear all marks** with inline confirm.
- Additions beyond that page:
  - **Direction toggle:** Arabic → English (default) or English → Arabic.
  - **Two study modes:**
    1. **Browse** — exactly the page's behavior (marks are just labels).
    2. **Review (spaced repetition)** — show only cards due today. Again / Hard / Good / Easy, SM-2 style scheduling written to `reviews`. Show "N due" per folder and a done screen with tomorrow's count.
  - Study multiple folders at once (multi-select on the folder list → Study).
- Marks/reviews sync like everything else.

---

## 7. Navigation and UI

- Add a bottom tab bar (or header segmented control on wide screens): **Search · Vocab · History**. Keep the search field reachable from every tab.
- Routes (hash): `#q=`, `#e=`, `#f=`, `#w=` (existing), plus `#vocab`, `#folder=<id>`, `#study=<id[,id]>&mode=browse|review`, `#history`, `#account`. Mirror them in the memory router.
- Save sheet, login sheet, and confirmations are in-page sheets — never `alert`/`confirm`/`prompt`.
- Everything keyboard-usable on iPad with a hardware keyboard.

---

## 8. Testing

Add `tests/` with a Playwright script (Chromium headless) that serves the folder locally and checks:

**Regression — must resolve to these roots (unchanged behavior):**
| Query | Expected root |
|---|---|
| كتاب | ك ت ب |
| ءكل | ا ك ل |
| مسءلة | س ا ل |
| سءال | س ا ل |
| وسيكتبونها | ك ت ب |
| بالكتاب | ك ت ب |
| فقالوا | ق و ل |
| يستغفرون | غ ف ر |
| هءلاء | هؤلاء |
| علمتموهن | ع ل م |
| اخذتموه | ا خ ذ |
| مدرسة | د ر س |
| كتاتيب | Wiktionary card for كتاب |
| ك ت ب | root card + Lane section loads |

**New features:**
- Save a word → appears in the chosen folder; reload → still there (IndexedDB).
- Two browser contexts with the same username against `wrangler dev`: save on A, sync, appears on B. Edit the same card on both offline, sync both → newer `updatedAt` wins, nothing lost.
- Delete on A propagates to B (tombstone).
- History records searches, dedupes, clears.
- Study: flip, mark, filters, shuffle, review scheduling advances `due`.
- Offline: with network blocked, saving and studying still work; status shows offline; reconnect syncs.
- No console errors; no horizontal scroll at 400px; both themes readable.

Run the full suite before every commit.

---

## 9. Deliverables / order of work

1. `merge.js` + Worker + local `wrangler dev`, with unit tests for merge.
2. Local store (IndexedDB) + sync loop + login sheet + account menu.
3. History (migrate old `hist`).
4. Save button + save sheet + folders + vocab views + CSV/JSON import/export.
5. Study mode (browse, then review/SRS).
6. Tab bar/routing polish, `sw.js` update, README update (Worker setup + `SYNC_URL`).
7. Full test run; deploy Worker; set `SYNC_URL`; deploy Pages.

Commit after each step.
