"""Build data files for the dictionary site.

Usage: python3 -I build.py <hanswehr.sqlite> <buckwalter_dir> <out_dir>
"""
import json, re, sqlite3, sys, os, html
from collections import defaultdict

HW_DB, BW_DIR, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)

BW = {"'": 'ء', '|': 'آ', '>': 'أ', '&': 'ؤ', '<': 'إ', '}': 'ئ', 'A': 'ا', 'b': 'ب', 'p': 'ة',
      't': 'ت', 'v': 'ث', 'j': 'ج', 'H': 'ح', 'x': 'خ', 'd': 'د', '*': 'ذ', 'r': 'ر', 'z': 'ز',
      's': 'س', '$': 'ش', 'S': 'ص', 'D': 'ض', 'T': 'ط', 'Z': 'ظ', 'E': 'ع', 'g': 'غ', '_': 'ـ',
      'f': 'ف', 'q': 'ق', 'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'h': 'ه', 'w': 'و', 'Y': 'ى',
      'y': 'ي', 'F': 'ً', 'N': 'ٌ', 'K': 'ٍ', 'a': 'َ', 'u': 'ُ', 'i': 'ِ', '~': 'ّ', 'o': 'ْ',
      '`': 'ٰ', '{': 'ٱ', 'P': 'پ', 'J': 'چ', 'V': 'ڤ', 'G': 'گ'}

def bw2ar(s):
    return ''.join(BW.get(c, c) for c in s)

DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
HAMZA = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا',
                       'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي', 'ي': 'ي'})

def norm(s):
    """Must stay identical to norm() in app.js."""
    return DIAC.sub('', s).translate(HAMZA).strip()

# ---------------- Hans Wehr ----------------
db = sqlite3.connect(HW_DB)
rows = db.execute('select id, word, definition, is_root, parent_id, quran_occurrence from DICTIONARY').fetchall()
rows.sort(key=lambda r: int(r[0]))

FORM_RE = re.compile(r'<b>\s*(I{1,3}|IV|VI{0,3}|IX|X)\s*</b>\s*(?:\(([^)]*)\))?')
STOP = {'see','pl','fr','it','eng','pers','turk','gr','lat','sp','coll','do','also','and','or','eg','syr','leb','ir','tun','mor','alg','magr','hij','sudan','pal','jord','sg','du','fem','masc','esp','obs','prop','pass','tr','intr'}
LATIN_RE = re.compile(r"[A-Za-zāīūḥṣḍṭẓʿʾšǧḡḵṯḏġčēōë’‘\-]+")

entries = []      # [id, word, def, isRoot, parentId, quranCount, translit]
forms = []        # [rootId, formNumeral, vocalizedVerb, meaning]
for (eid, word, defn, is_root, parent, qo, *_ ) in rows:
    eid, parent = int(eid), int(parent)
    defn = defn or ''
    rest = defn[len(word):] if defn.startswith(word) else defn
    translit = ''
    for m in LATIN_RE.finditer(rest[:80]):
        t = m.group(0)
        before = rest[:m.start()]
        in_paren = before.count('(') > before.count(')')
        if '<b>' in before:
            break
        cons = len(re.sub(r'[aeiouāīūēō\-]', '', t.lower()))
        strong_n = len([c for c in norm(word.rstrip('ة')) if c not in 'اوي '])
        if (len(t) > 1 and t.lower().strip('-') not in STOP and not in_paren
                and abs(cons - strong_n) <= 1):
            translit = t
            break
    q = int(qo) if qo not in (None, '', 0, '0') else 0
    entries.append([eid, word, defn, 1 if int(is_root) else 0, parent, q, translit])
    if int(is_root):
        parts = list(FORM_RE.finditer(defn))
        for k, fm in enumerate(parts):
            end = parts[k + 1].start() if k + 1 < len(parts) else len(defn)
            meaning = defn[fm.end():end].strip()
            forms.append([eid, fm.group(1), (fm.group(2) or '').strip(), meaning])

by_id = {e[0]: e for e in entries}
hw_words = defaultdict(list)
for e in entries:
    if e[4] not in hw_words[norm(e[1])]:
        hw_words[norm(e[1])].append(e[4])
hw_roots = defaultdict(list)
for e in entries:
    if e[3]:
        hw_roots[norm(e[1])].append(e[0])

# ---------------- Buckwalter ----------------
def read(name):
    with open(os.path.join(BW_DIR, name), encoding='latin-1') as f:
        return f.read().splitlines()

def gloss_clean(g):
    return re.sub(r'<pos>.*?</pos>', '', g).replace('<verb>', '').strip()

def affixes(name):
    out = defaultdict(list)
    for line in read(name):
        if line.startswith(';') or not line.strip():
            continue
        p = line.split('\t')
        while len(p) < 4:
            p.append('')
        key, voc, cat, gl = p[:4]
        out[norm(bw2ar(key))].append([bw2ar(voc), cat, gloss_clean(gl)])
    return out

prefixes = affixes('dictPrefixes')
suffixes = affixes('dictSuffixes')

