"""Add Wiktionary (StarDict build by Vuizur) and Lane's Lexicon to the site data.

Run after build.py:
  python3 -I build_extra.py <stardict_dir> <lanelexicon.sqlite> <site/data>
"""
import gzip, json, os, re, sqlite3, struct, sys
from collections import defaultdict

SD_DIR, LANE_DB, OUT = sys.argv[1:4]

DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
HAMZA = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا',
                       'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي'})
AR = re.compile('[؀-ۿ]')

def norm(s):
    """Must stay identical to norm() in app.js and build.py."""
    return DIAC.sub('', s or '').translate(HAMZA).strip()

hw = json.load(open(os.path.join(OUT, 'hw.json'), encoding='utf-8'))
hw_words = defaultdict(list)          # norm word -> HW root ids
for e in hw['entries']:
    if e[4] not in hw_words[norm(e[1])]:
        hw_words[norm(e[1])].append(e[4])
for f in hw['forms']:
    if f[2] and f[0] not in hw_words[norm(f[2])]:
        hw_words[norm(f[2])].append(f[0])
hw_by_id = {e[0]: e for e in hw['entries']}
index = json.load(open(os.path.join(OUT, 'index.json'), encoding='utf-8'))
index_keys = {r[0] for r in index}

# ---------------- Wiktionary (StarDict) ----------------
base = os.path.join(SD_DIR, 'Arabic-English Wiktionary dictionary')
raw = open(base + '.idx', 'rb').read()
words, i = [], 0
while i < len(raw):
    j = raw.index(b'\0', i)
    off, sz = struct.unpack('>II', raw[j + 1:j + 9])
    words.append((raw[i:j].decode('utf-8'), off, sz))
    i = j + 9
data = gzip.open(base + '.dict.dz').read()
raw = open(base + '.syn', 'rb').read()
syn = defaultdict(set)
i = 0
while i < len(raw):
    j = raw.index(b'\0', i)
    k, = struct.unpack('>I', raw[j + 1:j + 5])
    syn[k].add(raw[i:j].decode('utf-8'))
    i = j + 5

w_entries = []   # [headword, translit, html, [hwRootIds]]
w_forms = []     # per entry: space-joined normalized Arabic forms (excluding the headword)
for k, (w, off, sz) in enumerate(words):
    html = data[off:off + sz].decode('utf-8')
    forms = syn.get(k, set())
    tr = sorted({f for f in forms if len(f) > 2 and not AR.search(f) and re.search('[a-zāīūḥṣḍṭẓʿʾ]', f)
                 and not re.search('[֐-׿]', f)}, key=len)
    hn = norm(w)
    nforms = sorted({norm(f) for f in forms if AR.search(f)} - {hn, ''})
    def fits(rid):  # the root's strong consonants must appear, in order, in the headword
        r = [c for c in norm(hw_by_id[rid][1]) if c not in 'اوي']
        it = iter(hn)
        return all(c in it for c in r)
    roots = [r for r in hw_words.get(hn, []) if fits(r)]
    if not roots:
        for f in nforms:
            cand = [r for r in hw_words.get(f, []) if fits(r)]
            if cand:
                roots = cand
                break
    w_entries.append([w, tr[0] if tr else '', html, roots])
    w_forms.append(' '.join(nforms))

with open(os.path.join(OUT, 'wikt.json'), 'w', encoding='utf-8') as f:
    json.dump({'entries': w_entries, 'forms': w_forms}, f, ensure_ascii=False, separators=(',', ':'))
print('wikt.json', os.path.getsize(os.path.join(OUT, 'wikt.json')) // 1024, 'KB',
      'entries', len(w_entries), 'forms', sum(len(x.split()) for x in w_forms if x))

new_rows = []
for k, e in enumerate(w_entries):
    n = norm(e[0])
    if n and AR.search(n) and n not in index_keys:
        new_rows.append([n, e[0], 'w', str(k), 4])

# ---------------- Lane's Lexicon ----------------
db = sqlite3.connect(LANE_DB)
rows = db.execute('select id, word, definition, is_root, parent_id from DICTIONARY order by id').fetchall()
lane_roots = {}                      # lane root id -> norm root
for (rid, word, d, is_root, parent) in rows:
    if is_root == 1 and str(rid).isdigit():
        lane_roots[int(rid)] = norm(word)
shards = defaultdict(lambda: defaultdict(list))   # shard -> normRoot -> [[word, def], ...]
lane_words = defaultdict(set)                      # norm word -> {normRoot}
for (eid, word, d, is_root, parent) in rows:
    if is_root == 1 or not str(parent).isdigit() or int(parent) not in lane_roots:
        continue
    root = lane_roots[int(parent)]
    if not root:
        continue
    d = (d or '').replace('🡻', '')
    shards[root[0]][root].append([word, d])
    nw = norm(word)
    if nw:
        lane_words[nw].add(root)
    # vocalized headword at the start of the definition (e.g. كَتَبَهُ) -> also searchable
    m = re.match(r'([؀-ۿً-ْ ]+)', d)
    if m and norm(m.group(1)) and norm(m.group(1)) != nw:
        lane_words[norm(m.group(1))].add(root)

os.makedirs(os.path.join(OUT, 'lane'), exist_ok=True)
manifest = {}
total = 0
for letter, roots in shards.items():
    name = '%04x.json' % ord(letter)
    p = os.path.join(OUT, 'lane', name)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(roots, f, ensure_ascii=False, separators=(',', ':'))
    manifest[letter] = name
    total += os.path.getsize(p)
with open(os.path.join(OUT, 'lane', 'roots.json'), 'w', encoding='utf-8') as f:
    json.dump(sorted({r for s in shards.values() for r in s}), f, ensure_ascii=False, separators=(',', ':'))
print('lane shards', len(manifest), total // 1024, 'KB', 'roots', sum(len(s) for s in shards.values()),
      'entries', sum(len(v) for s in shards.values() for v in s.values()))

seen = {(r[0], r[2]) for r in index} | {(r[0], r[2]) for r in new_rows}
for nw, roots in lane_words.items():
    if (nw, 'l') in seen or nw in index_keys or not AR.search(nw):
        continue
    for r in sorted(roots):
        new_rows.append([nw, nw, 'l', r, 5])
    seen.add((nw, 'l'))

index = [r + [9] if len(r) == 4 else r for r in index]
pri = {'h': 0, 'f': 2, 'b': 3, 'w': 4, 'l': 5}
merged = sorted([r[:4] for r in index] + [r[:4] for r in new_rows], key=lambda r: (r[0], pri.get(r[2], 9)))
with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump(merged, f, ensure_ascii=False, separators=(',', ':'))
print('index.json', os.path.getsize(os.path.join(OUT, 'index.json')) // 1024, 'KB', 'rows', len(merged),
      'added', len(new_rows))
