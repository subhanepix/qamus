'use strict';
/* Vocab: saved words (cards) and folders — save sheet, vocab/folder views, CSV/JSON import & export.
 * Classic script loaded after app.js; uses its globals (Store, esc, norm, plain, go, sheet, byId, HW, W, …). */

const INBOX = 'f_inbox';
const CARD_SOURCES = ['hw', 'wikt', 'lane', 'lexicon', 'custom'];
const CSV_FIELDS = ['word', 'gloss', 'arGloss', 'root', 'translit', 'context', 'note', 'tags'];   // SPEC §5 column order
const TEXT_FIELDS = ['word', 'gloss', 'arGloss', 'root', 'translit', 'context', 'highlight', 'note'];
const MAX_TXT = 2048, MAX_CARDS = 5000, MAX_BYTES = 1000000;
const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.48.24L12 16l-6.02 4.44a.3.3 0 0 1-.48-.24V4a.5.5 0 0 1 .5-.5z"/></svg>';

// ---------- small helpers ----------
function uid(prefix) {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return prefix + '_' + Date.now().toString(36) + [...a].map(b => (b % 36).toString(36)).join('');
}
const clip = (s, n = MAX_TXT) => String(s ?? '').slice(0, n);
const cleanTags = t => [...new Set((Array.isArray(t) ? t : String(t ?? '').split(/[\s,;]+/))
  .map(x => String(x).trim().slice(0, 64)).filter(Boolean))].slice(0, 50);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// Hans Wehr glosses often open with plural/collective forms ("pl. كتب kutub, -āt piece of writing…"); skip them.
function stripGrammar(s) {
  const AR = '[\\u0600-\\u06FF\\u064B-\\u0652]+';
  const lead = new RegExp(`^(?:(?:pl\\.|coll\\.|n\\. un\\.|f\\.|dual)\\s*)?(?:${AR}(?:\\s+${AR})*\\s+[^\\s,;]+|-[^\\s,;]+)\\s*(?:[,;]\\s*|\\s+)`);
  if (!/^(pl\.|coll\.|n\. un\.|f\.|dual)\s/.test(s)) return s;
  for (let i = 0; i < 5; i++) {
    const m = s.match(lead);
    if (!m || m[0].length >= s.length) break;
    s = s.slice(m[0].length);
  }
  return s;
}
function shortGloss(s, n = 120) {
  s = stripGrammar(plain(String(s || '')));
  const semi = s.indexOf(';');
  if (semi > 0 && semi <= n) s = s.slice(0, semi);
  if (s.length > n) {
    const cut = s.lastIndexOf(' ', n);
    s = s.slice(0, cut > n * 0.6 ? cut : n).replace(/[\s,;:.(–-]+$/, '') + '…';
  }
  return s.trim();
}
const lsGetV = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSetV = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------- model (reads) ----------
const vdoc = () => Store.doc;
const liveFolders = () => vdoc().folders.filter(f => !f.deleted);
const liveCards = () => vdoc().cards.filter(c => !c.deleted);
const VIRTUAL_INBOX = { id: INBOX, name: 'Inbox', parent: null, virtual: true };
function folderById(id) {
  return vdoc().folders.find(f => f.id === id && !f.deleted) || (id === INBOX ? VIRTUAL_INBOX : null);
}
const parentOf = f => (f.parent && f.parent !== f.id && folderById(f.parent) ? f.parent : null);
const cardFolder = c => (folderById(c.folder) ? c.folder : INBOX);   // orphans show in Inbox
const byFolderName = (a, b) => (a.id === INBOX ? -1 : b.id === INBOX ? 1 : a.name.localeCompare(b.name, ['ar', 'en']));
function allFolders() {   // live folders plus a virtual Inbox when cards need one
  const fs = liveFolders();
  if (!fs.some(f => f.id === INBOX) && liveCards().some(c => cardFolder(c) === INBOX)) fs.push(VIRTUAL_INBOX);
  return fs;
}
function childrenOf(id) { return allFolders().filter(f => parentOf(f) === (id || null)).sort(byFolderName); }
function tree() {   // depth-first [{ f, depth }], cycle-safe
  const out = [], seen = new Set();
  const walk = (id, depth) => {
    for (const f of childrenOf(id)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
function descendants(id) {
  const out = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const f of allFolders()) if (parentOf(f) === cur && !out.has(f.id) && f.id !== id) { out.add(f.id); stack.push(f.id); }
  }
  return out;
}
function folderPathList(id) {
  const out = [], seen = new Set();
  let f = folderById(id);
  while (f && !seen.has(f.id)) { seen.add(f.id); out.unshift(f); f = parentOf(f) ? folderById(f.parent) : null; }
  return out;
}
const folderPath = id => folderPathList(id).map(f => f.name).join(' / ');
const cardsIn = id => liveCards().filter(c => cardFolder(c) === id);
function cardsDeep(id) { const ids = new Set([id, ...descendants(id)]); return liveCards().filter(c => ids.has(cardFolder(c))); }

// Review status — step 5 (SRS) writes `reviews`; a card with no review yet is "new".
// Due dates sit on local midnight, so "due" means due by the end of today.
const dayStart = (t, add = 0) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); };
const endOfDay = (t, add = 0) => dayStart(t, add + 1) - 1;
function cardStatus(card, now = Date.now()) {
  const r = vdoc().reviews[card.id];
  if (!r || !r.last) return { k: 'new', label: 'New' };   // never reviewed (a browse mark alone doesn't count)
  if (r.due <= endOfDay(now)) return { k: 'due', label: 'Due' };
  const d = Math.max(1, Math.round((dayStart(r.due) - dayStart(now)) / 86400000));
  return { k: 'later', label: `in ${d}d` };
}
const dueCount = cards => cards.filter(c => cardStatus(c).k !== 'later').length;

let sidxDoc = null, sidx = new Map();
function savedIndex() {   // "source|ref" -> live cards saved from that dictionary row
  if (sidxDoc !== vdoc()) {
    sidxDoc = vdoc(); sidx = new Map();
    for (const c of liveCards()) {
      if (!c.source || c.source === 'custom' || !c.ref) continue;
      const k = c.source + '|' + c.ref;
      if (!sidx.has(k)) sidx.set(k, []);
      sidx.get(k).push(c);
    }
  }
  return sidx;
}
function lastFolder() { const id = lsGetV('qamus.lastFolder'); return id && folderById(id) ? id : INBOX; }

