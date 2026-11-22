# Qamus

Arabic–English dictionary at **https://alqamus.pages.dev**: a static site on Cloudflare Pages, installed as a PWA on iPad and iPhone, that works offline once loaded. (It used to live at `subhanepix.github.io/qamus`; that copy now points people to the new address.)

It does three things:
- Looks words up in Hans Wehr, a morphological lexicon, Wiktionary and Lane's Lexicon, plus two Arabic–Arabic dictionaries: al-Rāghib's al-Mufradāt and al-Rāzī's Mukhtār al-Ṣiḥāḥ.
- Keeps a search history and vocab folders, which sync across devices through a small Cloudflare Worker.
- Lets you study saved words as flashcards, either browsing them or with spaced repetition.

## What's in it

### Dictionary
- **Hans Wehr** (24,799 entries, 7,390 roots, 5,453 verb forms), from GibreelAbdullah/HansWehrDictionary. The app downloads its headwords up front (`data/hw/index.json`) and the definitions in chunks of 200 roots (`data/hw/cNNN.json`) as results need them; the rest are fetched quietly afterwards so the offline copy fills up (skipped when the device asks to save data).
- **Buckwalter morphological lexicon** (~82k stems with English glosses, prefix/suffix tables). It strips و ف ب ل ك س ال and pronoun/plural/verb endings, then maps the stem to its Hans Wehr root. It also covers modern words missing from Hans Wehr.
- **Wiktionary** (15.4k entries, 232k inflected forms including broken plurals and conjugations), from English Wiktionary via Vuizur/Wiktionary-Dictionaries. CC BY-SA 3.0 / GFDL.
- **Lane's Lexicon** (47.8k entries under 5k roots), from GibreelAbdullah/LaneLexicon. It's split into one file per first letter and loaded only when you open a root's Lane section.
- **al-Mufradāt fī gharīb al-Qur’ān** by al-Rāghib al-Iṣfahānī (ed. Ṣafwān al-Dāwūdī; 1,621 entries) and **Mukhtār al-Ṣiḥāḥ** by al-Rāzī (3,468 entries), both in Arabic, from al-Maktaba al-Shāmila's EPUBs with the printed editions' vowel marks: Mukhtār is fully vowelled, al-Mufradāt has the editor's marks on headwords and Qur'an quotes. Al-Mufradāt's Qur'an quotes are located using OpenITI's copy, which marks them (CC BY-NC-SA 4.0). Each book is split by root into one file per first letter, loaded when a result needs it. They show as their own sections, after the other dictionaries by default; every word in them can be tapped to look it up, and the word you searched is highlighted.
- **Ranking & Tashkeel:** when a word could be several things, readings Hans Wehr has as an entry of their own come first, then the root used most in the Qur'an (المؤمنين reads مُؤْمِن "believer", not مُؤَمِّن "guarantor"). If you add harakat or explicit hamza (e.g. `عِلْم` vs `عَلَم` vs `عَلِمَ`, or partial `عِلم`), exact vocalized matches jump to the top of autocomplete and the root card; if the tashkeel is wrong (e.g. `عُلْم`), full root results still appear cleanly.
- **Particles & Harf Jarr (`particles.js`):** closed-class Arabic function words (`إِنَّ`, `أَنَّ`, `أَنْ`, `إِنْ`, `لِ`, `لَ`, `مِنْ`, `مَنْ`, `عَلَى`, `لَمْ`, `لَنْ`, etc.) render in a dedicated **Particles & Grammar (`حروف وأدوات`)** card above lexical roots, showing grammatical category, syntactic effect (`عمل`), meanings, examples, and lookalike distinctions.
- **Appearance & Settings:** switch between **Paper Light**, **Parchment Sepia**, and **Obsidian Night** themes, choose an Arabic typeface (**Amiri**, **Scheherazade New**, or **Noto Naskh Arabic**), scale English and Arabic dictionaries independently (80%–160%), and toggle/reorder dictionaries.
- **First load:** the search index, then Hans Wehr's headwords and the chunk for what's on screen, then the word analyser, then Wiktionary, one at a time so a slow connection isn't split between them. On slow 4G a first visit shows كتاب in about 8 s (it used to take about 21 s).
- **Matching:** search ignores harakat, tatweel and hamza spelling (ء أ إ آ ٱ ؤ ئ all match ا), and treats ة/ه and ى/ي as the same.
- **When nothing matches:** search tries the word again without a leading ال (or وال, بال, فال, كال, لل), then without an emphatic نّ: before a pronoun ending (تغرنكم → تغركم) or at the end (ليسجنن → ليسجن). A note says what it showed instead.
- **What you can type:** an Arabic word in any inflection, a root with spaces or dashes (`ك ت ب`), English, or transliteration (`kitab`).
- **Tap to look up:** tap any Arabic word inside a definition to look it up.

