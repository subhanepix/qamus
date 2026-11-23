// Unit tests for the Qamus lexicographic engine: SPEC §8 regression lookups,
// curated Particles & Harf Jarr distinction, and soft tashkeel prioritization.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let eng;

test.before(async () => {
  globalThis.fetch = async url => {
    const full = path.resolve(ROOT, String(url));
    const txt = fs.readFileSync(full, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
  globalThis.window = { requestIdleCallback: null };
  eng = await import('../engine.js');
  await eng.initEngine();
});

test('SPEC §8 regression lookups resolve to expected roots', () => {
  const cases = [
    ['كتاب', 'ك ت ب'],
    ['ءكل', 'ا ك ل'],
    ['مسءلة', 'س ا ل'],
    ['سءال', 'س ا ل'],
    ['وسيكتبونها', 'ك ت ب'],
    ['بالكتاب', 'ك ت ب'],
    ['فقالوا', 'ق و ل'],
    ['يستغفرون', 'غ ف ر'],
    ['علمتموهن', 'ع ل م'],
    ['اخذتموه', 'ا خ ذ'],
    ['مدرسة', 'د ر س'],
    ['ك ت ب', 'ك ت ب'],
  ];
  for (const [q, expected] of cases) {
    const res = eng.resolveQuery(q);
    assert.equal(res.kind, 'roots', `${q} should resolve as roots`);
    const got = res.roots.map(id => [...eng.norm(eng.state.byId.get(id)[1])].join(' '));
    assert.ok(got.includes(expected), `${q} -> got [${got.join(', ')}], expected ${expected}`);
  }
  const kt = eng.resolveQuery('كتاتيب');
  assert.ok(kt.opt?.wikt?.length > 0, 'كتاتيب should match Wiktionary');
  const tn = eng.resolveQuery('التناوش');
  assert.equal(tn.opt?.retry?.word, 'تناوش', 'التناوش should retry without ال');
});

test('Curated particles & harf jarr distinguish function words from roots', () => {
  const cases = [
    ['إِنَّ', 'إِنَّ'],
    ['إنّ', 'إِنَّ'],
    ['أَنَّ', 'أَنَّ'],
    ['أَنْ', 'أَنْ'],
    ['إِنْ', 'إِنْ'],
    ['لِ', 'لِ'],
    ['لَ', 'لَ'],
    ['مِنْ', 'مِنْ'],
    ['مَنْ', 'مَنْ'],
    ['بِ', 'بِ'],
    ['ثُمَّ', 'ثُمَّ'],
    ['ثَمَّ', 'ثَمَّ'],
  ];
  for (const [q, expectedTop] of cases) {
    const res = eng.resolveQuery(q);
    assert.equal(res.opt?.particles?.[0]?.ar, expectedTop, `${q} should pin ${expectedTop} first`);
  }
  const unvoweled = eng.resolveQuery('ان');
  assert.ok(unvoweled.opt.particles.length >= 4, 'unvoweled ان returns all 4 particles');
  const sug = eng.suggestions('إِنَّ');
  assert.equal(sug[0][2], 'p');
  assert.equal(sug[0][1], 'إِنَّ');
});

test('Soft tashkeel prioritization promotes exact matches without breaking wrong tashkeel', () => {
  const trs = q => [...(eng.resolveQuery(q).opt?.exactHits || [])].map(id => eng.state.byId.get(id)?.[6]);

  assert.deepEqual(trs('عَلِمَ'), ['‘alima']);
  assert.deepEqual(trs('عِلْم'), ['‘ilm']);
  assert.deepEqual(trs('عَلَم'), ['‘alam']);
  // Partial tashkeel works
  assert.deepEqual(trs('عِلم'), ['‘ilm']);

  // Wrong tashkeel still returns full root results gracefully
  const wrong = eng.resolveQuery('عُلْم');
  assert.equal(wrong.kind, 'roots');
  assert.ok(wrong.roots.length > 0);
  assert.equal(wrong.opt.exactHits.size, 0);

  // Autocomplete puts exact tashkeel match #1
  const sug = eng.suggestions('عِلْم');
  assert.equal(sug[0][2], 'h');
  assert.equal(eng.state.byId.get(+sug[0][3])[6], '‘ilm');
});

test('A hamza typed with a prefix or ending keeps the headword with that hamza (مؤمن, not مأمن)', () => {
  const hits = q => [...(eng.resolveQuery(q).opt?.hits || [])].map(id => eng.state.byId.get(id)?.[6]);
  assert.deepEqual(hits('المؤمنين'), ['mu’min']);
  assert.deepEqual(hits('بالمؤمن'), ['mu’min']);
  assert.ok(hits('المكتبة').includes('maktaba'));              // no hamza typed: nothing is dropped
  assert.ok(hits('يؤمنون').length > 1);                         // the hamza moves in conjugation: nothing is dropped
  assert.equal(eng.hamzaFit('المؤمنين', 'مامن'), 'clash');
  assert.equal(eng.hamzaFit('المؤمنين', 'مؤمن'), 'same');
  assert.equal(eng.hamzaFit('المأمن', 'مامن'), '');
});
