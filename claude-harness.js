// Claude-Oriented Arabic Harness for Qamus Mobile (100% Client-Side BYOK)
// Security guarantees:
// - API key is stored ONLY in browser localStorage (or sessionStorage) on this device.
// - Never written to IndexedDB, never exported, never synced to any account or server.
// - Sent directly from this browser to https://api.anthropic.com via Anthropic's
//   official client-side BYOK header (`anthropic-dangerous-direct-browser-access: true`).

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';

const LS_KEY = 'qamus.mobile.anthropicKey.v1';
const LS_STORAGE_MODE = 'qamus.mobile.keyStorageMode.v1'; // 'device' | 'session'
const LS_AI_PREFS = 'qamus.mobile.aiPrefs.v1';
const LS_ANALYSIS_CACHE = 'qamus.mobile.analysisCache.v1';

export const MODEL_PRESETS = {
  haiku_fast: {
    id: 'haiku_fast',
    label: 'Haiku 5.5 · Fast',
    short: 'Haiku 5.5',
    model: 'claude-haiku-5-5',
    extra: { thinking: { type: 'disabled' } },
    maxTokens: 900,
    pin: 0.10,
    pout: 0.50,
    desc: '~1.5–2.5s · ultra-cheap (~$0.0002/tap)',
  },
  haiku_think: {
    id: 'haiku_think',
    label: 'Haiku 5.5 · Thinking',
    short: 'Haiku 5.5 (Think)',
    model: 'claude-haiku-5-5',
    extra: { output_config: { effort: 'low' } },
    maxTokens: 2200,
    pin: 0.10,
    pout: 0.50,
    desc: '~4–6s · light reasoning (~$0.0005/tap)',
  },
  sonnet_deep: {
    id: 'sonnet_deep',
    label: 'Sonnet 5.5 · Deep',
    short: 'Sonnet 5.5',
    model: 'claude-sonnet-5-5',
    extra: null, // computed per model ID: sonnet-5* uses thinking.type='between_tools', older uses 'disabled'
    maxTokens: 950,
    pin: 3.00,
    pout: 15.00,
    desc: '~2–3s · strongest classical iʿrāb (~$0.004/tap)',
  },
};

export const OCR_MODEL = 'claude-haiku-5-5';

// ---------- Device-Only Key Storage (Zero Account Sync) ----------
export function getKeyStorageMode() {
  try {
    return localStorage.getItem(LS_STORAGE_MODE) === 'session' ? 'session' : 'device';
  } catch {
    return 'device';
  }
}

export function setKeyStorageMode(mode) {
  const m = mode === 'session' ? 'session' : 'device';
  const existing = getApiKey();
  try {
    localStorage.setItem(LS_STORAGE_MODE, m);
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(LS_KEY);
    if (existing) {
      (m === 'session' ? sessionStorage : localStorage).setItem(LS_KEY, existing);
    }
  } catch {}
}