// ---------- model (writes) ----------
function ensureInbox(d) {
  if (d.folders.some(f => f.id === INBOX && !f.deleted)) return;
  const now = Date.now();
  const inbox = { id: INBOX, name: 'Inbox', parent: null, createdAt: now, updatedAt: now, deleted: false };
  const i = d.folders.findIndex(f => f.id === INBOX);
  if (i >= 0) d.folders[i] = inbox; else d.folders.push(inbox);
}
function newFolderRec(name, parent, now) {
  return { id: uid('f'), name: clip(name, 100).trim(), parent: parent || null, createdAt: now, updatedAt: now, deleted: false };
}
function cardRec(fields, folder, now) {
  const c = { id: uid('c'), folder };
  for (const k of TEXT_FIELDS) c[k] = clip(fields[k]).trim();
  c.key = clip(norm(c.word));
  c.source = CARD_SOURCES.includes(fields.source) ? fields.source : 'custom';
  c.ref = c.source === 'custom' ? '' : clip(fields.ref, 200);
  c.tags = cleanTags(fields.tags);
  c.createdAt = now; c.updatedAt = now; c.deleted = false;
  return c;
}
const tombstone = (c, now) => ({ id: c.id, folder: c.folder, word: '', updatedAt: now, deleted: true });

function addCard(fields, folder, newFolderName) {
  let id;
  Store.mutate(d => {
    const now = Date.now();
    ensureInbox(d);
    if (newFolderName) { const f = newFolderRec(newFolderName, null, now); d.folders.push(f); folder = f.id; }
    const c = cardRec(fields, folder || INBOX, now);
    d.cards.push(c);
    id = c.id;
  });
  lsSetV('qamus.lastFolder', folder || INBOX);
  return id;
}
function updateCard(id, patch, newFolderName) {
  Store.mutate(d => {
    const now = Date.now();
    const c = d.cards.find(x => x.id === id && !x.deleted);
    if (!c) return;
    if (newFolderName) { const f = newFolderRec(newFolderName, null, now); d.folders.push(f); patch = { ...patch, folder: f.id }; }
    for (const k of TEXT_FIELDS) if (k in patch) c[k] = clip(patch[k]).trim();
    if ('tags' in patch) c.tags = cleanTags(patch.tags);
    if (patch.folder) { if (patch.folder === INBOX) ensureInbox(d); c.folder = patch.folder; }
    c.key = clip(norm(c.word));
    c.updatedAt = now;
  });
}
function moveCards(ids, folder) {
  const set = new Set(ids);
  Store.mutate(d => {
    const now = Date.now();
    if (folder === INBOX) ensureInbox(d);
    for (const c of d.cards) if (set.has(c.id) && !c.deleted) { c.folder = folder; c.updatedAt = now; }
  });
}
function deleteCards(ids) {
  const set = new Set(ids);
  Store.mutate(d => {
    const now = Date.now();
    d.cards = d.cards.map(c => (set.has(c.id) && !c.deleted ? tombstone(c, now) : c));
    for (const id of set) delete d.reviews[id];
  });
}
function createFolder(name, parent) {
  let id;
  Store.mutate(d => {
    const f = newFolderRec(name, parent, Date.now());
    if (parent === INBOX) ensureInbox(d);
    d.folders.push(f);
    id = f.id;
  });
  return id;
}
function renameFolder(id, name) {
  Store.mutate(d => {
    if (id === INBOX) ensureInbox(d);
    const f = d.folders.find(x => x.id === id && !x.deleted);
    if (f) { f.name = clip(name, 100).trim(); f.updatedAt = Date.now(); }
  });
}
function moveFolder(id, parent) {
  if (parent && (parent === id || descendants(id).has(parent))) return false;
  Store.mutate(d => {
    if (id === INBOX || parent === INBOX) ensureInbox(d);
    const f = d.folders.find(x => x.id === id && !x.deleted);
    if (f) { f.parent = parent || null; f.updatedAt = Date.now(); }
  });
  return true;
}
function deleteFolder(id, mode) {   // mode: 'inbox' (move its cards) | 'delete' (delete its cards); sub-folders go too
  if (id === INBOX) return;
  const ids = new Set([id, ...descendants(id)]);
  ids.delete(INBOX);
  Store.mutate(d => {
    const now = Date.now();
    if (mode === 'inbox') ensureInbox(d);
    d.folders = d.folders.map(f => (ids.has(f.id) && !f.deleted
      ? { id: f.id, name: '', parent: null, createdAt: f.createdAt || 0, updatedAt: now, deleted: true } : f));
    d.cards = d.cards.map(c => {
      if (c.deleted || !ids.has(c.folder)) return c;
      if (mode === 'inbox') return { ...c, folder: INBOX, updatedAt: now };
      delete d.reviews[c.id];
      return tombstone(c, now);
    });
  });
}