def table(name):
    s = set()
    for line in read(name):
        if line.startswith(';') or not line.strip():
            continue
        a, b = line.split()[:2]
        s.add(a + ' ' + b)
    return sorted(s)

roots = []        # [arabicRoot, [hwRootIds]]
root_idx = {}
stems = defaultdict(list)   # normKey -> [[voc, cat, gloss, rootIdx, lemma]]
cur_root = None
lemma = ''
for line in read('dictStems'):
    if line.startswith(';--- '):
        r = bw2ar(line[5:].strip().split()[0]) if line[5:].strip() else ''
        if r not in root_idx:
            base = re.sub(r'\(\d+\)|-', '', norm(r))
            if '/' in base:  # e.g. اخو/ي -> اخو, اخي
                head, alt = base.split('/')[:2]
                cands = [head, head[:-len(alt)] + alt]
            else:
                cands = [base]
            more = []
            for n in cands:
                if len(n) == 3 and n[1] == n[2]:
                    more.append(n[:2])
                if len(n) == 2:
                    more.append(n + n[1])
                for i, ch in enumerate(n):  # weak-letter alternations
                    for alt in {'ا': 'وي', 'و': 'يا', 'ي': 'وا'}.get(ch, ''):
                        more.append(n[:i] + alt + n[i + 1:])
            ids = []
            for n in cands + more:
                ids = hw_roots.get(n, [])
                if ids:
                    break
            if not ids:
                for n in cands:
                    ids = hw_words.get(n, [])
                    if ids:
                        break
            root_idx[r] = len(roots)
            roots.append([r, ids])
        cur_root = root_idx[r]
        continue
    if line.startswith(';; '):
        lemma = bw2ar(re.sub(r'_\d+$', '', line[3:].strip()).split('-')[0])
        continue
    if line.startswith(';') or not line.strip():
        continue
    p = line.split('\t')
    if len(p) < 4:
        continue
    key, voc, cat, gl = p[:4]
    stems[norm(bw2ar(key))].append([bw2ar(voc), cat, gloss_clean(gl),
                                    cur_root if cur_root is not None else -1, lemma])

# The ';---' root headers in dictStems are missing for some lemmas, so a stem can inherit the
# previous root. Verify the root's strong consonants occur in order in the stem; if not, resolve
# the root through Hans Wehr (lemma/stem -> HW word -> its root). Store resolved HW root ids at [5].
def strong(s):
    return [c for c in s if c not in 'اوي']

def subseq(needle, hay):
    it = iter(hay)
    return all(c in it for c in needle)

for k, v in stems.items():
    for x in v:
        voc, ri, lem = x[0], x[3], x[4]
        ok = False
        if ri >= 0:
            rn = re.sub(r'\(\d+\)|-|/.*$', '', norm(roots[ri][0]))
            ok = subseq(strong(rn), norm(voc)) or subseq(strong(rn), norm(lem))
        ids = roots[ri][1] if ok else []
        if not ids:
            for cand in (norm(lem), norm(voc), k):
                ids = hw_words.get(cand, [])
                if ids:
                    break
        if not ok:
            x[3] = -1
        x.append(ids)

# dedupe stem lists (bare-alif duplicates collapse after normalization)
for k, v in stems.items():
    seen, out = set(), []
    for x in v:
        t = (x[0], x[1], x[2])
        if t not in seen:
            seen.add(t); out.append(x)
    stems[k] = out

# ---------------- autocomplete index ----------------
# [normKey, display, kind, ref]  kind: h=HW entry, f=verb form, b=buckwalter lemma
idx = {}
def add(key, disp, kind, ref, pri):
    k = (key, disp, kind, str(ref))
    if key and k not in idx:
        idx[k] = pri

for e in entries:
    add(norm(e[1]), e[1], 'h', e[0], 0 if e[3] else 1)
for i, f in enumerate(forms):
    if f[2]:
        add(norm(f[2]), f[2], 'f', i, 2)
hw_keys = {norm(e[1]) for e in entries} | {norm(f[2]) for f in forms if f[2]}
seen_lem = set()
for key, lst in stems.items():
    for (voc, cat, gl, ri, lem, _ids) in lst:
        n = norm(lem)
        if n in hw_keys or (n, gl) in seen_lem or not n:
            continue
        seen_lem.add((n, gl))
        add(n, lem, 'b', key, 3)

index = sorted(([k[0], k[1], k[2], k[3], p] for k, p in idx.items()), key=lambda r: (r[0], r[4]))

def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')

dump('hw.json', {'entries': entries, 'forms': forms})
dump('morph.json', {'prefixes': prefixes, 'suffixes': suffixes, 'stems': stems, 'roots': roots,
                    'AB': table('tableAB'), 'AC': table('tableAC'), 'BC': table('tableBC')})
dump('index.json', [r[:4] for r in index])
print('entries', len(entries), 'roots', sum(e[3] for e in entries), 'forms', len(forms),
      'stems', len(stems), 'bw roots', len(roots),
      'bw roots unmatched', sum(1 for r in roots if not r[1]), 'index', len(index))