export function getApiKey() {
  try {
    return (sessionStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setApiKey(rawKey, mode = getKeyStorageMode()) {
  const clean = String(rawKey || '').trim();
  try {
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(LS_KEY);
    localStorage.setItem(LS_STORAGE_MODE, mode === 'session' ? 'session' : 'device');
    if (clean) {
      (mode === 'session' ? sessionStorage : localStorage).setItem(LS_KEY, clean);
    }
  } catch {}
}

export function clearApiKey() {
  try {
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(LS_KEY);
  } catch {}
}

export function hasApiKey() {
  return getApiKey().length > 10;
}

export function getAiPrefs() {
  const defaults = {
    preset: 'haiku_fast',
    autoAnalyze: true,
    sonnetModel: MODEL_PRESETS.sonnet_deep.model,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(LS_AI_PREFS) || 'null');
    if (saved && typeof saved === 'object') {
      const p = MODEL_PRESETS[saved.preset] ? saved.preset : defaults.preset;
      return {
        preset: p,
        autoAnalyze: saved.autoAnalyze !== false,
        sonnetModel: typeof saved.sonnetModel === 'string' && saved.sonnetModel.trim()
          ? saved.sonnetModel.trim()
          : defaults.sonnetModel,
      };
    }
  } catch {}
  return defaults;
}

export function saveAiPrefs(patch) {
  const next = { ...getAiPrefs(), ...patch };
  try { localStorage.setItem(LS_AI_PREFS, JSON.stringify(next)); } catch {}
  return next;
}

// ---------- Session Spend Meter (in-memory, never leaves device) ----------
export const sessionStats = {
  taps: 0,
  cacheHits: 0,
  scans: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  estCostUsd: 0,
};

function recordUsage(model, usage, kind = 'tap') {
  const inT = usage?.input_tokens || 0;
  const cwT = usage?.cache_creation_input_tokens || 0;
  const crT = usage?.cache_read_input_tokens || 0;
  const outT = usage?.output_tokens || 0;
  const isHaiku55 = String(model).includes('haiku-5-5');
  const pin = isHaiku55 ? 0.10 : (String(model).includes('haiku') ? 1.00 : 3.00);
  const pout = isHaiku55 ? 0.50 : (String(model).includes('haiku') ? 5.00 : 15.00);
  const cost =
    (inT / 1e6) * pin +
    (cwT / 1e6) * (pin * 1.25) +
    (crT / 1e6) * (pin * 0.10) +
    (outT / 1e6) * pout;

  if (kind === 'scan') sessionStats.scans += 1;
  else sessionStats.taps += 1;
  if (crT > 0) sessionStats.cacheHits += 1;
  sessionStats.inputTokens += inT;
  sessionStats.cacheWriteTokens += cwT;
  sessionStats.cacheReadTokens += crT;
  sessionStats.outputTokens += outT;
  sessionStats.estCostUsd += cost;
  return cost;
}

// ---------- Deterministic 0ms Footnote Extractor ----------
export function extractFootnotes(pageText) {
  if (!pageText) return '';
  const lines = String(pageText).split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (/^[\(\[（]?[٠-٩0-9]+[\)\]）]\s*\S/.test(s)) {
      out.push(s);
    }
  }
  return out.join('\n').slice(0, 1800);
}

// ---------- Printed-Harakat Helpers & Post-Validator ----------
const HARAKAT_RE = /[\u064B-\u065F\u0670]/g;
const stripHarakat = s => String(s || '').replace(HARAKAT_RE, '');

function hasPrintedPassivePattern(word) {
  // Detects explicit classical printed passive vowel pattern (damma followed by kasra, e.g. فلُدِغَ, نُشِطَ, يُؤْتَى)
  const s = String(word || '');
  return /\u064F[^\u064B-\u065F]*[\u0621-\u064A]\u0650/.test(s);
}

function splitArabicLetters(s) {
  // Splits an Arabic word into [{ base, marks }] pairs for letter-by-letter harakat alignment.
  const out = [];
  for (const ch of String(s || '')) {
    if (/[\u064B-\u065F\u0670]/.test(ch)) {
      if (out.length) out[out.length - 1].marks += ch;
    } else {
      out.push({ base: ch, marks: '' });
    }
  }
  return out;
}

function preservePrintedHarakat(modelVoc, sourceWord) {
  // Letter-by-letter printed-harakat fidelity: whenever the source text explicitly printed
  // diacritics on a letter (e.g. فلُدِغَ, نُشِطَ, مُغَلِّها), keep those printed harakat verbatim
  // while letting Claude fill in unvoweled letters — fixing slips like فُلِدِغَ -> فَلُدِغَ!
  if (!modelVoc || !sourceWord) return modelVoc || sourceWord || '';
  if (stripHarakat(modelVoc) !== stripHarakat(sourceWord)) return modelVoc;
  const srcL = splitArabicLetters(sourceWord);
  const modL = splitArabicLetters(modelVoc);
  if (srcL.length !== modL.length) return modelVoc;

  const merged = srcL.map((sl, i) => {
    let marks = sl.marks || modL[i].marks;
    // If prefix ف/و was unvoweled in source and letter 2 has explicit damma (فلُدِغَ),
    // prevent prefix drift from فَ to فُ.
    if (i === 0 && !sl.marks && (sl.base === 'ف' || sl.base === 'و') && srcL[1]?.marks.includes('\u064F') && marks === '\u064F') {
      marks = '\u064E';
    }
    return sl.base + marks;
  });
  return merged.join('');
}

export function anchorAnalysis(raw, sourceWord, meta = {}) {
  const voc = preservePrintedHarakat(raw.vocalized || sourceWord, sourceWord);
  const posEn = String(raw.posEnglish || '').trim();
  const posAr = String(raw.posArabic || '').trim();
  const role = String(raw.syntaxRole || '').trim();
  let ambiguityNote = raw.uncertaintyNote ? String(raw.uncertaintyNote).trim() : null;

  const isPassiveOutput =
    /passive|مجهول/i.test(`${posEn} ${posAr} ${role}`) ||
    (Array.isArray(raw.syntaxArguments) && raw.syntaxArguments.some(a => /deputy|نائب/i.test(String(a?.relation || ''))));

  // If printed ink explicitly carries passive harakat (فلُدِغَ / نُشِطَ) but model claimed active, warn cleanly.
  if (hasPrintedPassivePattern(sourceWord) && !isPassiveOutput && /verb|فعل/i.test(`${posEn} ${posAr}`)) {
    ambiguityNote = (ambiguityNote ? ambiguityNote + ' · ' : '') +
      'Printed harakat in the text indicate passive voice (مبني للمجهول); tap Deep (Sonnet) to double-check.';
  }

  return {
    vocalized: voc || sourceWord,
    diacritizedLine: String(raw.vocalizedClause || '').trim(),
    clauseTranslation: String(raw.clauseTranslation || '').trim(),
    root: raw.root ? String(raw.root).trim() : null,
    partOfSpeech: posEn,
    arabicTag: posAr,
    parseIndex: typeof raw.parseIndex === 'number' ? raw.parseIndex : null,
    meaningHere: String(raw.contextualMeaning || '').trim(),
    syntaxRole: role,
    actingOnIt: Array.isArray(raw.modifiersActingOnIt) ? raw.modifiersActingOnIt.filter(Boolean) : [],
    arguments: Array.isArray(raw.syntaxArguments) ? raw.syntaxArguments.filter(Boolean) : [],
    ambiguityNote,
    // Metadata for mobile badges
    provider: 'claude',
    modelId: meta.modelId || '',
    presetLabel: meta.presetLabel || '',
    wallSec: meta.wallSec || 0,
    cachedPrompt: !!meta.cachedPrompt,
    localCacheHit: !!meta.localCacheHit,
    estCostUsd: meta.estCostUsd || 0,
    morphVerified: typeof raw.parseIndex === 'number',
  };
}

// ---------- Cached System Prompt (Classical I'rab Guardrails + Mobile Concise Schema) ----------
export const CLAUDE_HARNESS_SYS = `You are Qamus Morpho-Syntax Analyzer, a rigorous classical & modern Arabic grammar and lexical analysis engine for mobile reading.

STRICT RULES:
1. Analyze ONLY the target word in its immediate Arabic passage, grounded in the page footnotes and retrieved dictionary entries. Never sermonize or pad prose.
2. Keep every English field mobile-crisp and concise:
   - \`contextualMeaning\`: 4–14 words max (exact sense here; if a page footnote defines this word, ALWAYS reflect that definition!).
   - \`syntaxRole\`: 3–10 words max, with Arabic term in parentheses.
   - \`syntaxArguments[].note\`: 4–14 words max (or null if obvious).
   - \`clauseTranslation\`: natural, concise English translation of the immediate clause.
3. PRINTED HARAKAT FIDELITY: Copy any explicit harakat printed on the target word verbatim into \`vocalized\` (e.g., if source prints \`فلُدِغَ\`, output \`فَلُدِغَ\` — NEVER alter prefix \`فَ\` to \`فُ\`). Explicit passive harakat (\`ُ...ِ\`) ALWAYS override unvoweled defaults; conversely, NEVER assume an unvoweled verb is passive unless clause syntax clearly requires it.
4. CLASSICAL I'RAB GUARDRAILS:
   - Passive verb (\`مبني للمجهول\`): its promoted subject is ALWAYS Deputy Subject (\`نائب فاعل\`), NEVER Direct Object (\`مفعول به\`).
   - Doubly-transitive passive verbs (\`آتى / أعطى / كسا / منح\`, e.g., \`وفضلُ اللهِ لا يُؤْتَاهُ عَاصٍ\`): the explicit nominative recipient (\`عاصٍ\`) is the Deputy Subject (\`نائب فاعل\`), and the attached pronoun referring to the given thing (\`ـهُ\` → \`فضلُ اللهِ\`) is the Second Object (\`مفعول به ثانٍ\`) — NEVER invert them!
   - Prepositional phrases (\`جار ومجرور\`, e.g., \`عَلَيْهِ\`, \`عَلَى العَمَلِ\`, \`مِنْ عِقَالٍ\`): label as \`Prepositional complement (متعلّق / جار ومجرور)\`, NEVER \`Direct Object (مفعول به)\`.
   - Negated fronted prepositional clauses (\`ما + شبه جملة + نكرة\`, e.g., \`وَمَا بِهِ قَلَبَةٌ\`): the delayed indefinite noun (\`قَلَبَةٌ\`) is NOMINATIVE (\`مبتدأ مؤخر مرفوع\`), NEVER accusative (\`اسم ما منصوب\`).
   - Exhortative/reproachful \`أَلَّا\` before a past verb (\`أَلَّا سَأَلُوا\`): \`حرف تحضيض وتوبيخ\` (not \`أَلَا + أَنْ\`).

OUTPUT FORMAT:
Return ONLY one valid JSON object (no markdown fences, no commentary) with these exact keys:
{"vocalized":string,"vocalizedClause":string,"clauseTranslation":string,"root":string|null,"posArabic":string,"posEnglish":string,"parseIndex":integer|null,"contextualMeaning":string,"syntaxRole":string,"modifiersActingOnIt":[{"particle":string,"role":string,"effect":string}],"syntaxArguments":[{"relation":string,"arabic":string,"note":string|null}],"uncertaintyNote":string|null}`;

const DIRECT_VISION_OCR_PROMPT = `Transcribe ALL Arabic text visible in this book page image verbatim, line by line.
STRICT RULES:
- Transcribe ONLY what is visibly printed in the image: keep exact spelling, hamzas, Qur'anic brackets ﴿...﴾, classical ligatures (ﷺ), and footnote numbers as plain (١), (٢).
- NEVER invent or add harakat/diacritics on letters that are printed unvoweled! ONLY include harakat/tashkeel that are visibly printed in the ink.
- For two-column poetry lines, keep each couplet on one line (first hemistich then second hemistich).
- Output ONLY the exact transcribed Arabic text (no explanations, no markdown fences, no commentary).`;

// ---------- Local LRU Analysis Cache (keyed by preset + page + word + occurrence) ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function loadCacheMap() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_ANALYSIS_CACHE) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveCacheMap(arr) {
  try {
    localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(arr.slice(0, 120)));
  } catch {}
}