// ---------- bookmarks in dictionary results ----------
function saveBtn(payload, word) {
  return `<button type="button" class="save-btn" data-save="${esc(JSON.stringify(payload))}" data-word="${esc(word)}" aria-pressed="false" aria-label="Save ${esc(word)}" title="Save to vocab">${BOOKMARK}</button>`;
}
function markSaved(root) {
  const idx = savedIndex();
  for (const b of root.querySelectorAll('.save-btn')) {
    let p; try { p = JSON.parse(b.dataset.save); } catch { continue; }
    const on = idx.has(p.s + '|' + p.r);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Saved: ' : 'Save ') + b.dataset.word);
    b.title = on ? 'Saved — tap to see where' : 'Save to vocab';
  }
}
// Fill a new card's fields from the dictionary row it was saved from.
async function prefill(p) {
  const f = { word: '', gloss: '', arGloss: '', root: '', translit: '', context: '', highlight: '', note: '', tags: [], source: p.s, ref: String(p.r ?? '') };
  const rootOf = rid => { const r = byId.get(rid); return r ? [...r[1]].join(' ') : ''; };
  if (p.s === 'hw' && /^f\d+$/.test(f.ref)) {
    const x = HW.forms[+f.ref.slice(1)];
    f.word = x[2]; f.gloss = shortGloss(x[3]); f.root = rootOf(x[0]);
  } else if (p.s === 'hw') {
    const e = byId.get(+f.ref);
    let d = plain(stripHead(e));
    if (e[6] && d.startsWith(e[6])) d = d.slice(e[6].length).trim();
    f.word = e[1]; f.gloss = shortGloss(d); f.root = rootOf(e[4]); f.translit = e[6] || '';
  } else if (p.s === 'wikt') {
    const e = W.entries[+f.ref];
    const m = e[2].match(/<li>([\s\S]*?)<\/li>/);
    const rs = wRoots(+f.ref);
    f.word = e[0]; f.translit = e[1] || ''; f.gloss = shortGloss(m ? m[1] : e[2]); f.root = rs.length ? rootOf(rs[0]) : '';
  } else if (p.s === 'lane') {
    const at = f.ref.lastIndexOf(':'), k = f.ref.slice(0, at), i = +f.ref.slice(at + 1);
    const name = k.codePointAt(0).toString(16).padStart(4, '0') + '.json';
    const shard = await laneShards.get(name);
    const [w, def] = shard[k][i];
    f.word = w; f.root = [...k].join(' ');
    f.gloss = shortGloss(def.startsWith(w) ? def.slice(w.length) : def);
  } else if (p.s === 'lexicon') {
    f.word = p.w || ''; f.gloss = shortGloss(p.g || ''); f.root = p.root || '';
  }
  return f;
}
async function onSaveClick(btn) {
  let p; try { p = JSON.parse(btn.dataset.save); } catch { return; }
  const word = btn.dataset.word;
  if (savedIndex().has(p.s + '|' + p.r)) return savedSheet(p, word);
  let fields;
  try { fields = await prefill(p); } catch { fields = { word, source: p.s, ref: String(p.r ?? '') }; }
  cardSheet({ mode: 'save', fields });
}
function openCard(c) {   // the card's dictionary entry, else a normal search
  const r = c.ref || '';
  if (c.source === 'hw' && /^\d+$/.test(r) && (!HW || byId.has(+r))) go({ e: r, q: c.word });
  else if (c.source === 'hw' && /^f\d+$/.test(r) && (!HW || HW.forms[+r.slice(1)])) go({ f: r.slice(1), q: c.word });
  else if (c.source === 'wikt' && /^\d+$/.test(r) && (!W || W.entries[+r])) go({ w: r, q: c.word });
  else if (c.source === 'lane' && r.includes(':')) { const q = [...r.slice(0, r.lastIndexOf(':'))].join(' '); qEl.value = q; go({ q }); }
  else { qEl.value = c.word; go({ q: c.word }); }
}

// ---------- sheets ----------
function folderOptions(selected, { exclude = new Set(), top = false } = {}) {
  const rows = tree().filter(({ f }) => !exclude.has(f.id));
  if (!rows.some(({ f }) => f.id === INBOX) && !exclude.has(INBOX)) rows.unshift({ f: VIRTUAL_INBOX, depth: 0 });
  return (top ? `<option value="">Top level</option>` : '') +
    rows.map(({ f, depth }) => `<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${' '.repeat(depth)}${esc(f.name)}</option>`).join('');
}

function cardSheet({ mode, fields = {}, card = null, folder = null }) {
  const f = { word: '', gloss: '', arGloss: '', root: '', translit: '', context: '', highlight: '', note: '', tags: [], source: 'custom', ref: '', ...fields, ...(card || {}) };
  const startFolder = card ? cardFolder(card) : folder || lastFolder();
  const moreOpen = !!(f.arGloss || f.highlight || (f.tags && f.tags.length) || mode === 'add');
  const title = { save: 'Save word', add: 'Add card', edit: 'Edit card' }[mode];
  const meta = [f.root && `root <span lang="ar">${esc(f.root)}</span>`, f.translit && `<i>${esc(f.translit)}</i>`].filter(Boolean).join(' · ');
  sheet({
    title,
    body: `<form class="card-form" novalidate>
      ${mode === 'save'
        ? `<div class="cf-head"><span class="cf-word" lang="ar">${esc(f.word)}</span>${meta ? `<span class="muted cf-meta">${meta}</span>` : ''}</div>`
        : `<label class="lbl" for="cf-word">Word</label><input id="cf-word" class="inp ar-inp" lang="ar" dir="rtl" value="${esc(f.word)}" autocomplete="off" ${mode === 'add' ? 'autofocus' : ''}>`}
      <label class="lbl" for="cf-folder">Folder</label>
      <div class="field-row"><select id="cf-folder" class="inp">${folderOptions(startFolder)}</select>
        <button type="button" class="btn" id="cf-newf">New folder</button></div>
      <div class="field-row cf-newf-row" id="cf-newf-row" hidden>
        <input id="cf-newf-name" class="inp" dir="auto" placeholder="New folder name" aria-label="New folder name" maxlength="100">
        <button type="button" class="btn quiet" id="cf-newf-x">Cancel</button></div>
      <p class="form-msg" id="cf-msg" role="status" aria-live="polite"></p>
      <label class="lbl" for="cf-gloss">Meaning</label>
      <textarea id="cf-gloss" class="inp" rows="2" dir="auto" ${mode === 'save' ? 'autofocus' : ''}>${esc(f.gloss)}</textarea>
      <label class="lbl" for="cf-context">Context <span class="opt">optional</span></label>
      <textarea id="cf-context" class="inp" rows="2" dir="auto" placeholder="The sentence or verse it came from">${esc(f.context)}</textarea>
      <label class="lbl" for="cf-note">Note <span class="opt">optional</span></label>
      <textarea id="cf-note" class="inp" rows="2" dir="auto">${esc(f.note)}</textarea>
      <details class="cf-more" ${moreOpen ? 'open' : ''}><summary>More fields</summary>
        <label class="lbl" for="cf-argloss">Arabic explanation</label>
        <textarea id="cf-argloss" class="inp" rows="2" lang="ar" dir="rtl">${esc(f.arGloss)}</textarea>
        <label class="lbl" for="cf-highlight">Phrase to highlight in the context</label>
        <input id="cf-highlight" class="inp" dir="auto" value="${esc(f.highlight)}">
        <label class="lbl" for="cf-translit">Transliteration</label>
        <input id="cf-translit" class="inp" value="${esc(f.translit)}" autocapitalize="off">
        <label class="lbl" for="cf-root">Root</label>
        <input id="cf-root" class="inp" lang="ar" dir="rtl" value="${esc(f.root)}" placeholder="ك ت ب">
        <label class="lbl" for="cf-tags">Tags</label>
        <input id="cf-tags" class="inp" dir="auto" value="${esc((f.tags || []).join(' '))}" placeholder="noun lesson-3" autocapitalize="off">
      </details>
      <div class="actions">
        <button type="submit" class="btn primary" id="cf-save">Save</button>
        <button type="button" class="btn quiet" id="cf-cancel">Cancel</button>
        ${mode === 'edit' ? '<button type="button" class="btn quiet danger-text" id="cf-del">Delete card</button>' : ''}
      </div>
      ${mode === 'edit' ? `<div class="confirm" id="cf-del-confirm" hidden><p>Delete this card?</p>
        <div class="actions"><button type="button" class="btn danger" id="cf-del-yes">Delete</button>
        <button type="button" class="btn quiet" id="cf-del-no">Cancel</button></div></div>` : ''}
    </form>`,
    onMount(p, api) {
      const $p = s => p.querySelector(s);
      const form = $p('form'), sel = $p('#cf-folder'), msg = $p('#cf-msg'), saveB = $p('#cf-save');
      const newRow = $p('#cf-newf-row'), newName = $p('#cf-newf-name');
      const word = () => (mode === 'save' ? f.word : $p('#cf-word').value.trim());
      const say = (t, err) => { msg.innerHTML = t; msg.classList.toggle('err', !!err); };
      const checkDup = () => {
        say('');
        saveB.textContent = 'Save';
        if (!newRow.hidden && newName.value.trim()) return;
        const k = norm(word());
        if (!k) return;
        const dup = cardsIn(sel.value).find(c => c.key === k && c.id !== card?.id);
        if (dup) {
          say(`Already in <b>${esc(folderPath(sel.value))}</b>${dup.gloss ? ` as “${esc(shortGloss(dup.gloss, 60))}”` : ''}.`);
          saveB.textContent = 'Save anyway';
        }
      };
      sel.addEventListener('change', checkDup);
      $p('#cf-word')?.addEventListener('input', checkDup);
      newName.addEventListener('input', checkDup);
      $p('#cf-newf').addEventListener('click', () => { newRow.hidden = false; sel.disabled = true; $p('#cf-newf').hidden = true; newName.focus(); checkDup(); });
      $p('#cf-newf-x').addEventListener('click', () => { newRow.hidden = true; sel.disabled = false; newName.value = ''; $p('#cf-newf').hidden = false; sel.focus(); checkDup(); });
      $p('#cf-cancel').addEventListener('click', () => api.close());
      if (mode === 'edit') {
        const conf = $p('#cf-del-confirm');
        $p('#cf-del').addEventListener('click', () => { conf.hidden = false; $p('#cf-del-no').focus(); });
        $p('#cf-del-no').addEventListener('click', () => { conf.hidden = true; $p('#cf-del').focus(); });
        $p('#cf-del-yes').addEventListener('click', () => { deleteCards([card.id]); api.close(); });
      }
      form.addEventListener('submit', e => {
        e.preventDefault();
        const w = word();
        if (!w) { say('Enter the word.', true); $p('#cf-word')?.focus(); return; }
        const nf = !newRow.hidden ? newName.value.trim() : '';
        if (!newRow.hidden && !nf) { say('Name the new folder, or cancel it.', true); newName.focus(); return; }
        const vals = {
          word: w, gloss: $p('#cf-gloss').value, context: $p('#cf-context').value, note: $p('#cf-note').value,
          arGloss: $p('#cf-argloss').value, highlight: $p('#cf-highlight').value, translit: $p('#cf-translit').value,
          root: $p('#cf-root').value, tags: $p('#cf-tags').value, source: f.source, ref: f.ref,
        };
        try {
          if (mode === 'edit') updateCard(card.id, { ...vals, folder: nf ? undefined : sel.value }, nf);
          else addCard(vals, sel.value, nf);
        } catch (err) { say('Couldn’t save: ' + esc(err.message || String(err)), true); return; }
        api.close();
      });
      checkDup();
    },
  });
}

