/**
 * Kotoba Bookshelf UI
 * Works with ./library.js. No server upload is performed.
 * The PDF reader must call mountBookshelf({ onOpenBook }).
 */
import { listBooks, getBook, deleteBook } from './library.js';

const css = `
.kotoba-library-launch{border:1px solid #c8d8ce;background:#eff5ee;color:#315e52;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.kotoba-library-launch:focus-visible,.kotoba-library button:focus-visible{outline:2px solid #527d6f;outline-offset:2px}
.kotoba-library{position:fixed;inset:0;z-index:110;background:#192f27a6;display:none;align-items:center;justify-content:center;padding:16px}
.kotoba-library.is-open{display:flex}
.kotoba-library-panel{background:#fdfcf8;width:min(600px,100%);max-height:min(82dvh,740px);display:flex;flex-direction:column;border-radius:18px;overflow:hidden;box-shadow:0 24px 70px #0f261d50}
.kotoba-library-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:19px 20px;border-bottom:1px solid #e7e9df}
.kotoba-library-head h2{margin:0;color:#315e52;font-size:19px}
.kotoba-library-head p{margin:5px 0 0;color:#839388;font-size:11px}
.kotoba-library-close{border:0;background:#ecf0eb;color:#315e52;padding:9px 13px;border-radius:9px;font-size:14px;cursor:pointer}
.kotoba-library-list{padding:13px 17px;overflow-y:auto;min-height:90px}
.kotoba-library-entry{display:flex;align-items:center;gap:12px;padding:13px 5px;border-bottom:1px solid #e7e9df}
.kotoba-library-symbol{width:39px;height:48px;background:#e5eee5;border-radius:6px;display:grid;place-items:center;color:#527e70;font-size:19px;flex:none}
.kotoba-library-meta{min-width:0;flex:1}
.kotoba-library-name{font-weight:700;font-size:13px;color:#2f4c3e;overflow-wrap:anywhere}
.kotoba-library-page{color:#839388;font-size:11px;margin-top:6px}
.kotoba-library-actions{display:flex;gap:5px;align-items:center;flex:none}
.kotoba-library-actions button{border:0;border-radius:8px;padding:9px 10px;font-size:11px;font-weight:700;cursor:pointer}
.kotoba-library-open{background:#497764;color:white}
.kotoba-library-delete{background:#f5ece9;color:#965a50}
.kotoba-library-empty{color:#829087;text-align:center;padding:30px 16px;font-size:13px;line-height:1.9}
.kotoba-library-foot{border-top:1px solid #e7e9df;padding:15px 19px;display:flex;gap:10px;align-items:center;justify-content:space-between}
.kotoba-library-add{border:0;background:#315e52;color:white;border-radius:9px;padding:12px 15px;font-size:12px;font-weight:700;cursor:pointer}
.kotoba-library-note{font-size:10px;line-height:1.6;color:#88998d;max-width:285px}
@media(max-width:650px){.kotoba-library-launch{padding:9px 7px;font-size:11px}.kotoba-library-entry{gap:8px}.kotoba-library-actions{flex-direction:column}.kotoba-library-actions button{min-width:51px}}
`;

/**
 * Mount the bookshelf window and return controls.
 * onOpenBook(book) is supplied by the existing PDF.js reader, which knows how
 * to close the previous document and render the requested PDF at its saved page.
 */
export function mountBookshelf({ onOpenBook, onAddBook } = {}) {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('kotoba-library');
  if (existing) return window.__kotobaBookshelf || null;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'kotoba-library';
  overlay.className = 'kotoba-library';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Kotoba 文献书架');
  overlay.innerHTML = `<section class="kotoba-library-panel">
    <header class="kotoba-library-head"><div><h2>📚 我的文献书架</h2><p>书籍与阅读进度保存在此设备</p></div><button class="kotoba-library-close" type="button" aria-label="关闭书架">✕ 关闭</button></header>
    <div class="kotoba-library-list" aria-live="polite"></div>
    <footer class="kotoba-library-foot"><button class="kotoba-library-add" type="button">＋ 导入 PDF</button><span class="kotoba-library-note">Safari 本地保存，清除网站数据可能删除文献，请保留原始 PDF 备份。</span></footer>
  </section>`;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('.kotoba-library-list');
  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'kotoba-library-launch';
  launch.textContent = '📚 书架';
  const toolbar = document.querySelector('.reader-buttons') || document.querySelector('.header-actions') || document.body;
  toolbar.prepend(launch);
  let previousFocus = null;
  let loading = false;
  const close = () => {
    overlay.classList.remove('is-open');
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  const refresh = async () => {
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'kotoba-library-empty';
    empty.textContent = '正在读取本地文献…';
    list.appendChild(empty);
    try {
      const books = await listBooks();
      list.replaceChildren();
      if (!books.length) {
        empty.textContent = '书架还是空的。\n点击「导入 PDF」开始收藏第一本文献。';
        list.appendChild(empty);
        return;
      }
      for (const book of books) {
        const row = document.createElement('article');
        row.className = 'kotoba-library-entry';
        const icon = document.createElement('div'); icon.className = 'kotoba-library-symbol'; icon.textContent = '文';
        const meta = document.createElement('div'); meta.className = 'kotoba-library-meta';
        const name = document.createElement('div'); name.className = 'kotoba-library-name'; name.textContent = book.name;
        const details = document.createElement('div'); details.className = 'kotoba-library-page';
        details.textContent = `第 ${book.lastPage || 1}${book.pageCount ? ' / ' + book.pageCount : ''} 页 · ${new Date(book.updatedAt).toLocaleDateString('zh-CN')}`;
        meta.append(name,details);
        const actions = document.createElement('div'); actions.className = 'kotoba-library-actions';
        const open = document.createElement('button'); open.className = 'kotoba-library-open'; open.type = 'button'; open.textContent = '继续阅读';
        open.onclick = async () => {
          if (loading) return;
          if (typeof onOpenBook !== 'function') { alert('书架还没有连接到 PDF 阅读器。'); return; }
          loading = true; open.disabled = true; open.textContent = '打开中…';
          try {
            const full = await getBook(book.id);
            if (!full) throw new Error('该书籍已不存在');
            await onOpenBook(full);
            close();
          } catch (err) { alert('打开失败：' + (err?.message || err)); }
          finally { loading = false; open.disabled = false; open.textContent = '继续阅读'; }
        };
        const remove = document.createElement('button'); remove.className = 'kotoba-library-delete'; remove.type = 'button'; remove.textContent = '删除';
        remove.onclick = async () => {
          if (loading || !confirm(`从此设备删除「${book.name}」？\n这也会删除这本书的 OCR 缓存。`)) return;
          loading = true;
          try { await deleteBook(book.id); await refresh(); }
          catch (err) { alert('删除失败：' + (err?.message || err)); }
          finally { loading = false; }
        };
        actions.append(open,remove); row.append(icon,meta,actions); list.appendChild(row);
      }
    } catch (err) {
      empty.textContent = '书架读取失败：' + (err?.message || err);
      list.replaceChildren(empty);
    }
  };
  const show = async () => {
    previousFocus = document.activeElement;
    overlay.classList.add('is-open');
    overlay.querySelector('.kotoba-library-close').focus();
    await refresh();
  };
  launch.addEventListener('click', show);
  overlay.querySelector('.kotoba-library-close').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.querySelector('.kotoba-library-add').addEventListener('click', () => {
    close();
    if (typeof onAddBook === 'function') onAddBook();
    else document.getElementById('file-input')?.click();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });
  const api = { show, close, refresh };
  window.__kotobaBookshelf = api;
  return api;
}
