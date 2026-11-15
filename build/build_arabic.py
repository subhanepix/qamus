"""Add two Arabic–Arabic dictionaries to the site data, from the OpenITI corpus:
  - al-Rāghib al-Iṣfahānī, al-Mufradāt fī gharīb al-Qurʾān   (0502RaghibIsbahani.Mufradat.JK001150-ara1)
  - al-Rāzī, Mukhtār al-Ṣiḥāḥ                               (0666IbnAbiBakrZaynDinRazi.MukhtarSihah.Shamela0023193-ara1)

Each is split into one entry per root and written as one JSON file per first letter,
like Lane's Lexicon:  data/<dict>/<hex of first letter>.json  {normRoot: [html, ...]}
plus data/<dict>/roots.json, the sorted list of roots.

Run after build.py (it reads hw.json to file entries under Hans Wehr's spelling of the root):
  python3 -I build_arabic.py <mufradat.txt> <mukhtar.txt> <site/data>
"""
import json, os, re, sys
from collections import defaultdict

MUF, MUX, OUT = sys.argv[1:4]

DIAC = re.compile('[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]')
HAMZA = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا',
                       'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي'})
AR_WORD = re.compile('^[\u0621-\u063a\u0641-\u064a]+$')
ORDER = 'ابتثجحخدذرزسشصضطظعغفقكلمنوهي'   # al-Mufradāt puts و before ه

def norm(s):
    """Must stay identical to norm() in app.js and build.py."""
    return DIAC.sub('', s or '').translate(HAMZA).strip()

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# ---- Hans Wehr roots, so entries are filed under the spelling the root cards look up ----
hw = json.load(open(os.path.join(OUT, 'hw.json'), encoding='utf-8'))
by_id = {e[0]: e for e in hw['entries']}
hw_roots = {norm(e[1]) for e in hw['entries'] if e[3] and e[0] == e[4]}
hw_word_root = {}
for e in hw['entries']:
    hw_word_root.setdefault(norm(e[1]), norm(by_id[e[4]][1]))

def variants(n):   # same idea as rootVariants() in app.js
    out = [n]
    if len(n) == 3 and n[1] == n[2]: out.append(n[:2])
    if len(n) == 2: out.append(n + n[1])
    alt = {'ا': 'وي', 'و': 'يا', 'ي': 'وا'}
    for i, c in enumerate(n):
        for a in alt.get(c, ''): out.append(n[:i] + a + n[i + 1:])
    return out

def root_key(head):
    n = norm(head).replace(' ', '')
    for v in variants(n):
        if v in hw_roots: return v
    if n in hw_word_root: return hw_word_root[n]
    if len(n) > 3 and n.endswith('ا') and n[:-1] in hw_roots: return n[:-1]   # أداء -> ادا
    return n

