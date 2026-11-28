// Client-side Arabic PDF Bookshelf & Page Renderer (100% browser-local IndexedDB)
// Zero backend required — works on GitHub Pages, iPhone Safari, iPad, and desktop.

const DB_NAME = 'qamus_mobile_books_v1';
const DB_VER = 1;
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let pdfjsLibPromise = null;
let dbPromise = null;
const loadedDocs = new Map(); // bookId -> PDFDocumentProxy

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(PDFJS_CDN).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

function openBooksDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openBooksDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openBooksDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openBooksDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openBooksDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBooks() {
  const list = await idbGetAll('books');
  return list.sort((a, b) => (b.lastOpenedAt || b.addedAt || 0) - (a.lastOpenedAt || a.addedAt || 0));
}

export async function importPdfFile(file) {
  const lib = await getPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
  const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Arabic Book';

  // Render small cover thumbnail from page 1
  let coverDataUrl = '';
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 0.45 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    coverDataUrl = canvas.toDataURL('image/jpeg', 0.72);
  } catch {}

  const meta = {
    id,
    title,
    pageCount: doc.numPages,
    lastPage: 1,
    verifiedPages: [],
    coverDataUrl,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };

  await idbPut('blobs', { id, data: buf });
  await idbPut('books', meta);
  loadedDocs.set(id, doc);
  return meta;
}

export async function deleteBook(bookId) {
  loadedDocs.delete(bookId);
  await idbDelete('books', bookId);
  await idbDelete('blobs', bookId);
  // Clean cached OCR pages for this book
  const pages = await idbGetAll('pages');
  for (const p of pages) {
    if (p.bookId === bookId) await idbDelete('pages', p.key);
  }
}

export async function updateBookProgress(bookId, page) {
  const meta = await idbGet('books', bookId);
  if (!meta) return;
  meta.lastPage = page;
  meta.lastOpenedAt = Date.now();
  await idbPut('books', meta);
}

export async function getBookDocument(bookId) {
  if (loadedDocs.has(bookId)) return loadedDocs.get(bookId);
  const blob = await idbGet('blobs', bookId);
  if (!blob?.data) throw new Error('Book PDF data not found on this device.');
  const lib = await getPdfJs();
  const doc = await lib.getDocument({ data: blob.data.slice(0) }).promise;
  loadedDocs.set(bookId, doc);
  return doc;
}

export async function getBookOutline(bookId) {
  try {
    const doc = await getBookDocument(bookId);
    const raw = await doc.getOutline();
    if (!raw?.length) return [];
    const out = [];
    const walk = async (items, depth) => {
      for (const it of items) {
        let page = 1;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            page = (await doc.getPageIndex(dest[0])) + 1;
          }
        } catch {}
        out.push({ title: it.title || `Page ${page}`, page, depth });
        if (it.items?.length) await walk(it.items, depth + 1);
      }
    };
    await walk(raw, 0);
    return out;
  } catch {
    return [];
  }
}

export async function renderPdfPageToCanvas(bookId, pageNum, canvas, targetWidth = 900) {
  const doc = await getBookDocument(bookId);
  const page = await doc.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.max(1.2, (targetWidth / Math.max(1, baseVp.width)) * dpr);
  const vp = page.getViewport({ scale });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { width: canvas.width, height: canvas.height };
}

export async function renderPdfPageToJpeg(bookId, pageNum, maxDim = 1650) {
  const doc = await getBookDocument(bookId);
  const page = await doc.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, maxDim / Math.max(baseVp.width, baseVp.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', dataUrl };
}

export async function getCachedPageText(bookId, pageNum) {
  return idbGet('pages', `${bookId}:${pageNum}`);
}

export async function saveCachedPageText(bookId, pageNum, text, meta = {}) {
  await idbPut('pages', {
    key: `${bookId}:${pageNum}`,
    bookId,
    pageNum,
    text,
    scannedAt: Date.now(),
    ...meta,
  });
  const book = await idbGet('books', bookId);
  if (book) {
    const set = new Set(book.verifiedPages || []);
    set.add(pageNum);
    book.verifiedPages = [...set].sort((a, b) => a - b);
    await idbPut('books', book);
  }
}