function savedSheet(payload, word) {
  const key = payload.s + '|' + payload.r;
  sheet({
    title: 'Saved',
    body: `<p class="cf-word" lang="ar">${esc(word)}</p><ul class="saved-list" id="sv-list"></ul>
      <div class="actions"><button type="button" class="btn primary" id="sv-another">Save to another folder</button>
      <button type="button" class="btn quiet" id="sv-done">Done</button></div>`,
    onMount(p, api) {
      const list = p.querySelector('#sv-list');
      const render = () => {
        const cards = savedIndex().get(key) || [];
        if (!cards.length) { api.close(); return; }
        list.innerHTML = cards.map(c => `<li><span>In <b>${esc(folderPath(cardFolder(c)))}</b></span>
          <button type="button" class="btn" data-unsave="${esc(c.id)}" aria-label="Remove from ${esc(folderPath(cardFolder(c)))}">Remove</button></li>`).join('');
      };
      render();
      list.addEventListener('click', e => {
        const b = e.target.closest('[data-unsave]');
        if (!b) return;
        deleteCards([b.dataset.unsave]);
        render();
        p.querySelector('[data-unsave], #sv-another')?.focus();
      });
      p.querySelector('#sv-done').addEventListener('click', () => api.close());
      p.querySelector('#sv-another').addEventListener('click', async () => {
        api.close();
        let fields;
        try { fields = await prefill(payload); } catch { fields = { word, source: payload.s, ref: String(payload.r) }; }
        cardSheet({ mode: 'save', fields });
      });
    },
  });
}

function newFolderSheet(parent = null) {
  sheet({
    title: 'New folder',
    body: `<form novalidate><label class="lbl" for="nf-name">Name</label>
      <input id="nf-name" class="inp" dir="auto" maxlength="100" autofocus>
      <label class="lbl" for="nf-parent">Inside</label>
      <select id="nf-parent" class="inp">${folderOptions(parent || '', { top: true })}</select>
      <p class="form-msg" id="nf-msg" role="status"></p>
      <div class="actions"><button type="submit" class="btn primary">Create</button>
      <button type="button" class="btn quiet" id="nf-cancel">Cancel</button></div></form>`,
    onMount(p, api) {
      p.querySelector('#nf-cancel').addEventListener('click', () => api.close());
      p.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const name = p.querySelector('#nf-name').value.trim();
        if (!name) { const m = p.querySelector('#nf-msg'); m.textContent = 'Enter a name.'; m.classList.add('err'); return; }
        createFolder(name, p.querySelector('#nf-parent').value || null);
        api.close();
      });
    },
  });
}

