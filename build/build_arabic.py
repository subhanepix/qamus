"""Add two Arabic–Arabic dictionaries to the site data, from al-Maktaba al-Shāmila's EPUBs, which keep the
printed editions' vowel marks:
  - al-Rāghib al-Iṣfahānī, al-Mufradāt fī gharīb al-Qurʾān, ed. Ṣafwān al-Dāwūdī   old.shamela.ws/epubs/236/23636.epub
  - al-Rāzī, Mukhtār al-Ṣiḥāḥ                                                       old.shamela.ws/epubs/231/23193.epub
The Shāmila copy of al-Mufradāt doesn't mark where Qur'an quotes start and end. OpenITI's JK copy does
(@QB@ … @QE@), so its quotes are found in the vowelled text by their letters and marked there:
  - 0502RaghibIsbahani.Mufradat.JK001150-ara1   github.com/OpenITI/0525AH (optional; without it, no quote marks)

Each book is split into one entry per root and written as one JSON file per first letter, like Lane's Lexicon:
data/<dict>/<hex of first letter>.json  {normRoot: [html, ...]}  plus data/<dict>/roots.json.
The html holds only <b> (headwords), <q> (Qur'an), <i> (verse references) and <br>.

Run after build.py (it reads hw.json to file entries under Hans Wehr's spelling of the root):
  python3 -I build_arabic.py <23636.epub> <23193.epub> <site/data> [<Mufradat.JK001150-ara1>]
"""
import html as H, json, os, re, sys, zipfile
from collections import defaultdict

MUF, MUX, OUT = sys.argv[1:4]
JK = sys.argv[4] if len(sys.argv) > 4 else None

DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
HAMZA = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا',
                       'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي'})
LETTER = re.compile('[ء-غف-يٱ]')
ORDER = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'

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

# ---------------- reading the EPUB ----------------
PAGE = '\x01'   # where one printed page ends and the next begins

def book_text(path):
    """All pages' text in order, without the editor's footnotes or the page footers."""
    z = zipfile.ZipFile(path)
    names = sorted((n for n in z.namelist() if re.search(r'xhtml/P\d+\.xhtml$', n)),
                   key=lambda n: int(re.search(r'P(\d+)\.xhtml$', n).group(1)))
    pages = []
    for n in names:
        t = z.read(n).decode('utf-8')
        m = re.search(r'id="book-container">(.*?)</div>\s*<hr/>\s*<div class="center">', t, re.S)
        s = (m.group(1) if m else '').split('<span class="footnote-hr">')[0]
        s = re.sub(r"<a id='[^']*'></a>", '', s).replace('<hr/>', '', 1)
        pages.append(s.strip())
    return PAGE.join(pages)

def untitle(text):
    """Drop the converter's title tags but keep their text. They're unreliable: some real headings are plain
    lines, and some tagged "headings" are words (or halves of words) from the middle of a sentence."""
    out, stack, pos = [], [], 0
    for m in re.finditer(r'<span class="([^"]*)">|</span>', text):
        out.append(text[pos:m.start()]); pos = m.end()
        if m.group(1) is not None:
            stack.append(m.group(1) == 'title')
            if not stack[-1]: out.append(m.group(0))
        elif stack and not stack.pop():
            out.append(m.group(0))
    out.append(text[pos:])
    return ''.join(out)

def split_lines(text):
    """[(line, separator after it)]; separators are a line break or a page break."""
    parts = re.split(r'(<br />|' + PAGE + ')', untitle(text))
    return [(parts[i], parts[i + 1] if i + 1 < len(parts) else '') for i in range(0, len(parts), 2)]

def entries(ls, head, skip=lambda l: False, stop=lambda l: False):
    """Group lines into entries. head(k, line) -> (title, rest of line) for a heading line, else None."""
    out = []
    for k, (l, sep) in enumerate(ls):
        if stop(l): break
        h = head(k, l)
        if h:
            out.append([h[0], h[1] + sep])
        elif out and not skip(l):
            out[-1][1] += l + sep
    return out

def plain(body):
    """Entry markup -> plain text with \\n between lines."""
    s = body.replace(PAGE, ' ')
    s = re.sub(r'<span class="red">\s*([\d\-–\s]|<br />)*</span>', '', s)        # the editor's verse numbers
    s = re.sub(r'<span class="red">\s*\.\.\.\s*</span>', ' … ', s)                # between two half-lines of poetry
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = H.unescape(re.sub(r'<[^>]+>', '', s))
    s = re.sub(r'\s*«[\d٠-٩]+»', '', s)                                           # footnote markers
    s = re.sub(r'\s*\n\s*(?=\[[^\[\]\n]{2,30}?[/:]\s*[\d٠-٩])', ' ', s)                  # a verse reference stays on its verse's line
    s = re.sub(r'[ \t\xa0]+', ' ', s)
    return '\n'.join(l.strip() for l in s.split('\n') if l.strip())

REF = re.compile(r'\[[^\[\]\n]{2,30}?[/:]\s*[\d٠-٩][\d٠-٩\-–، ]*\]')   # [البقرة/ 1- 2], [الفرقان: 62]

def to_html(text, quotes=()):
    """Plain text -> escaped html, with the given (start, end) spans as <q> and verse references as <i>."""
    marks = sorted([(a, b, 'q') for a, b in quotes] + [(m.start(), m.end(), 'i') for m in REF.finditer(text)])
    out, pos = [], 0
    for a, b, tag in marks:
        if a < pos: continue
        out.append(esc(text[pos:a]) + f'<{tag}>' + esc(text[a:b]) + f'</{tag}>')
        pos = b
    out.append(esc(text[pos:]))
    return ''.join(out).replace('\n', '<br>')