function cacheKeyFor({ presetId, word, sentence, occurrence }) {
  return `${presetId}|${hashStr(sentence || '')}|${stripHarakat(word)}|${occurrence || 1}`;
}

export function getCachedAnalysis(params) {
  const k = cacheKeyFor(params);
  const found = loadCacheMap().find(x => x.k === k);
  return found ? { ...found.v, localCacheHit: true } : null;
}

function putCachedAnalysis(params, val) {
  const k = cacheKeyFor(params);
  const rest = loadCacheMap().filter(x => x.k !== k);
  rest.unshift({ k, t: Date.now(), v: val });
  saveCacheMap(rest);
}

export function clearAnalysisCache() {
  try { localStorage.removeItem(LS_ANALYSIS_CACHE); } catch {}
}

// ---------- Classical Lexicon Context Gatherer (feeds Hans Wehr + Lane + Mukhtar + Mufradat) ----------
const HTML_TAG_RE = /<[^>]+>/g;
const plainText = s => String(s || '').replace(HTML_TAG_RE, ' ').replace(/\s+/g, ' ').trim();

export async function gatherLexiconContext(model, word, loaders = {}) {
  const snippets = [];
  if (model?.answers?.length) {
    const hwLines = model.answers
      .slice(0, 3)
      .map(a => `${a.head || ''} (${a.label || 'Dict'}): ${plainText(a.html || a.gloss).slice(0, 200)}`)
      .filter(Boolean);
    if (hwLines.length) snippets.push(`[Qamus Lead Entries]: ${hwLines.join(' | ')}`);
  }

  // Pull Lane's Lexicon matching sub-entries if available
  const wordBare = stripHarakat(word);
  if (loaders.loadLaneEntries && model?.sources?.laneKeys?.length) {
    try {
      const k = model.sources.laneKeys[0];
      const entries = await loaders.loadLaneEntries(k);
      if (Array.isArray(entries) && entries.length) {
        const scored = entries.map(item => {
          const hwAr = stripHarakat(Array.isArray(item) ? item[0] : '');
          const body = plainText(Array.isArray(item) ? item[1] : item);
          const score = hwAr && (hwAr.includes(wordBare) || wordBare.endsWith(hwAr)) ? 2 : 0;
          return { score, hwAr, body };
        }).sort((a, b) => b.score - a.score);
        const laneTxt = scored.slice(0, 2).map(x => `${x.hwAr}: ${x.body.slice(0, 230)}`).join(' | ');
        if (laneTxt) snippets.push(`[Lane's Lexicon (${k})]: ${laneTxt.slice(0, 480)}`);
      }
    } catch {}
  }

  // Pull Mukhtar al-Sihah / al-Mufradat snippets
  if (loaders.arShard && model?.sources?.arKeys) {
    for (const dictId of ['mukhtar', 'mufradat']) {
      const keys = model.sources.arKeys[dictId];
      if (!keys?.length) continue;
      try {
        const shard = await loaders.arShard(dictId, keys[0]);
        const entries = shard?.[keys[0]];
        if (Array.isArray(entries) && entries.length) {
          const txt = plainText(entries.join(' ')).slice(0, 280);
          const label = dictId === 'mukhtar' ? 'Mukhtar al-Sihah' : 'al-Mufradat';
          if (txt) snippets.push(`[${label} (${keys[0]})]: ${txt}`);
        }
      } catch {}
    }
  }

  return snippets.length
    ? snippets.join('\n')
    : '(No dictionary entry loaded — rely strictly on passage + footnotes.)';
}

