# Qamus

Personal Arabic–English dictionary: a static site on GitHub Pages, installed as a PWA on iPad and iPhone, that works offline once loaded.

It does three things:
- Looks words up in Hans Wehr, a morphological lexicon, Wiktionary and Lane's Lexicon.
- Keeps a search history and vocab folders, which sync across devices through a small Cloudflare Worker.
- Lets you study saved words as flashcards, either browsing them or with spaced repetition.

## What's in it

### Dictionary
- **Hans Wehr** (24,799 entries, 7,390 roots, 5,453 verb forms), from GibreelAbdullah/HansWehrDictionary.
- **Buckwalter morphological lexicon** (~82k stems with English glosses, prefix/suffix tables). It strips و ف ب ل ك س ال and pronoun/plural/verb endings, then maps the stem to its Hans Wehr root. It also covers modern words missing from Hans Wehr.
- **Wiktionary** (15.4k entries, 232k inflected forms including broken plurals and conjugations), from English Wiktionary via Vuizur/Wiktionary-Dictionaries. CC BY-SA 3.0 / GFDL.
- **Lane's Lexicon** (47.8k entries under 5k roots), from GibreelAbdullah/LaneLexicon. It's split into one file per first letter and loaded only when you open a root's Lane section.
- **Matching:** search ignores harakat, tatweel and hamza spelling (ء أ إ آ ٱ ؤ ئ all match ا), and treats ة/ه and ى/ي as the same.
- **What you can type:** an Arabic word in any inflection, a root with spaces or dashes (`ك ت ب`), English, or transliteration (`kitab`).
- **Tap to look up:** tap any Arabic word inside a definition to look it up.

### Sync, history, vocab, study
- **Sync:** optional, with a username and no password. Every change is saved to IndexedDB first and synced in the background, so the app never waits on the network. If `SYNC_URL` is empty, the app runs local-only with no login UI.
- **History:**
  - recorded each time a result is shown; repeats are deduplicated, and searching again moves a word to the top;
  - the History tab lets you delete entries (swipe or ✕), clear everything, or pause recording;
  - the home screen shows the 12 most recent searches.
- **Vocab:**
  - a bookmark on every dictionary row saves the word into a folder, pre-filled with the meaning, root, transliteration and a link back to the entry;
  - folders can be nested, renamed, moved and deleted;
  - cards can be filtered, edited, moved and deleted in bulk, or added by hand;
  - CSV/JSON export, and import of CSV, Anki TSV or JSON.
- **Study:**
  - **Browse** is a flip card with Again / Got it marks, filter chips and Shuffle (after the "دع الأيام Vocabulary" page);
  - **Review** is SM-2 spaced repetition (Again / Hard / Good / Easy) over the cards due today;
  - you can study several folders at once.
- **Navigation:** Search · Vocab · History tabs, a bottom bar on phones and in the header on iPad. Hash routes: `#q=`, `#e=`, `#f=`, `#w=`, `#vocab`, `#folder=<id>`, `#study=<id,id>&mode=browse|review`, `#history`, `#account`.
- **Keyboard:**
  - `/` or ⌘K focuses search;
  - Esc leaves study or a folder;
  - in study: Space flips, ← → move, `1`/`2` mark (Browse), `1`–`4` grade (Review).

## Deploying

1. **Sync Worker (once).** See [worker/README.md](worker/README.md). In short:
   ```bash
   cd worker && npm install
   npx wrangler login
   npx wrangler kv namespace create QAMUS   # paste the id into wrangler.toml
   # set ALLOWED_ORIGIN in wrangler.toml to https://<you>.github.io
   npx wrangler deploy
   ```
2. **Point the app at it.** In `app.js`, the `SYNC_URL` constant holds the Worker URL, e.g. `https://qamus-sync.<account>.workers.dev`. Leave it empty for a local-only build.
3. **Bump `VERSION` in `sw.js`** on every deploy, and add any new file to `SHELL`. Open copies show "Qamus was updated · Reload" once the new version has installed.
4. **Push to GitHub Pages.** Push this folder to `main`, keeping `data/` and `.nojekyll`. Then go to Settings → Pages → *Deploy from a branch* → `main` / root.
5. **On the iPad:** open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once while online so the data is cached for offline use. Choose a username when asked, and use the same one on your other devices.

## Local development

