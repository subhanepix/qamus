# Qamus

Personal Arabic–English dictionary. Static site, works offline once loaded.

## Deploy to GitHub Pages
1. Create a repo and push the contents of this folder to `main` (keep `data/` and `.nojekyll`).
2. Repo → Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / root.
3. On the iPad, open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once online so the data gets cached for offline use.

## What's in it
- **Hans Wehr** (24,799 entries, 7,390 roots, 5,453 verb forms) — from GibreelAbdullah/HansWehrDictionary.
- **Buckwalter morphological lexicon** (~82k stems with English glosses, prefix/suffix tables) — strips و ف ب ل ك س ال and pronoun/plural/verb endings, then maps the stem to its Hans Wehr root. Also covers modern words missing from Hans Wehr.
- **Wiktionary** (15.4k entries, 232k inflected forms incl. broken plurals and conjugations) — English Wiktionary via Vuizur/Wiktionary-Dictionaries. CC BY-SA 3.0 / GFDL.
- **Lane's Lexicon** (47.8k entries under 5k roots) — from GibreelAbdullah/LaneLexicon, split into one file per first letter and loaded only when you open a root's Lane section.
- Search ignores harakat, tatweel, and hamza spelling (ء أ إ آ ٱ ؤ ئ all match ا), plus ة/ه and ى/ي.
- Input types: Arabic word (any inflection), root with spaces/dashes (`ك ت ب`), English, or transliteration (`kitab`).
- Tap any Arabic word inside a definition to look it up. Recent searches on the home screen.

## Rebuilding the data
```
python3 build/build.py <hanswehr.sqlite> <pyaramorph data dir> data/
python3 build/build_extra.py <wiktionary stardict dir> <lanelexicon.sqlite> data/
```
Run them in that order; `build_extra.py` adds to the index that `build.py` writes.
After changing anything, bump `VERSION` in `sw.js` so the iPad picks up the update.