function folderActionsSheet(id) {
  const f = folderById(id);
  if (!f) return;
  const subs = descendants(id), cards = cardsDeep(id).length;
  const exclude = new Set([id, ...subs]);
  sheet({
    title: 'Folder',
    body: `<label class="lbl" for="fa-name">Name</label>
      <div class="field-row"><input id="fa-name" class="inp" dir="auto" maxlength="100" value="${esc(f.name)}">
        <button type="button" class="btn" id="fa-rename">Rename</button></div>
      <label class="lbl" for="fa-parent">Inside</label>
      <div class="field-row"><select id="fa-parent" class="inp">${folderOptions(parentOf(f) || '', { exclude, top: true })}</select>
        <button type="button" class="btn" id="fa-move">Move</button></div>
      <p class="form-msg" id="fa-msg" role="status" aria-live="polite"></p>
      <div class="actions">
        <button type="button" class="btn" id="fa-open">Open</button>
        <button type="button" class="btn" id="fa-sub">New sub-folder</button>
        ${id !== INBOX ? '<button type="button" class="btn quiet danger-text" id="fa-del">Delete folder…</button>' : ''}
      </div>
      ${id !== INBOX ? `<div class="confirm" id="fa-confirm" hidden>
        <p>Delete “${esc(f.name)}”${subs.size ? ` and its ${plural(subs.size, 'sub-folder')}` : ''}?${cards ? ` It holds ${plural(cards, 'card')}.` : ''}</p>
        <div class="actions col">
          ${cards ? `<button type="button" class="btn" id="fa-del-inbox">Delete folder, move ${plural(cards, 'card')} to Inbox</button>
          <button type="button" class="btn danger" id="fa-del-cards">Delete folder and ${plural(cards, 'card')}</button>`
          : '<button type="button" class="btn danger" id="fa-del-cards">Delete folder</button>'}
          <button type="button" class="btn quiet" id="fa-del-no">Cancel</button>
        </div></div>` : ''}`,
    onMount(p, api) {
      const $p = s => p.querySelector(s), msg = $p('#fa-msg');
      const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', !!err); };
      const rename = () => {
        const name = $p('#fa-name').value.trim();
        if (!name) return say('Enter a name.', true);
        renameFolder(id, name); say('Renamed.');
      };
      $p('#fa-rename').addEventListener('click', rename);
      $p('#fa-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
      $p('#fa-move').addEventListener('click', () => {
        const ok = moveFolder(id, $p('#fa-parent').value || null);
        say(ok ? 'Moved.' : 'A folder can’t go inside itself.', !ok);
      });
      $p('#fa-open').addEventListener('click', () => { api.close(); go('folder=' + id); });
      $p('#fa-sub').addEventListener('click', () => { api.close(); newFolderSheet(id); });
      if (id === INBOX) return;
      const conf = $p('#fa-confirm');
      $p('#fa-del').addEventListener('click', () => { conf.hidden = false; $p('#fa-del-no').focus(); });
      $p('#fa-del-no').addEventListener('click', () => { conf.hidden = true; $p('#fa-del').focus(); });
      const del = mode => {
        const inside = view === 'folder' && exclude.has(vf.folder);
        deleteFolder(id, mode);
        api.close();
        if (inside) go('vocab');
      };
      $p('#fa-del-inbox')?.addEventListener('click', () => del('inbox'));
      $p('#fa-del-cards').addEventListener('click', () => del('delete'));
    },
  });
}

function moveSheet(ids, from) {
  sheet({
    title: `Move ${plural(ids.length, 'card')}`,
    body: `<label class="lbl" for="mv-folder">To folder</label>
      <select id="mv-folder" class="inp">${folderOptions(from === INBOX ? '' : INBOX)}</select>
      <div class="actions"><button type="button" class="btn primary" id="mv-go">Move</button>
      <button type="button" class="btn quiet" id="mv-cancel">Cancel</button></div>`,
    onMount(p, api) {
      p.querySelector('#mv-cancel').addEventListener('click', () => api.close());
      p.querySelector('#mv-go').addEventListener('click', () => {
        vf.picked.clear(); vf.select = false; vf.confirmDel = false;
        moveCards(ids, p.querySelector('#mv-folder').value);
        api.close();
      });
    },
  });
}

// ---------- views ----------
let vf = { folder: null, filter: '', select: false, picked: new Set(), confirmDel: false };

function vocabLink() {
  const cards = liveCards();
  const due = dueCount(cards);
  return `<button type="button" class="vocab-link" data-go="vocab"><span class="vl-title">Vocab</span>
    <span class="vl-meta">${cards.length ? `${plural(cards.length, 'word')}${due ? ` · ${due} to study` : ''}` : 'Save words with the bookmark'}</span><span aria-hidden="true">›</span></button>`;
}
function folderRowHtml(f, depth = 0, selectable = false) {
  const cards = cardsDeep(f.id), due = dueCount(cards), picked = selectable && vsel.picked.has(f.id);
  const meta = `<span class="fr-meta">${plural(cards.length, 'card')}${due ? ` · <b>${due} due</b>` : ''}</span>`;
  return `<li class="folder-row ${picked ? 'picked' : ''}" style="--depth:${depth}">
    ${selectable ? `<label class="pick"><input type="checkbox" data-pick-folder="${esc(f.id)}" ${picked ? 'checked' : ''} aria-label="Select ${esc(f.name)}"></label>
      <button type="button" class="fr-open" data-toggle-folder="${esc(f.id)}"><span class="fr-name" dir="auto">${esc(f.name)}</span>${meta}</button>`
    : `<button type="button" class="fr-open" data-go="folder=${esc(f.id)}"><span class="fr-name" dir="auto">${esc(f.name)}</span>${meta}</button>
      <button type="button" class="fr-more" data-folder-actions="${esc(f.id)}" aria-label="Folder actions: ${esc(f.name)}">⋯</button>`}</li>`;
}
let vsel = { on: false, picked: new Set() };   // Vocab view: pick folders to study together
const studyHash = (ids, mode) => `study=${ids.map(encodeURIComponent).join(',')}&mode=${mode}`;

function vocabView() {
  main.dataset.empty = '';
  const rows = tree(), total = liveCards().length;
  const live = new Set(rows.map(r => r.f.id));
  vsel.picked = new Set([...vsel.picked].filter(id => live.has(id)));
  if (!rows.length) vsel.on = false;
  const n = vsel.picked.size;
  renderKeepingFocus('vocab', `<h2 class="sec">Vocab · ${plural(total, 'card')}</h2>
    <div class="v-actions"><button type="button" class="btn" id="v-newfolder">New folder</button>
      ${total ? '<button type="button" class="btn" id="v-export-all">Export all</button>' : ''}
      ${rows.length ? `<button type="button" class="btn ${vsel.on ? 'primary' : ''}" id="v-select" aria-pressed="${vsel.on}">Select to study</button>` : ''}</div>
    ${rows.length ? `<ul class="folder-list">${rows.map(({ f, depth }) => folderRowHtml(f, depth, vsel.on)).join('')}</ul>` : ''}
    ${vsel.on ? `<div class="select-bar" role="toolbar" aria-label="Study selection"><span class="sb-n" aria-live="polite">${plural(n, 'folder')} selected</span>
      <button type="button" class="btn" id="vs-study" ${n ? '' : 'disabled'}>Study</button>
      <button type="button" class="btn" id="vs-review" ${n ? '' : 'disabled'}>Review</button>
      <button type="button" class="btn primary" id="vs-fdone">Done</button></div>` : ''}
    ${rows.length ? ''
      : `<p class="muted">No saved words yet. Tap the bookmark <span class="inline-bm">${BOOKMARK}</span> next to any word in the dictionary to save it, or create a folder and add cards by hand.</p>`}`);
}

function cardRowHtml(c) {
  const st = cardStatus(c), picked = vf.picked.has(c.id);
  return `<li class="card-row ${picked ? 'picked' : ''}" data-card="${esc(c.id)}">
    ${vf.select ? `<label class="pick"><input type="checkbox" data-pick-card="${esc(c.id)}" ${picked ? 'checked' : ''} aria-label="Select ${esc(c.word)}"></label>` : ''}
    <button type="button" class="cw" data-open-card="${esc(c.id)}" lang="ar" title="Open in dictionary">${esc(c.word)}</button>
    <button type="button" class="cg" data-edit-card="${esc(c.id)}" aria-label="Edit ${esc(c.word)}">
      <span class="g" dir="auto">${esc(c.gloss || '—')}</span><span class="badge ${st.k}">${st.label}</span></button></li>`;
}
function matches(c, q) {
  if (!q) return true;
  const n = norm(q);
  if (n && isAr(q) && (c.key.includes(n) || norm(c.root || '').replace(/\s/g, '').includes(n.replace(/\s/g, '')))) return true;
  const l = q.toLowerCase();
  return [c.gloss, c.arGloss, c.translit, c.note, (c.tags || []).join(' '), c.word].some(x => (x || '').toLowerCase().includes(l));
}
function renderCardList() {
  const list = main.querySelector('#vf-list');
  if (!list) return;
  const cards = cardsIn(vf.folder).sort((a, b) => b.createdAt - a.createdAt);
  const shown = cards.filter(c => matches(c, vf.filter.trim()));
  list.innerHTML = shown.map(cardRowHtml).join('');
  const empty = main.querySelector('#vf-empty');
  empty.textContent = !cards.length ? 'No cards here yet. Save words from the dictionary, or use Add card.' : !shown.length ? 'No cards match.' : '';
  empty.hidden = !empty.textContent;
}
function selectBarHtml(n, total) {
  return `<div class="select-bar" role="toolbar" aria-label="Selection">
    ${vf.confirmDel ? `<span class="sb-q">Delete ${plural(n, 'card')}?</span>
      <button type="button" class="btn danger" id="vs-del-yes">Delete</button>
      <button type="button" class="btn quiet" id="vs-del-no">Cancel</button>`
    : `<span class="sb-n" aria-live="polite">${n} selected</span>
      <button type="button" class="btn quiet" id="vs-all">${n === total && total ? 'None' : 'All'}</button>
      <button type="button" class="btn" id="vs-move" ${n ? '' : 'disabled'}>Move…</button>
      <button type="button" class="btn quiet danger-text" id="vs-del" ${n ? '' : 'disabled'}>Delete</button>
      <button type="button" class="btn primary" id="vs-done">Done</button>`}</div>`;
}
function folderView(id) {
  main.dataset.empty = '';
  const f = folderById(id);
  if (!f) {
    renderKeepingFocus('folder-missing', `<p class="muted">This folder no longer exists.</p><button type="button" class="btn" data-go="vocab">Back to Vocab</button>`);
    view = 'folder';
    return;
  }
  if (vf.folder !== id) { vf = { folder: id, filter: '', select: false, picked: new Set(), confirmDel: false }; view = 'folder-enter'; }
  const cards = cardsIn(id);
  const live = new Set(cards.map(c => c.id));
  vf.picked = new Set([...vf.picked].filter(x => live.has(x)));
  const act = document.activeElement, sel = act?.id === 'vf-filter' ? [act.selectionStart, act.selectionEnd] : null;
  const path = folderPathList(id).slice(0, -1), subs = childrenOf(id);
  const key = view === 'folder' ? focusKey() : null;
  renderKeepingFocus('folder', `<nav class="crumbs" aria-label="Breadcrumb"><button type="button" class="crumb" data-go="vocab">Vocab</button>
      ${path.map(x => `<span aria-hidden="true">›</span><button type="button" class="crumb" data-go="folder=${esc(x.id)}" dir="auto">${esc(x.name)}</button>`).join('')}</nav>
    <div class="folder-head"><h2 class="folder-title" dir="auto">${esc(f.name)}</h2>
      <span class="muted">${plural(cards.length, 'card')}</span>
      <button type="button" class="fr-more" data-folder-actions="${esc(id)}" aria-label="Folder actions: ${esc(f.name)}">⋯</button></div>
    <div class="v-actions">
      ${cardsDeep(id).length ? `<button type="button" class="btn" id="vf-study">Study</button>
      <button type="button" class="btn ${dueCount(cardsDeep(id)) ? 'primary' : ''}" id="vf-review">Review · ${dueCount(cardsDeep(id))} due</button>` : ''}
      <button type="button" class="btn" id="vf-add">Add card</button>
      <button type="button" class="btn" id="vf-import">Import</button>
      ${cards.length ? `<button type="button" class="btn" id="vf-export">Export</button>
      <button type="button" class="btn ${vf.select ? 'primary' : ''}" id="vf-select" aria-pressed="${vf.select}">Select</button>` : ''}
    </div>
    ${subs.length ? `<ul class="folder-list">${subs.map(s => folderRowHtml(s)).join('')}</ul>` : ''}
    ${cards.length ? `<input id="vf-filter" class="inp vf-filter" type="search" dir="auto" placeholder="Filter this folder" aria-label="Filter cards" value="${esc(vf.filter)}">` : ''}
    <ul class="card-list" id="vf-list"></ul><p class="muted" id="vf-empty" hidden></p>
    ${vf.select ? selectBarHtml(vf.picked.size, cards.length) : ''}`);
  renderCardList();   // card rows exist only now, so restore focus after it
  if (key) {
    const el = main.querySelector(key);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch {} }
  }
}