def find_quotes(text, quotes):
    """Where each (unvowelled) quote occurs in the vowelled text, matching letters only."""
    idx = [i for i, c in enumerate(text) if LETTER.match(c)]
    sk = ''.join(text[i].translate(HAMZA).replace('ٱ', 'ا') for i in idx)
    spans, pos = [], 0
    for q in quotes:
        qs = ''.join(c.translate(HAMZA) for c in q if LETTER.match(c))
        if len(qs) < 4: continue
        j = sk.find(qs, pos)
        if j < 0: j = sk.find(qs)
        if j < 0: continue
        a, b = idx[j], idx[j + len(qs) - 1] + 1
        while b < len(text) and DIAC.match(text[b]): b += 1
        spans.append((a, b)); pos = j + len(qs)
    spans.sort()
    return [s for k, s in enumerate(spans) if k == 0 or s[0] >= spans[k - 1][1]]

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

# ---------------- Qur'an quotes from OpenITI's JK copy of al-Mufradāt ----------------
jk_quotes = defaultdict(list)   # root key -> quotes, in order
if JK:
    lines = open(JK, encoding='utf-8').read().split('\n')
    lines = lines[next(i for i, l in enumerate(lines) if l.startswith('#META#Header#End')) + 1:]
    cur, buf = None, []
    def flush():
        if cur: jk_quotes[root_key(cur)] += re.findall(r'@QB@(.*?)@QE@', ' '.join(buf), re.S)
    for l in lines:
        m = re.match(r'^# (\S{2,6}) : ', l)
        if m and re.match('^[ء-غف-ي]+$', m.group(1)):
            flush(); cur, buf = m.group(1), []
        buf.append(l.lstrip('#~ '))
    flush()

# ---------------- al-Mufradāt ----------------
# A heading is a line holding only a bare root word ("كتب"). Entries start after "كتاب الألف"; everything before
# is the editor's introduction. A heading must start with the book's current letter, or the next one or two when
# the heading after it agrees, which keeps out the odd one-word line of verse.
ls = split_lines(book_text(MUF))
start = next(k for k, (l, _) in enumerate(ls) if norm(l).startswith('كتاب الالف'))
ls = ls[start + 1:]
BARE = re.compile('^[\u0621-\u063a\u0641-\u064a]{2,6}$')
firsts = [ORDER.find(norm(l)[:1]) if BARE.match(DIAC.sub('', l.strip())) else -1 for l, _ in ls]   # some carry a vowel: أسِف
state = {'cur': 0}
def muf_head(k, l):
    c = firsts[k]
    if c < 0: return None
    nxt = next((f for f in firsts[k + 1:] if f >= 0), c)
    if c == state['cur'] or (state['cur'] < c <= state['cur'] + 2 and nxt == c):
        state['cur'] = c
        return (l.strip(), '')
    return None
muf, quote_hits, quote_all = [], 0, 0
# The editor's afterword follows the last entry, opening with the basmala.
muf_end = lambda l: state['cur'] == len(ORDER) - 1 and norm(l).startswith('بسم الله الرحمن الرحيم')
for title, body in entries(ls, muf_head, skip=lambda l: norm(l).startswith('كتاب '), stop=muf_end):
    t = plain(body).split('تمّ ما كتبناه بحمد الله')[0].strip()   # the colophon after the last entry
    t = re.sub(r'^:\s*', '', t)
    qs = jk_quotes.get(root_key(title), [])
    spans = find_quotes(t, qs)
    quote_all += len(qs); quote_hits += len(spans)
    muf.append((title, f'<b>{esc(title)}</b><br>' + to_html(t, spans)))
write('mufradat', muf)
if JK: print('  Qur’an quotes marked', quote_hits, 'of', quote_all)

# ---------------- Mukhtār al-Ṣiḥāḥ ----------------
# A heading starts a line with spaced root letters and a colon: "خ ل س: (خَلَسَ) …". This edition writes ه as هـ.
# Letter headings ("حَرْفُ الْهَمْزَةِ") and page numbers ("[ص: 16]") are dropped.
ls = split_lines(book_text(MUX))
start = next(k for k, (l, _) in enumerate(ls) if norm(l).startswith('حرف'))
L3 = '[\u0621-\u063a\u0640-\u064a]{1,3}'
MUX_H = re.compile(r'^\s*(' + L3 + '(?: ' + L3 + r'){0,4})\s*:\s*(.*)$', re.S)
def mux_head(k, l):
    m = MUX_H.match(l)
    if not m: return None
    # one group ("أو") only before "(word)", since "قال:" looks the same
    return (m.group(1).replace('ـ', ''), m.group(2)) if ' ' in m.group(1) or '(' in m.group(2)[:3] else None
mux = []
for title, body in entries(ls[start:], mux_head, skip=lambda l: norm(l).startswith(('حرف ', 'باب ')) and len(l) < 40):
    t = plain(re.sub(r'\[ص: [\d٠-٩]+\]\s*', '', body))
    h = to_html(t)
    h = re.sub(r'\{([^{}]*)\}', r'<q>\1</q>', h)
    h = re.sub(r'\(([^()<>]{1,40})\)', lambda m: f'<b>{m.group(1).strip()}</b>' if LETTER.search(m.group(1)) else m.group(0), h)
    mux.append((title, f'<b>{esc(title)}</b>: ' + h))
write('mukhtar', mux)
