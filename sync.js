/* Qamus local store (IndexedDB) + sync loop with the Worker.
 * Classic script; needs merge.js loaded first. Exposes window.QamusStore and window.QamusSync.
 * The local document is the source of truth; the network is only ever a background catch-up. */
(function (root) {
  'use strict';
  const QM = root.QamusMerge;
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const listeners = { change: new Set(), status: new Set() };
  const emit = (type, x) => { for (const f of listeners[type]) { try { f(x); } catch (e) { setTimeout(() => { throw e; }); } } };
  const on = (type, f) => { listeners[type].add(f); return () => listeners[type].delete(f); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ======================= Store =======================
  let doc = QM.emptyDoc();
  let meta = { dirty: false, gen: 0, lastSync: 0 };
  let db = null, initP = null, writeChain = Promise.resolve();

  function openDB() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open('qamus', 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
      setTimeout(() => reject(new Error('indexedDB open timed out')), 4000);
    });
  }
  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  // Writes are chained so they land in order; doc + meta always go in one transaction.
  function persist() {
    if (!db) return writeChain;
    const d = doc, m = { ...meta };
    writeChain = writeChain.then(() => new Promise(resolve => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(d, 'doc');
        tx.objectStore('kv').put(m, 'meta');
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => { console.warn('Qamus: saving to IndexedDB failed', tx.error); resolve(); };
      } catch (e) { console.warn('Qamus: saving to IndexedDB failed', e); resolve(); }
    }));
    return writeChain;
  }

  const Store = {
    persistent: false,
    get doc() { return doc; },
    get dirty() { return meta.dirty; },
    init() {
      if (initP) return initP;
      initP = (async () => {
        try {
          if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
          db = await openDB();
          const [d, m] = await Promise.all([idbGet('doc'), idbGet('meta')]);
          const early = meta.gen > 0;   // mutate() ran before the stored doc finished loading
          const stored = d && QM.validateDoc(d).ok ? d : null;
          if (d && !stored) console.warn('Qamus: stored document failed validation; starting fresh');
          if (m && typeof m === 'object') meta = { dirty: !!m.dirty, gen: (m.gen | 0) + meta.gen, lastSync: +m.lastSync || 0 };
          doc = early ? QM.merge(stored, doc) : (stored || doc);   // keep early changes
          if (early) { meta.dirty = true; persist(); }
          Store.persistent = true;
        } catch (e) {
          db = null;
          Store.persistent = false;   // in-memory only (private mode, sandboxed preview, …)
        }
        emit('change', { doc, source: 'init' });
      })();
      return initP;
    },
    // fn(draft) edits a copy; the result is validated before it replaces the doc.
    mutate(fn) {
      const draft = structuredClone(doc);
      const ret = fn(draft);
      draft.updatedAt = Date.now();
      const v = QM.validateDoc(draft);
      if (!v.ok) throw new Error('Qamus: invalid change — ' + v.error);
      doc = draft;
      meta.dirty = true;
      meta.gen++;
      persist();
      emit('change', { doc, source: 'local' });
      Sync._localChange();
      return ret;
    },
    async reset() {
      doc = QM.emptyDoc();
      meta = { dirty: false, gen: meta.gen + 1, lastSync: 0 };
      await persist();
      emit('change', { doc, source: 'reset' });
    },
    whenSaved() { return writeChain; },
    on(type, f) { return on(type, f); },
    _replace(next, dirty) {
      const changed = !QM.sameContent(doc, next);
      doc = next;
      meta.dirty = dirty;
      persist();
      if (changed) emit('change', { doc, source: 'remote' });
    },
  };

  // ======================= Sync =======================
  const DEBOUNCE = 2000, TIMEOUT = 15000, OFFLINE_RETRY = 30000, PULL_THROTTLE = 10000;
  let url = '', user = null, status = 'local', error = '';
  let session = 0;               // bumps on sign in/out so stale responses are ignored
  let busy = false, pending = null, idleWaiters = [];
  let pushTimer = 0, retryTimer = 0, backoff = 0, lastPullAt = 0, uncleanStreak = 0, wired = false;

  const enabled = () => !!(url && user);
  const state = () => ({ enabled: !!url, user, status, error, lastSync: meta.lastSync, dirty: meta.dirty });
  function setStatus(s, err = '') { status = s; error = err; emit('status', state()); }

  async function request(method, name, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(url + '/u/' + encodeURIComponent(name), {
        method, body, signal: ctl.signal, cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      });
      return res;
    } catch (e) {
      return null;               // network failure / timeout → offline
    } finally { clearTimeout(timer); }
  }
  async function errorText(res) {
    try { const j = await res.json(); if (j && j.error) return j.error; } catch {}
    return 'HTTP ' + res.status;
  }

  function goOffline() {
    setStatus('offline');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => cycle('pull'), OFFLINE_RETRY);
  }
  function retryLater(res) {
    const ra = Number(res.headers.get('Retry-After')) * 1000 || 0;
    backoff = Math.min(Math.max(backoff ? backoff * 2 : 5000, ra), 300000);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => cycle('pull'), backoff);
  }

  async function doPull() {
    const s = session, name = user;
    setStatus('syncing');
    lastPullAt = Date.now();
    const res = await request('GET', name);
    if (s !== session) return;
    if (!res) return goOffline();
    if (res.status === 404) return doPush(true);
    if (res.status === 429 || res.status >= 500) { setStatus('error', 'Server busy — retrying'); return retryLater(res); }
    if (!res.ok) return setStatus('error', await errorText(res));
    let remote;
    try { remote = await res.json(); } catch { return setStatus('error', 'Bad response from server'); }
    if (s !== session) return;
    if (!QM.validateDoc(remote).ok) return setStatus('error', 'Server sent an unexpected document');
    const merged = QM.merge(doc, remote);
    const differs = !QM.sameContent(merged, remote);
    Store._replace(merged, differs);
    backoff = 0;
    meta.lastSync = Date.now();
    persist();
    if (differs) return doPush(false);
    uncleanStreak = 0;
    setStatus('synced');
  }

  async function doPush(force) {
    if (!meta.dirty && !force) return setStatus('synced');
    const s = session, name = user, gen0 = meta.gen;
    setStatus('syncing');
    const res = await request('PUT', name, JSON.stringify(doc));
    if (s !== session) return;
    if (!res) return goOffline();
    if (res.status === 429 || res.status >= 500) { setStatus('error', 'Server busy — retrying'); return retryLater(res); }
    if (!res.ok) return setStatus('error', await errorText(res));   // 400/413/422: wait for the next change
    let resp;
    try { resp = await res.json(); } catch { return setStatus('error', 'Bad response from server'); }
    if (s !== session) return;
    const merged = QM.merge(doc, resp);
    const clean = meta.gen === gen0 && QM.sameContent(merged, resp);
    Store._replace(merged, !clean);
    backoff = 0;
    meta.lastSync = Date.now();
    persist();
    if (clean) { uncleanStreak = 0; return setStatus('synced'); }
    if (meta.gen === gen0 && ++uncleanStreak > 3) return setStatus('error', 'Sync did not settle; will retry on the next change');
    schedulePush();
    setStatus('syncing');
  }

  // One network operation at a time; requests that arrive meanwhile are coalesced (pull > push).
  async function cycle(mode) {
    if (!enabled()) return;
    if (busy) { pending = (pending === 'pull' || mode === 'pull') ? 'pull' : 'push'; return; }
    busy = true;
    clearTimeout(retryTimer);
    if (mode === 'pull') clearTimeout(pushTimer);
    try { mode === 'pull' ? await doPull() : await doPush(false); }
    catch (e) { setStatus('error', String(e && e.message || e)); }
    finally {
      busy = false;
      if (pending) { const m = pending; pending = null; cycle(m); }
      else { const w = idleWaiters; idleWaiters = []; w.forEach(f => f()); }
    }
  }
  function whenIdle() { return busy ? new Promise(r => idleWaiters.push(r)) : Promise.resolve(); }
  function schedulePush(ms = DEBOUNCE) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => cycle('push'), ms);
  }

  function wire() {
    if (wired) return; wired = true;
    document.addEventListener('visibilitychange', () => {
      if (!enabled()) return;
      if (document.visibilityState === 'visible') { if (Date.now() - lastPullAt > PULL_THROTTLE) cycle('pull'); }
      else if (meta.dirty) { clearTimeout(pushTimer); cycle('push'); }   // flush before the app is backgrounded
    });
    root.addEventListener('online', () => { if (enabled()) cycle('pull'); });
    root.addEventListener('offline', () => { if (enabled() && !busy) setStatus('offline'); });
  }

  const Sync = {
    get state() { return state(); },
    on(type, f) { return on(type, f); },
    init(opts) {
      url = String((opts && opts.url) || '').replace(/\/+$/, '');
      user = url ? QM.normUsername(LS.get('qamus.user') || '') : null;
      wire();
      if (enabled()) cycle('pull'); else setStatus('local');
    },
    // HEAD the name: 'existing' | 'new' | 'invalid' | 'unreachable'
    async check(name) {
      const n = QM.normUsername(name || '');
      if (!n || !url) return n ? 'unreachable' : 'invalid';
      const res = await request('HEAD', n);
      if (!res) return 'unreachable';
      if (res.status === 200) return 'existing';
      if (res.status === 404) return 'new';
      if (res.status === 400) return 'invalid';
      return 'unreachable';
    },
    // Local data (if any) is merged into the account by the first pull.
    async signIn(name) {
      const n = QM.normUsername(name || '');
      if (!n) throw new Error('invalid username');
      LS.set('qamus.user', n);
      LS.del('qamus.syncSkipped');
      session++; user = n; uncleanStreak = 0; backoff = 0;
      meta.dirty = true; persist();   // make sure this device's data reaches the account
      await Sync.syncNow();
      return state();
    },
    // keepData=false clears this device unless unsynced changes remain (then returns done:false
    // so the UI can ask again; pass force:true to clear anyway).
    async signOut({ keepData = false, force = false } = {}) {
      if (meta.dirty && enabled()) {
        clearTimeout(pushTimer);
        cycle('push');
        await Promise.race([whenIdle(), sleep(5000)]);
      }
      const unsynced = meta.dirty && enabled();
      if (unsynced && !keepData && !force) return { done: false, unsynced: true };
      session++;
      clearTimeout(pushTimer); clearTimeout(retryTimer);
      user = null; pending = null;
      LS.del('qamus.user');
      LS.set('qamus.syncSkipped', '1');
      if (!keepData) await Store.reset();
      setStatus('local');
      return { done: true, unsynced };
    },
    syncNow() {
      if (!enabled()) return Promise.resolve(state());
      cycle('pull');
      return whenIdle().then(state);
    },
    whenIdle,
    _localChange() {
      if (!enabled()) return;
      schedulePush();
      if (status === 'synced') setStatus('syncing');
    },
  };

  root.QamusStore = Store;
  root.QamusSync = Sync;
})(typeof globalThis !== 'undefined' ? globalThis : self);