// ---------- export ----------
const csvCell = v => { v = String(v ?? ''); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function toCSV(cards, withFolder) {
  const head = [...CSV_FIELDS, ...(withFolder ? ['folder'] : [])];
  const rows = cards.map(c => [...CSV_FIELDS.map(k => (k === 'tags' ? (c.tags || []).join(' ') : c[k] || '')),
    ...(withFolder ? [folderPath(cardFolder(c))] : [])]);
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function toJSON(cards, folderName) {
  return JSON.stringify({
    qamus: 1, exportedAt: new Date().toISOString(), folder: folderName,
    cards: cards.map(c => ({
      word: c.word, gloss: c.gloss || '', arGloss: c.arGloss || '', root: c.root || '', translit: c.translit || '',
      context: c.context || '', highlight: c.highlight || '', note: c.note || '', tags: c.tags || [],
      source: c.source || 'custom', ref: c.ref || '', folder: folderPath(cardFolder(c)),
    })),
  }, null, 2);
}
const slug = s => String(s).normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cards';
async function deliver(name, text, mime) {
  const file = new File([text], name, { type: mime });
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportSheet(folderId) {
  const cards = (folderId ? cardsIn(folderId) : liveCards()).sort((a, b) => a.createdAt - b.createdAt);
  const label = folderId ? folderPath(folderId) : 'All';
  const base = `qamus-${slug(folderId ? folderById(folderId).name : 'all')}-${new Date().toISOString().slice(0, 10)}`;
  sheet({
    title: folderId ? 'Export folder' : 'Export all',
    body: `<p><b dir="auto">${esc(label)}</b> · ${plural(cards.length, 'card')}</p>
      <p class="muted sheet-note">CSV opens in spreadsheets and imports into Anki. JSON keeps every field and can be imported back here.</p>
      <div class="actions"><button type="button" class="btn primary" id="ex-csv">Download CSV</button>
      <button type="button" class="btn" id="ex-json">Download JSON</button>
      <button type="button" class="btn quiet" id="ex-cancel">Cancel</button></div>`,
    onMount(p, api) {
      p.querySelector('#ex-csv').addEventListener('click', () => { deliver(base + '.csv', toCSV(cards, !folderId), 'text/csv;charset=utf-8'); api.close(); });
      p.querySelector('#ex-json').addEventListener('click', () => { deliver(base + '.json', toJSON(cards, label), 'application/json'); api.close(); });
      p.querySelector('#ex-cancel').addEventListener('click', () => api.close());
    },
  });
}

// ---------- import ----------
const IMPORT_KEYS = { word: 'word', gloss: 'gloss', meaning: 'gloss', english: 'gloss', argloss: 'arGloss', root: 'root',
  translit: 'translit', transliteration: 'translit', context: 'context', highlight: 'highlight', note: 'note', notes: 'note',
  tags: 'tags', source: 'source', ref: 'ref' };
function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function parseImport(text, fileName) {
  text = String(text).replace(/^﻿/, '');
  let raw;
  const t = text.trimStart();
  if (/\.json$/i.test(fileName) || t[0] === '[' || t[0] === '{') {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error('This isn’t valid JSON.'); }
    raw = Array.isArray(j) ? j : j && Array.isArray(j.cards) ? j.cards : null;
    if (!raw) throw new Error('No “cards” list found in this JSON file.');
    raw = raw.map(o => (o && typeof o === 'object' ? o : {}));
  } else {
    const body = text.replace(/^(#[^\n]*\n)+/, '');   // Anki export header lines
    const first = body.split(/\r?\n/, 1)[0];
    const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
    const rows = parseDelimited(body, delim).filter(r => r.some(c => c.trim()));
    let cols = CSV_FIELDS;
    if (rows.length && rows[0].some(c => c.trim().toLowerCase() === 'word')) cols = rows.shift().map(c => IMPORT_KEYS[c.trim().toLowerCase()] || '');
    raw = rows.map(r => { const o = {}; cols.forEach((k, i) => { if (k) o[k] = r[i] ?? ''; }); return o; });
  }
  const items = [];
  let skipped = 0;
  for (const o of raw) {
    const word = clip(o.word).trim();
    if (!word) { skipped++; continue; }
    const it = { word };
    for (const k of TEXT_FIELDS) if (k !== 'word') it[k] = clip(typeof o[k] === 'string' ? o[k] : o[k] == null ? '' : String(o[k]));
    it.tags = cleanTags(o.tags);
    it.source = CARD_SOURCES.includes(o.source) ? o.source : 'custom';
    it.ref = it.source === 'custom' ? '' : clip(o.ref, 200);
    items.push(it);
  }
  return { items, skipped };
}
function importSheet(fileName, parsed, folderId) {
  const { items, skipped } = parsed;
  sheet({
    title: 'Import cards',
    body: `<p><b>${esc(fileName)}</b> — ${plural(items.length, 'card')}${skipped ? ` · ${plural(skipped, 'row')} without a word skipped` : ''}</p>
      ${items.length ? `<div class="preview-wrap"><table class="preview-table"><thead><tr><th>Word</th><th>Meaning</th></tr></thead><tbody>
        ${items.slice(0, 5).map(it => `<tr><td lang="ar">${esc(it.word)}</td><td dir="auto">${esc(shortGloss(it.gloss, 80))}</td></tr>`).join('')}
      </tbody></table></div>${items.length > 5 ? `<p class="muted sheet-note">…and ${items.length - 5} more</p>` : ''}` : ''}
      <label class="lbl" for="im-folder">Import into</label>
      <select id="im-folder" class="inp">${folderOptions(folderId)}</select>
      <label class="check"><input type="checkbox" id="im-skip" checked> <span>Skip duplicates (<span id="im-dupn">0</span> already in this folder)</span></label>
      <p class="form-msg" id="im-msg" role="status" aria-live="polite"></p>
      <div class="actions"><button type="button" class="btn primary" id="im-go">Import</button>
      <button type="button" class="btn quiet" id="im-cancel">Cancel</button></div>`,
    onMount(p, api) {
      const $p = s => p.querySelector(s), go_ = $p('#im-go'), msg = $p('#im-msg');
      let toAdd = [];
      const update = () => {
        const folder = $p('#im-folder').value;
        const have = new Set(cardsIn(folder).map(c => c.key));
        const seen = new Set();
        let dups = 0;
        toAdd = items.filter(it => {
          const k = norm(it.word);
          const dup = have.has(k) || seen.has(k);
          seen.add(k);
          if (dup) dups++;
          return !(dup && $p('#im-skip').checked);
        });
        $p('#im-dupn').textContent = dups;
        let err = '';
        if (!toAdd.length) err = items.length ? 'Nothing new to import.' : 'No cards found in this file.';
        else if (vdoc().cards.length + toAdd.length > MAX_CARDS) err = `That would go over the ${MAX_CARDS.toLocaleString()}-card limit.`;
        else if (new TextEncoder().encode(JSON.stringify(vdoc())).length + new TextEncoder().encode(JSON.stringify(toAdd)).length + toAdd.length * 120 > MAX_BYTES) err = 'That’s too much text to sync (1 MB limit). Try a smaller file.';
        msg.textContent = err;
        msg.classList.toggle('err', !!err);
        go_.disabled = !!err;
        go_.textContent = `Import ${plural(toAdd.length, 'card')}`;
      };
      $p('#im-folder').addEventListener('change', update);
      $p('#im-skip').addEventListener('change', update);
      $p('#im-cancel').addEventListener('click', () => api.close());
      go_.addEventListener('click', () => {
        const folder = $p('#im-folder').value;
        try {
          Store.mutate(d => {
            const now = Date.now();
            ensureInbox(d);
            toAdd.forEach((it, i) => d.cards.push(cardRec(it, folder, now - i)));
          });
        } catch (err) { msg.textContent = 'Import failed: ' + (err.message || err); msg.classList.add('err'); return; }
        api.close();
        if (folder !== vf.folder) go('folder=' + folder);
      });
      update();
    },
  });
}
function pickImportFile(folderId) {
  let input = document.getElementById('vf-file');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file'; input.id = 'vf-file'; input.hidden = true;
    input.accept = '.csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json';
    document.body.appendChild(input);
  }
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    let parsed;
    try { parsed = parseImport(await file.text(), file.name); }
    catch (err) {
      sheet({ title: 'Import cards', body: `<p class="form-msg err">${esc(err.message || String(err))}</p>
        <div class="actions"><button type="button" class="btn" id="im-x">Close</button></div>`,
        onMount(p, api) { p.querySelector('#im-x').addEventListener('click', () => api.close()); } });
      return;
    }
    importSheet(file.name, parsed, folderId);
  };
  input.click();
}

// ---------- events ----------
main.addEventListener('click', e => {
  const t = e.target;
  const sb = t.closest('.save-btn');
  if (sb) { e.preventDefault(); e.stopImmediatePropagation(); onSaveClick(sb); return; }
  if (view !== 'vocab' && view !== 'folder') return;
  const fa = t.closest('[data-folder-actions]');
  if (fa) { folderActionsSheet(fa.dataset.folderActions); return; }
  const toggle = id => {
    vf.picked.has(id) ? vf.picked.delete(id) : vf.picked.add(id);
    vf.confirmDel = false;
    folderView(vf.folder);
  };
  const tf = t.closest('[data-toggle-folder]');
  if (tf) {
    const fid = tf.dataset.toggleFolder;
    vsel.picked.has(fid) ? vsel.picked.delete(fid) : vsel.picked.add(fid);
    vocabView();
    return;
  }
  const openEl = t.closest('[data-open-card], [data-edit-card]');
  if (openEl) {
    const id = openEl.dataset.openCard || openEl.dataset.editCard;
    const c = liveCards().find(x => x.id === id);
    if (!c) return;
    if (vf.select) return toggle(id);
    return openEl.dataset.openCard ? openCard(c) : cardSheet({ mode: 'edit', card: c });
  }
  const id = t.closest('button')?.id;
  const shown = () => cardsIn(vf.folder).filter(c => matches(c, vf.filter.trim())).map(c => c.id);
  switch (id) {
    case 'v-newfolder': return newFolderSheet(null);
    case 'v-select': vsel = { on: !vsel.on, picked: new Set() }; vocabView(); return $(vsel.on ? '#vs-fdone' : '#v-select')?.focus();
    case 'vs-fdone': vsel = { on: false, picked: new Set() }; vocabView(); return $('#v-select')?.focus();
    case 'vs-study': case 'vs-review': { const ids = [...vsel.picked]; vsel = { on: false, picked: new Set() }; return go(studyHash(ids, id === 'vs-study' ? 'browse' : 'review')); }
    case 'vf-study': return go(studyHash([vf.folder], 'browse'));
    case 'vf-review': return go(studyHash([vf.folder], 'review'));
    case 'v-export-all': return exportSheet(null);
    case 'vf-add': return cardSheet({ mode: 'add', folder: vf.folder });
    case 'vf-import': return pickImportFile(vf.folder);
    case 'vf-export': return exportSheet(vf.folder);
    case 'vf-select': vf.select = !vf.select; vf.picked.clear(); vf.confirmDel = false; folderView(vf.folder); return $(vf.select ? '#vs-done' : '#vf-select')?.focus();
    case 'vs-all': { const ids = shown(); const all = ids.length && ids.every(x => vf.picked.has(x)); vf.picked = new Set(all ? [] : ids); folderView(vf.folder); return $('#vs-all')?.focus(); }
    case 'vs-move': return moveSheet([...vf.picked], vf.folder);
    case 'vs-del': vf.confirmDel = true; folderView(vf.folder); return $('#vs-del-no')?.focus();
    case 'vs-del-no': vf.confirmDel = false; folderView(vf.folder); return $('#vs-del')?.focus();
    case 'vs-del-yes': { const ids = [...vf.picked]; vf.confirmDel = false; vf.picked.clear(); vf.select = false; deleteCards(ids); return; }
    case 'vs-done': vf.select = false; vf.picked.clear(); vf.confirmDel = false; folderView(vf.folder); return $('#vf-select')?.focus();
  }
});
main.addEventListener('change', e => {
  if (e.target.matches?.('[data-pick-folder]')) {
    const id = e.target.dataset.pickFolder;
    e.target.checked ? vsel.picked.add(id) : vsel.picked.delete(id);
    vocabView();
    main.querySelector(`[data-pick-folder="${CSS.escape(id)}"]`)?.focus();
    return;
  }
  if (e.target.matches?.('[data-pick-card]')) {
    const id = e.target.dataset.pickCard;
    e.target.checked ? vf.picked.add(id) : vf.picked.delete(id);
    vf.confirmDel = false;
    folderView(vf.folder);
    main.querySelector(`[data-pick-card="${CSS.escape(id)}"]`)?.focus();
  }
});
main.addEventListener('input', e => {
  if (e.target.id === 'vf-filter') { vf.filter = e.target.value; renderCardList(); }
});