Two dev servers are defined in `.claude/launch.json`:
```bash
node tests/serve.js 8000          # the site: http://127.0.0.1:8000
npm --prefix worker run dev       # the Worker with a simulated KV: http://localhost:8787
```
`SYNC_URL` points at the live Worker, which accepts requests from `localhost` too, so a local copy syncs your real data unless you override it. To use the local Worker instead, run this in the browser console, then reload:
```js
localStorage.setItem('qamus.syncUrl', 'http://localhost:8787')
```
The `localStorage` override takes priority over `SYNC_URL`. Set it to `''` to force local-only mode. The tests always set it (to the test Worker, or to `''`), and fail if anything contacts `workers.dev`.

## Tests

```bash
npm install
npx playwright install chromium   # once, about 150 MB
npm test                          # unit tests, then the Playwright suite (run before every commit)
```
- **`tests/*.test.js`** (Node's built-in runner): `merge.js` rules and validation, plus the Worker run against an in-memory KV.
- **`tests/e2e/*.spec.js`** (Chromium, headless). Playwright starts its own site and Worker servers on ports 8100 and 8788.

  | Spec | Covers |
  |---|---|
  | `regression` | the SPEC §8 lookup table (search must not change) |
  | `sync` | login, two-device sync, conflicts, tombstones, offline, sign-out |
  | `history` | recording, dedupe, delete/clear/pause, migration, sync |
  | `vocab` | bookmarks, save sheet, folders, folder view, import/export |
  | `study` | Browse, marks, filters, Review/SM-2, keyboard, swipe, offline |
  | `nav` | tabs, `#account`, the memory router, keyboard shortcuts, titles, the update notice |

## Project layout

| Path | What it is |
|---|---|
| `index.html` | the shell: header with the search field, tabs and account button; loads the scripts in order |
| `app.js` | search and lookup (`norm`, `analyze`, `suggestions`, result views), routing, history, tabs, sheets, login and account |
| `vocab.js` | cards and folders: bookmarks, save sheet, Vocab and folder views, CSV/JSON import and export |
| `study.js` | study mode: Browse and Review, plus SM-2 `schedule()` |
| `sync.js` | `QamusStore` (IndexedDB document, falling back to memory) and `QamusSync` (the push/pull loop) |
| `merge.js` | shared merge and validation, used by both the site and the Worker |
| `sw.js` | service worker: caches the shell and data first (cache-first), refreshed in the background |
| `style.css` | design tokens (light and dark) and all styles |
| `worker/` | the Cloudflare Worker (`wrangler.toml`, `src/index.js`) |
| `tests/` | unit tests, Playwright specs, `serve.js` (static server for dev and tests) |
| `build/`, `data/` | the dictionary data and the scripts that build it |

## Data and sync model

Each username has one JSON document: `history`, `folders`, `cards`, `reviews` and `settings`. Each device keeps a full copy in IndexedDB.

**Pushing and pulling:**
- A push sends the whole document about 2 s after a change.
- The Worker merges it with the stored copy and returns the result.
- The app pulls when it opens, when it comes back to the foreground, when the network returns, and on **Sync now**.

**Merge rules** (`merge.js`, identical on the client and the server):
- **Folders and cards:** union by `id`; the larger `updatedAt` wins, and on a tie the delete wins. Deletes are tombstones, kept for 30 days.
- **Reviews:** per card, the larger `updatedAt` wins. Browse marks live there as `mark` (1 = got it, 2 = again).
- **History:** each query keeps only its newest entry. Deleting an entry writes a tombstone. "Clear history" sets `settings.historyClearedAt`. At most 500 live entries.

**Limits:** 1 MB per document, 5,000 cards, 500 folders, 60 writes per minute per username.

**Caveats:**
- The username is the only secret.
- Cloudflare KV is eventually consistent. The client re-pushes whenever its merged copy differs from the server's, so a write that's briefly lost heals on the next sync.
- A device that stays offline for more than 30 days can bring back items deleted elsewhere.

## Rebuilding the data
```
python3 build/build.py <hanswehr.sqlite> <pyaramorph data dir> data/
python3 build/build_extra.py <wiktionary stardict dir> <lanelexicon.sqlite> data/
```
Run them in that order: `build_extra.py` adds to the index that `build.py` writes. After changing anything, bump `VERSION` in `sw.js` so the iPad picks up the update.
