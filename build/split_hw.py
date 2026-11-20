"""Split data/hw.json so a first visit downloads only Hans Wehr's headwords, and definitions arrive as roots open.

  data/hw/index.json   {"e": [[id, word, isRoot, rootId, quran, translit], ...],   (entries, same order as hw.json)
                        "f": [[rootId, formNumber, verb], ...],                    (verb forms, same order)
                        "chunks": [first root id of each chunk, ...]}
  data/hw/cNNN.json    {"e": {entryId: definition}, "f": {formIndex: definition}} for the roots of chunk NNN

Roots are taken in id order, ROOTS_PER_CHUNK at a time; a word or verb form goes in its root's chunk.
Run after build.py (and before deploying):  python3 -I build/split_hw.py data/
"""
import json, os, sys

ROOTS_PER_CHUNK = 200
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
hw = json.load(open(os.path.join(OUT, 'hw.json'), encoding='utf-8'))
E, F = hw['entries'], hw['forms']

roots = sorted({e[4] for e in E} | {f[0] for f in F})
starts = roots[::ROOTS_PER_CHUNK]
def chunk_of(root_id):          # the last chunk whose first root id is <= root_id
    lo, hi = 0, len(starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if starts[mid] <= root_id: lo = mid
        else: hi = mid - 1
    return lo

chunks = [{'e': {}, 'f': {}} for _ in starts]
for e in E:
    chunks[chunk_of(e[4])]['e'][str(e[0])] = e[2]
for i, f in enumerate(F):
    chunks[chunk_of(f[0])]['f'][str(i)] = f[3]

d = os.path.join(OUT, 'hw')
os.makedirs(d, exist_ok=True)
for name in os.listdir(d):
    os.remove(os.path.join(d, name))
dump = lambda o, p: json.dump(o, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
dump({'e': [[e[0], e[1], e[3], e[4], e[5], e[6]] for e in E], 'f': [[f[0], f[1], f[2]] for f in F], 'chunks': starts},
     os.path.join(d, 'index.json'))
sizes = []
for k, c in enumerate(chunks):
    p = os.path.join(d, 'c%03d.json' % k)
    dump(c, p)
    sizes.append(os.path.getsize(p))
print('hw/index.json', os.path.getsize(os.path.join(d, 'index.json')) // 1024, 'KB;', len(chunks), 'chunks of', ROOTS_PER_CHUNK,
      'roots,', min(sizes) // 1024, '-', max(sizes) // 1024, 'KB each')