def clean(s):
    s = re.sub(r'PageV\d+P\d+', '', s)
    s = re.sub(r'\bms\d+\b', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def body(lines):
    """OpenITI lines -> paragraphs: '# ' starts one, '~~' continues it."""
    paras = []
    for ln in lines:
        if ln.startswith('~~') and paras: paras[-1] += ' ' + ln[2:]
        elif ln.startswith('# '): paras.append(ln[2:])
        elif ln.startswith('~~'): paras.append(ln[2:])
    return [p for p in (clean(p) for p in paras) if p]

def header_end(lines):
    return next(i for i, l in enumerate(lines) if l.startswith('#META#Header#End')) + 1

def write(name, entries):
    """entries: [(head, html)] in book order -> shards by the root's first letter."""
    shards = defaultdict(lambda: defaultdict(list))
    for head, html in entries:
        k = root_key(head)
        if k: shards[k[0]][k].append(html)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d): os.remove(os.path.join(d, f))
    total = 0
    for letter, roots in shards.items():
        p = os.path.join(d, '%04x.json' % ord(letter))
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(roots, f, ensure_ascii=False, separators=(',', ':'))
        total += os.path.getsize(p)
    allr = sorted({r for s in shards.values() for r in s})
    with open(os.path.join(d, 'roots.json'), 'w', encoding='utf-8') as f:
        json.dump(allr, f, ensure_ascii=False, separators=(',', ':'))
    filed = sum(1 for r in allr if r in hw_roots)
    print(name, 'entries', len(entries), 'roots', len(allr), 'under a Hans Wehr root', filed,
          'shards', len(shards), total // 1024, 'KB')

# ---------------- al-Mufradāt ----------------
# Entries are paragraphs that open "# <headword> : ". A few ordinary sentences look the same
# ("# قيل : ..."), so a headword must start with the current letter of the book, or the next one
# when the headword after it agrees.
lines = open(MUF, encoding='utf-8').read().split('\n')
lines = lines[header_end(lines):]
HEAD = re.compile(r'^# (\S{2,6}) : ')
cands = [(i, m.group(1)) for i, l in enumerate(lines) if (m := HEAD.match(l)) and AR_WORD.match(m.group(1))]
first = lambda w: norm(w)[:1] or '?'
starts, cur = [], 0
for j, (i, w) in enumerate(cands):
    c = ORDER.find(first(w))
    if c < 0: continue
    nxt = ORDER.find(first(cands[j + 1][1])) if j + 1 < len(cands) else c
    if c == cur or (cur < c <= cur + 2 and nxt == c) or (not starts and c == 0):
        starts.append((i, w)); cur = c
muf = []
for n, (i, w) in enumerate(starts):
    end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
    ps = body(lines[i:end])
    ps[0] = ps[0][len(w):].lstrip(' :')
    html = '<br>'.join(esc(p) for p in ps)
    html = re.sub(r'@QB@\s*(.*?)\s*@QE@', r'<q>\1</q>', html)
    html = re.sub(r'@Q[BE]@', '', html).replace(' % % ', ' … ')
    muf.append((w, f'<b>{esc(w)}</b>: ' + html))
write('mufradat', muf)

# ---------------- Mukhtār al-Ṣiḥāḥ ----------------
# Root headings look like "### | أد م" and are followed by "# : (word) ...". Other "### |" lines are
# letter headings ("حرف الهمزة"), page numbers ("[ص: 16]"), or text the converter cut out of the middle
# of a sentence (sometimes of a word), which goes back where it was.
lines = open(MUX, encoding='utf-8').read().split('\n')
lines = lines[header_end(lines):]
start = next(i for i, l in enumerate(lines) if l.startswith('### | حرف'))
ROOT_H = re.compile(r'^[ء-ي]{1,3}( [ء-ي]{1,3}){0,4}$')
def next_text(i):
    for l in lines[i + 1:i + 4]:
        if l.strip() and not re.match(r'^# PageV\d+P\d+\s*$', l): return l
    return ''
mux, cur, buf = [], None, []
for i in range(start, len(lines)):
    l = lines[i]
    if l.startswith('### | '):
        t = l[6:]
        if ROOT_H.match(t.strip()) and next_text(i).startswith('# :'):
            if cur: mux.append((cur, buf))
            cur, buf = t.strip(), []
        elif t.startswith('حرف') or t.startswith('باب') or re.match(r'^\[ص: \d+\]\s*$', t.strip()):
            if buf: buf.append('\1')          # the next "# " line carries on the sentence
        elif buf:
            buf.append('\0' + t + '\0')       # glue the cut text back without spaces
        continue
    if re.match(r'^# PageV\d+P\d+\s*$', l) or not l.strip(): continue
    if cur is not None: buf.append(l)
if cur: mux.append((cur, buf))

def glue(buf):
    out = []
    for l in buf:
        if l.startswith('\0') and out:
            out[-1] = out[-1] + l.strip('\0')
            out.append('\0')
        elif l in ('\0', '\1'):
            out.append(l)
        elif out and out[-1] in ('\0', '\1'):
            sep = '' if out.pop() == '\0' else ' '
            if out: out[-1] = out[-1] + sep + (l[2:] if l.startswith(('# ', '~~')) else l)
            else: out.append(l)
        else:
            out.append(l)
    return [l for l in out if l not in ('\0', '\1')]

mux_html = []
for head, buf in mux:
    ps = body(glue(buf))
    if not ps: continue
    ps[0] = ps[0].lstrip(' :')
    html = '<br>'.join(esc(p) for p in ps)
    html = re.sub(r'\{([^{}]*)\}', r'<q>\1</q>', html)
    html = re.sub(r'\(([^()]{1,40})\)', lambda m: f'<b>{m.group(1).strip()}</b>' if re.search('[ء-ي]', m.group(1)) else m.group(0), html)
    mux_html.append((head, f'<b>{esc(head)}</b>: ' + html))
write('mukhtar', mux_html)
