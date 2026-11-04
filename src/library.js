/**
 * Kotoba Library - local PDF bookshelf storage for Safari / iPad / iPhone.
 * Stores the user's PDF files, last read page and per-page OCR locally in IndexedDB.
 * No file bytes or reading records are transmitted to any server by this module.
 *
 * This module provides storage APIs. It must be imported and connected to the
 * existing reader UI before the bookshelf becomes available.
 */
const DATABASE = 'kotoba-library-v1';
const VERSION = 1;
const BOOKS = 'books';
const OCR = 'ocr';

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB operation failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export function openLibrary() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('当前浏览器不支持 IndexedDB。请使用最新版 Safari。'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BOOKS)) {
          const store = db.createObjectStore(BOOKS, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(OCR)) {
          const store = db.createObjectStore(OCR, { keyPath: ['bookId', 'page'] });
          store.createIndex('bookId', 'bookId');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('无法打开本地书架'));
      request.onblocked = () => reject(new Error('书架正在其他标签页打开，请关闭旧标签页后重试。'));
    }).catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function cleanPage(value, count = Number.MAX_SAFE_INTEGER) {
  const maxPage = Math.max(1, Number(count) || 1);
  return Math.min(maxPage, Math.max(1, Math.floor(Number(value) || 1)));
}

/** Save a File or Blob. Returns the new book's ID. */
export async function saveBook(file, options = {}) {
  if (!(file instanceof Blob)) throw new TypeError('saveBook expects a PDF File or Blob');
  const name = String(options.name || file.name || '未命名文献.pdf');
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(name)) {
    throw new TypeError('请选择 PDF 文件');
  }
  const now = Date.now();
  const record = {
    id: makeId(), name, file, size: file.size, createdAt: now,
    updatedAt: now, lastPage: cleanPage(options.lastPage || 1),
    pageCount: Math.max(0, Number(options.pageCount) || 0),
    zoom: Number(options.zoom) || 1
  };
  const db = await openLibrary();
  const tx = db.transaction(BOOKS, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(BOOKS).put(record);
  await done;
  return record.id;
}

/** List metadata only, excluding the potentially large PDF blobs. */
export async function listBooks() {
  const db = await openLibrary();
  const tx = db.transaction(BOOKS, 'readonly');
  const records = await requestResult(tx.objectStore(BOOKS).getAll());
  return records
    .map(({ file, ...details }) => details)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Retrieve a book with its PDF Blob so the existing PDF.js reader can open it. */
export async function getBook(bookId) {
  const db = await openLibrary();
  return (await requestResult(db.transaction(BOOKS, 'readonly').objectStore(BOOKS).get(bookId))) || null;
}

/** Read and update the saved position for one book independently of others. */
export async function saveProgress(bookId, { page, pageCount, zoom } = {}) {
  const db = await openLibrary();
  const tx = db.transaction(BOOKS, 'readwrite');
  const store = tx.objectStore(BOOKS);
  const done = transactionDone(tx);
  const record = await requestResult(store.get(bookId));
  if (!record) {
    tx.abort();
    try { await done; } catch { /* expected abort */ }
    throw new Error('找不到该文献，无法保存阅读进度');
  }
  if (pageCount !== undefined) record.pageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (page !== undefined) record.lastPage = cleanPage(page, record.pageCount || Number.MAX_SAFE_INTEGER);
  if (zoom !== undefined && Number.isFinite(Number(zoom))) record.zoom = Number(zoom);
  record.updatedAt = Date.now();
  store.put(record);
  await done;
  return { id: record.id, page: record.lastPage, zoom: record.zoom };
}

/** Persist OCR content and word position blocks for each recognized page. */
export async function saveOcrPage(bookId, page, { text = '', layout = null } = {}) {
  if (!bookId) throw new Error('缺少文献 ID');
  const db = await openLibrary();
  const tx = db.transaction(OCR, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(OCR).put({ bookId, page: cleanPage(page), text, layout, updatedAt: Date.now() });
  await done;
}

export async function getOcrPage(bookId, page) {
  const db = await openLibrary();
  return (await requestResult(db.transaction(OCR, 'readonly').objectStore(OCR).get([bookId, cleanPage(page)]))) || null;
}

/** Delete a book and all of its cached OCR pages. */
export async function deleteBook(bookId) {
  const db = await openLibrary();
  const tx = db.transaction([BOOKS, OCR], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(BOOKS).delete(bookId);
  const index = tx.objectStore(OCR).index('bookId');
  const cursor = index.openCursor(IDBKeyRange.only(bookId));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (item) { item.delete(); item.continue(); }
  };
  await done;
}

/** Store the most recently opened book ID; actual book data stays in IndexedDB. */
export function rememberActiveBook(bookId) {
  try {
    if (bookId) localStorage.setItem('kotoba-active-book', bookId);
    else localStorage.removeItem('kotoba-active-book');
  } catch { /* storage disabled */ }
}

export function getRememberedBook() {
  try { return localStorage.getItem('kotoba-active-book'); }
  catch { return null; }
}