### Sync, history, vocab, study
- **Sync:** optional, with a username and no password. The sign-in sheet suggests a key-like name (an Arabic word and four digits, like `qalam-4821`) with ↻ and Copy, and nudges names that are easy to guess; any 3–32 letters, digits, `-` or `_` still work. Every change is saved to IndexedDB first and synced in the background, so the app never waits on the network. If `SYNC_URL` is empty, the app runs local-only with no login UI.
- **History:**
  - recorded each time a result is shown; repeats are deduplicated, and searching again moves a word to the top;
  - the History tab lets you delete entries (swipe or ✕), clear everything, or pause recording;
  - the home screen shows a study card (what's due today, with **Review now**), a welcome, then the 12 most recent searches as tiles.
- **Vocab:**
  - a bookmark on every dictionary row saves the word into a folder, pre-filled with the meaning, root, transliteration and a link back to the entry;
  - folders can be nested, renamed, moved and deleted;
  - cards can be filtered, edited, moved and deleted in bulk, or added by hand;
  - CSV/JSON export, and import of CSV, Anki TSV or JSON.
- **Study:**
  - **Browse** is a flip card with Again / Got it marks, filter chips and Shuffle (after the "دع الأيام Vocabulary" page);
  - **Review** is SM-2 spaced repetition (Again / Hard / Good / Easy) over the cards due today;
  - you can study several folders at once.
- **First visit:** a short guided tour (welcome, a sample search for كتاب, results, the bookmark, Vocab, a sample flashcard to flip and grade, Settings), then the sign-in sheet. Skip with Esc; replay from Settings → Help. Runs once per device and never on a link or for someone with history.
- **Navigation:** Search · Vocab · History tabs, a bottom bar on phones and in the header on iPad. At 900px and wider, a side panel lists recent searches and the folder tree with due counts, and a status bar shows where your data is saved and the keys that work on the current screen. Hash routes: `#q=`, `#e=`, `#f=`, `#w=`, `#vocab`, `#folder=<id>`, `#study=<id,id>&mode=browse|review`, `#history`, `#settings`, `#account`.
- **Settings** (`#settings`, from the gear beside the search field on the home and result pages; **Back**, Esc or the gear again returns to the search you had open, where you were on the page): turn each dictionary on or off, drag them into the order they show in results (or use the arrow keys on a row's handle), and show or hide the "Parsed" word analysis, and make the text of the English and the Arabic dictionaries larger or smaller, separately (80%–160%). Settings sync with your account. An entry you open directly (from Vocab or a link) always shows, even if its dictionary is off.
- **Keyboard:**
  - `/` or ⌘K focuses search;
  - Esc leaves study or a folder;
  - in study: Space flips, ← → move, `1`/`2` mark (Browse), `1`–`4` grade (Review).

## Deploying

1. **Sync Worker (once).** See [worker/README.md](worker/README.md). In short:
   ```bash
   cd worker && npm install
   npx wrangler login
   npx wrangler d1 create qamus                       # paste the database_id into wrangler.toml
   npx wrangler d1 migrations apply qamus --remote    # creates the docs table
   # set ALLOWED_ORIGIN in wrangler.toml to the site's address(es), comma-separated
   npx wrangler deploy
   ```
2. **Point the app at it.** In `app.js`, the `SYNC_URL` constant holds the Worker URL, e.g. `https://qamus-sync.<account>.workers.dev`. Leave it empty for a local-only build.
3. **Bump `VERSION` in `sw.js`** on every deploy, and add any new file to `SHELL`. Open copies show "Qamus was updated · Reload" once the new version has installed.
4. **Publish the site:** `npm run deploy:site` copies the site files into `dist/` (`scripts/build-site.sh`, which checks every file `sw.js` caches is there) and uploads them to the Cloudflare Pages project `alqamus`. Also push to `main`: GitHub keeps the code, and the old GitHub Pages copy shows the "new home" notice.
5. **On the iPad:** open https://alqamus.pages.dev in Safari → Share → **Add to Home Screen**. Open it once while online so the data is cached for offline use. Choose a username when asked, and use the same one on your other devices.

**Capacity.** Sync stores one row per username in Cloudflare D1. The free plan allows about 100,000 rows written a day (one per sync), enough for thousands of daily users. Past that, Workers Paid ($5/month) raises the limits with no code change.

## Local development

Two dev servers are defined in `.claude/launch.json`:
```bash
node tests/serve.js 8000          # the site: http://127.0.0.1:8000
npm --prefix worker run dev       # the Worker with a local D1 (and simulated KV): http://localhost:8787
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
- **`tests/*.test.js`** (Node's built-in runner): `merge.js` rules and validation, plus the Worker run against an in-memory KV and D1 (including accounts that move from KV to D1).
- **`tests/e2e/*.spec.js`** (Chromium, headless). Playwright starts its own site and Worker servers on ports 8100 and 8788.

  | Spec | Covers |
  |---|---|
  | `regression` | the SPEC §8 lookup table (search must not change) |
  | `sync` | login, two-device sync, conflicts, tombstones, offline, sign-out |
  | `history` | recording, dedupe, delete/clear/pause, migration, sync |
  | `vocab` | bookmarks, save sheet, folders, folder view, import/export |
  | `study` | Browse, marks, filters, Review/SM-2, keyboard, swipe, offline |
  | `arabic` | the two Arabic–Arabic dictionaries: sections, highlighting, tap to look up, roots only they have, saving |
  | `settings` | the header gear, the settings page, drag and keyboard reordering, dictionaries on/off, the word-analysis toggle, reset |
  | `loading` | the first-load order, Hans Wehr's chunks, the background prefetch, a slow chunk |
  | `intro` | the first-visit tour, the username suggestions, the old address's "new home" notice |
  | `nav` | tabs, the side panel and status bar, `#account`, the memory router, keyboard shortcuts, titles, the home greeting, the update notice |

## Project layout

| Path | What it is |
|---|---|
| `index.html` | app shell: adaptive left navigation rail, glass search omnibar, reading workspace, and mobile bottom bar |
| `app.js` | ES module UI: routing, Home desk, result views, Particles cards, Vocab & Folders (with mastery bars, CSV/JSON import/export), Study mode (Browse + SM-2 Review with Undo), History, Settings/Appearance Studio, and Sync/Account sheets |
| `engine.js` | ES module lexicographic engine: normalization, Buckwalter morphology (`analyze`), soft tashkeel/transliteration scoring, Hans Wehr chunked loading, Wiktionary, Lane, al-Mufradāt, and Mukhtār al-Ṣiḥāḥ |
| `particles.js` | curated Arabic function words (`حروف الجرّ`, `إنّ وأخواتها`, `حروف النصب والجزم`, conditionals, conjunctions) with syntactic effects and examples |
| `sync.js` | `QamusStore` (IndexedDB document, falling back to memory) and `QamusSync` (the push/pull loop) |
| `merge.js` | shared merge and validation, used by both the site and the Worker |
| `sw.js` | split-cache service worker (`qamus-shell-vN` vs `qamus-data-vN`) so UI deploys don't re-download ~14 MB of static dictionary JSON |
| `style.css` | editorial lexicon design tokens (Paper Light, Parchment Sepia, Obsidian Night) and all styles |
| `worker/` | the Cloudflare Worker (`wrangler.toml`, `src/index.js`) |
| `tests/` | unit tests (`merge.test.js`, `worker.test.js`, `engine.test.js`), Playwright specs, `serve.js` (static server for dev and tests) |
| `build/`, `data/` | the dictionary data and the scripts that build it (`data/lane/`, `data/mufradat/`, `data/mukhtar/` are split by first letter) |

## Data and sync model

Each username has one JSON document: `history`, `folders`, `cards`, `reviews` and `settings`. Each device keeps a full copy in IndexedDB.

**Pushing and pulling:**
- A push sends the whole document about 2 s after a change. New searches are the exception: they are saved on the device at once but synced in batches, with the next other change, when the app goes to the background, or after 5 minutes.
- The Worker merges it with the stored copy and returns the result.
- The app pulls when it opens, when it comes back to the foreground, when the network returns, and on **Sync now**.

**Merge rules** (`merge.js`, identical on the client and the server):
- **Folders and cards:** union by `id`; the larger `updatedAt` wins, and on a tie the delete wins. Deletes are tombstones, kept for 30 days.
- **Reviews:** per card, the larger `updatedAt` wins. Browse marks live there as `mark` (1 = got it, 2 = again).
- **History:** each query keeps only its newest entry. Deleting an entry writes a tombstone. "Clear history" sets `settings.historyClearedAt`. At most 500 live entries.

**Storage:** one D1 row per username. Accounts created before the move to D1 are read from the old KV namespace until their next sync writes them to D1, so nobody has to do anything.

**Limits:** 1 MB per document, 5,000 cards, 500 folders, 60 writes per minute per username (Cloudflare's rate-limiting binding, so each sync costs a single D1 write).

**Caveats:**
- The username is the only secret.
- The client re-pushes whenever its merged copy differs from the server's, so a write that's briefly lost heals on the next sync.
- A device that stays offline for more than 30 days can bring back items deleted elsewhere.

## Rebuilding the data
```
python3 build/build.py <hanswehr.sqlite> <pyaramorph data dir> data/
python3 build/build_extra.py <wiktionary stardict dir> <lanelexicon.sqlite> data/
python3 build/build_arabic.py <23636.epub> <23193.epub> data/ [<Mufradat.JK001150-ara1>]
python3 build/split_hw.py data/
```
Run them in that order: `split_hw.py` makes the app's copy of Hans Wehr (`data/hw/`) from `hw.json`, which the other scripts read; `build_extra.py` adds to the index that `build.py` writes, and `build_arabic.py` files its entries under Hans Wehr's roots. The two EPUBs are at `old.shamela.ws/epubs/236/23636.epub` and `old.shamela.ws/epubs/231/23193.epub`; the optional OpenITI text (for al-Mufradāt's Qur'an quote marks) is in the [0525AH](https://github.com/OpenITI/0525AH/tree/master/data/0502RaghibIsbahani/0502RaghibIsbahani.Mufradat) repository.