// ---------- Core Anthropic Browser Fetch ----------
async function anthropicFetch(apiKey, payload, signal) {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {}
    if (res.status === 401) msg = 'Invalid Anthropic API key (401). Check your key in Claude AI Settings.';
    else if (res.status === 429) msg = 'Rate limit reached (429). Wait a moment and retry.';
    throw new Error(msg);
  }
  return res.json();
}

export async function testApiKey(apiKey) {
  const key = String(apiKey || getApiKey()).trim();
  if (!key) throw new Error('Enter an Anthropic API key first.');
  const res = await fetch(MODELS_URL, {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); msg = d?.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  const ids = (data?.data || []).map(m => m.id);
  const latestSonnet = ids.find(id => /sonnet/i.test(id)) || MODEL_PRESETS.sonnet_deep.model;
  const hasHaiku55 = ids.some(id => id.includes('haiku-5-5'));
  saveAiPrefs({ sonnetModel: latestSonnet });
  return { ok: true, count: ids.length, latestSonnet, hasHaiku55 };
}

// ---------- Main Grammar-in-Context Entry Point ----------
export async function analyzeWordWithClaude({
  word,
  sentence,
  surrounding,
  occurrence = 1,
  pageText = '',
  model = null,
  loaders = {},
  presetOverride = null,
  force = false,
  signal = undefined,
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('NO_KEY');
  }
  const prefs = getAiPrefs();
  const presetId = presetOverride && MODEL_PRESETS[presetOverride] ? presetOverride : prefs.preset;
  const preset = MODEL_PRESETS[presetId] || MODEL_PRESETS.haiku_fast;
  const modelId = presetId === 'sonnet_deep' ? (prefs.sonnetModel || preset.model) : preset.model;

  if (!force) {
    const hit = getCachedAnalysis({ presetId, word, sentence, occurrence });
    if (hit) return hit;
  }

  const footnotes = extractFootnotes(pageText);
  const lexSnippet = await gatherLexiconContext(model, word, loaders);

  // Build Buckwalter morphological parse list from engine model
  const bwLines = (model?.parses || []).map((p, i) => {
    const segs = (p.segments || []).map(s => `${s.ar} (${s.role}: ${s.gloss})`).join(' + ');
    return `[${i}] ${segs}${p.root ? ` · Root: ${p.root}` : ''}`;
  });
  const bwBlock = bwLines.length
    ? bwLines.join('\n')
    : '(None in Buckwalter table — determine morphology directly from context + dictionary.)';

  // Cached Page Context Block (reused across taps on the same page via Anthropic Prompt Caching!)
  const pageBlockParts = [];
  if (pageText && pageText.trim().length > 40) {
    pageBlockParts.push(`Current Page Text:\n${pageText.trim().slice(0, 6000)}`);
  }
  if (footnotes) {
    pageBlockParts.push(`Extracted Page Footnotes (authoritative lexical/editorial glosses):\n${footnotes}`);
  }
  const pageContextBlock = pageBlockParts.join('\n\n') || `Immediate Passage:\n${surrounding || sentence}`;

  const occNote = occurrence > 1 ? ` (specifically occurrence #${occurrence} in this line)` : '';
  const wordPrompt =
    `Immediate Passage:\n${surrounding || sentence}\n\n` +
    `Target Line:\n${sentence}\n\n` +
    `Target Word: ${word}${occNote}\n\n` +
    `Buckwalter Parses (pick index in \`parseIndex\`, or null if none fits):\n${bwBlock}\n\n` +
    `Retrieved Qamus Dictionary Entries:\n${lexSnippet}\n\n` +
    `Return the concise JSON analysis for "${word}" in the Target Line.`;

  // Sonnet 5 / 5.5 require thinking.type = 'between_tools' to disable pre-response thinking,
  // whereas Haiku 5.5 and Sonnet 4.x accept 'disabled'.
  const thinkingExtra = preset.extra
    ? preset.extra
    : (/sonnet-5/i.test(modelId)
      ? { thinking: { type: 'between_tools' } }
      : { thinking: { type: 'disabled' } });

  const payload = {
    model: modelId,
    max_tokens: preset.maxTokens,
    system: [
      {
        type: 'text',
        text: CLAUDE_HARNESS_SYS,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: pageContextBlock,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: wordPrompt,
          },
        ],
      },
    ],
    ...thinkingExtra,
  };

  const t0 = performance.now();
  const data = await anthropicFetch(apiKey, payload, signal);
  const wallSec = Math.round((performance.now() - t0) / 10) / 100;
  const cost = recordUsage(modelId, data.usage, 'tap');

  const rawText = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('')
    .trim();

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude returned an unexpected non-JSON response. Tap Re-run to retry.');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not parse grammar JSON. Tap Re-run to retry.');
  }

  const analysis = anchorAnalysis(parsed, word, {
    modelId: data.model || modelId,
    presetLabel: preset.short,
    wallSec,
    cachedPrompt: (data.usage?.cache_read_input_tokens || 0) > 0,
    estCostUsd: cost,
  });

  putCachedAnalysis({ presetId, word, sentence, occurrence }, analysis);
  return analysis;
}

// ---------- Direct Vision OCR (Camera Photo / Screenshot / PDF Page -> Haiku 5.5) ----------
export async function compressImageToJpeg(fileOrBlob, maxDim = 1650, quality = 0.86) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not decode image.'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    return { base64, mediaType: 'image/jpeg', dataUrl, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanImageWithClaude({ base64, mediaType = 'image/jpeg', signal = undefined }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const payload = {
    model: OCR_MODEL,
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: 'text',
            text: DIRECT_VISION_OCR_PROMPT,
          },
        ],
      },
    ],
  };

  const t0 = performance.now();
  const data = await anthropicFetch(apiKey, payload, signal);
  const wallSec = Math.round((performance.now() - t0) / 10) / 100;
  const cost = recordUsage(OCR_MODEL, data.usage, 'scan');

  const rawText = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('')
    .trim();

  const clean = rawText.replace(/^```(?:arabic|markdown|text)?\s*|\s*```$/g, '').trim();
  if (!clean) throw new Error('No Arabic text was detected in this image.');
  return { text: clean, wallSec, estCostUsd: cost, modelId: data.model || OCR_MODEL };
}
