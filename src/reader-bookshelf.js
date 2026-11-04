/**
 * Kotoba bookshelf ↔ existing PDF.js reader integration.
 * Keep the existing PDF reader and OCR functionality intact.
 */
import {
  saveBook, getBook, saveProgress, saveOcrPage, getOcrPage,
  rememberActiveBook, getRememberedBook
} from './library.js';
import { mountBookshelf } from './bookshelf.js';

export function connectBookshelf({ state, pdfjsLib, renderPage, ocrLayoutByPage,
  stage, paper, toast, setBusy, $ }) {
  let activeBookId = null;
  let opening = false;
  let generation = 0;
  let restoreCounter = 0;
  let progressTimer = null;

  function showError(message, error) {
    console.error('[Kotoba library]', message, error);
    toast(message + (error?.message ? '：' + error.message : ''));
  }

  function persistProgress() {
    if (!activeBookId || !state.pdf || opening) return;
    const id = activeBookId;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      saveProgress(id, { page: state.page, pageCount: state.count, zoom: state.zoom })
        .catch(err => showError('阅读进度保存失败', err));
    }, 180);
  }

  async function restoreOcrForPage(bookId, pageNo, token) {
    const data = await getOcrPage(bookId, pageNo);
    if (token !== generation || activeBookId !== bookId || state.page !== pageNo) return;
    if (data?.text) {
      state.ocrByPage.set(pageNo, data.text);
      if (data.layout) ocrLayoutByPage.set(pageNo, data.layout);
      await renderPage();
    }
  }

  async function openStoredBook(book) {
    if (opening) return;
    opening = true;
    setBusy(true, '正在从本地书架打开 PDF…');
    const token = ++generation;
    try {
      const bytes = new Uint8Array(await book.file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: true }).promise;
      clearTimeout(progressTimer);
      activeBookId = book.id;
      state.pdf = pdf;
      state.count = pdf.numPages;
      state.page = Math.min(Math.max(1, book.lastPage || 1), pdf.numPages);
      state.zoom = Number(book.zoom) || 1;
      state.textByPage.clear();
      state.ocrByPage.clear();
      ocrLayoutByPage.clear();
      state.selected = '';
      state.textMode = false;
      state.history = [];
      $('filename').textContent = book.name;
      $('pdf-kind').textContent = `PDF · ${pdf.numPages} 页`;
      $('welcome').classList.add('hidden');
      stage.classList.remove('hidden');
      if ($('zoom')) {
        $('zoom').value = String(Math.round(state.zoom * 100));
        if ($('zoom-value')) $('zoom-value').textContent = Math.round(state.zoom * 100) + '%';
      }
      const cached = await getOcrPage(book.id, state.page);
      if (cached?.text) {
        state.ocrByPage.set(state.page, cached.text);
        if (cached.layout) ocrLayoutByPage.set(state.page, cached.layout);
      }
      await renderPage();
      $('reader-scroll').scrollTop = 0;
      rememberActiveBook(book.id);
      persistProgressAfterOpen(book.id);
      toast('已恢复《' + book.name + '》第 ' + state.page + ' 页');
    } finally {
      opening = false;
      setBusy(false);
    }
  }

  function persistProgressAfterOpen(bookId) {
    saveProgress(bookId, {page: state.page, pageCount: state.count, zoom: state.zoom})
      .catch(err => showError('阅读进度保存失败', err));
  }

  async function importNewPdf(file) {
    if (opening || state.busy) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('请选择 PDF 文献。');
      return;
    }
    opening = true;
    setBusy(true, '正在导入 PDF 并保存到书架…');
    ++generation;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: true }).promise;
      let savedId = null;
      try {
        savedId = await saveBook(file, { pageCount: pdf.numPages, lastPage: 1, zoom: 1 });
      } catch (err) {
        showError('PDF 可以阅读，但未成功保存到书架', err);
      }
      clearTimeout(progressTimer);
      activeBookId = savedId;
      state.pdf = pdf;
      state.page = 1;
      state.count = pdf.numPages;
      state.zoom = 1;
      state.textByPage.clear();
      state.ocrByPage.clear();
      ocrLayoutByPage.clear();
      state.history = [];
      state.selected = '';
      state.textMode = false;
      $('filename').textContent = file.name;
      $('pdf-kind').textContent = 'PDF · ' + state.count + ' 页';
      if ($('zoom')) $('zoom').value = '100';
      if ($('zoom-value')) $('zoom-value').textContent = '100%';
      $('welcome').classList.add('hidden');
      stage.classList.remove('hidden');
      await renderPage();
      $('reader-scroll').scrollTop = 0;
      if (savedId) {
        rememberActiveBook(savedId);
        toast('已将《' + file.name + '》保存到本地书架。');
      } else toast('PDF 已打开，但尚未保存到书架。请保留原始文件。');
    } catch (error) {
      showError('PDF 打开失败', error);
    } finally {
      opening = false;
      setBusy(false);
      $('file-input').value = '';
    }
  }

  // Capture the file input change before the old single-document handler runs.
  // This avoids modifying the existing, tested OCR and PDF rendering implementation.
  window.addEventListener('change', event => {
    if (event.target !== $('file-input')) return;
    const file = event.target.files?.[0];
    if (!file) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
    importNewPdf(file).catch(error => showError('导入 PDF 失败', error));
  }, true);

  // Save page changes after the reader's existing click handler updates state.page.
  for (const id of ['prev-page', 'next-page']) {
    $(id).addEventListener('click', () => {
      const pageNo = state.page;
      const bookId = activeBookId;
      persistProgress();
      if (!bookId || !state.pdf) return;
      const token = ++restoreCounter;
      const currentGeneration = generation;
      getOcrPage(bookId, pageNo).then(cached => {
        if (token !== restoreCounter || currentGeneration !== generation ||
            activeBookId !== bookId || state.page !== pageNo || !cached?.text) return;
        state.ocrByPage.set(pageNo, cached.text);
        if (cached.layout) ocrLayoutByPage.set(pageNo, cached.layout);
        return renderPage();
      }).catch(err => console.warn('[Kotoba] OCR cache restore failed', err));
    });
  }

  $('zoom').addEventListener('input', persistProgress);

  // The existing OCR recognizer writes its result to this Map.
  // Mirror those results into IndexedDB without changing runOcr().
  const originalSet = state.ocrByPage.set.bind(state.ocrByPage);
  state.ocrByPage.set = (pageNo, text) => {
    const outcome = originalSet(pageNo, text);
    const id = activeBookId;
    if (id && text && ocrLayoutByPage.has(pageNo)) {
      saveOcrPage(id, pageNo, { text, layout: ocrLayoutByPage.get(pageNo) })
        .catch(err => showError('OCR 缓存保存失败', err));
    }
    return outcome;
  };

  mountBookshelf({
    onOpenBook: openStoredBook,
    onAddBook: () => $('file-input').click()
  });

  // Resume only on first load, unless the user has already opened a document.
  const previous = getRememberedBook();
  if (previous) {
    getBook(previous).then(book => {
      if (book && !state.pdf && !opening) return openStoredBook(book);
    }).catch(err => console.warn('[Kotoba] Auto restore failed', err));
  }
}
