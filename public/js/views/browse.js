/* ============================================================
   Folder browser - Drive listing with breadcrumbs, filter, sort,
   list/grid views, deep links (#/browse/<collection>/<folder>/…).
   ============================================================ */
import { CONFIG } from '../config.js';
import { h, icon, fmtSize, fmtDate, plural, store, toast, skeletonRows, emptyState, ask, fill } from '../lib/dom.js';
import { listFolder, folderMeta, isFolder, downloadUrl, cachedIndex, clearListingCache, kindOf } from '../services/drive.js';
import { linkItemsIn, isAdmin } from '../services/firebase.js';
import { call, backendReady } from '../services/backend.js';
import { openPreview, fileIcon } from './preview.js';
import { recordFor, toEntry, syncCatalog } from '../services/catalog.js';

let sort = store.get('acce.sort', { key: 'name', dir: 1 });

export async function render({ root, params, query, navigate }) {
  const key = params[0];
  const base = CONFIG.folders[key];
  if (!base) { navigate('#/'); return; }
  const ids = [base.id, ...(params[1] || '').split('/').filter(Boolean)];
  const here = ids[ids.length - 1];
  const hrefFor = (n) => `#/browse/${key}${ids.slice(1, n + 1).map((i) => '/' + i).join('')}`;
  let alive = true, rows = [], layout = store.get('acce.layout', 'list');

  const filter = h('input', { class: 'input filter', type: 'search', placeholder: 'Filter this folder', 'aria-label': 'Filter files in this folder', dataset: { slashTarget: '1' } });
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Folder path' });
  const back = h('a', { class: 'btn btn-ghost btn-sm', href: ids.length > 1 ? hrefFor(ids.length - 2) : '#/' }, icon('back'), 'Back');
  const layoutBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Switch layout', onclick: () => { layout = layout === 'list' ? 'grid' : 'list'; store.set('acce.layout', layout); paint(); } }, icon(layout === 'list' ? 'grid' : 'list'));
  const refresh = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh folder', title: 'Refresh', onclick: () => load(true) }, icon('refresh'));
  const newFolder = isAdmin() && backendReady() ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: createFolder }, icon('plus'), 'Folder') : null;
  const body = h('div', { class: 'listing glass' });
  const count = h('p', { class: 'count-line' });

  root.append(h('section', { class: 'page browse' },
    h('div', { class: 'browser-bar glass' }, back, crumbs, h('div', { class: 'bar-tools' }, filter, newFolder, layoutBtn, refresh)),
    body, count));

  /* breadcrumbs: names from the index cache, else from Drive */
  (async () => {
    const idx = cachedIndex();
    const names = await Promise.all(ids.map(async (id, i) => {
      if (i === 0) return base.name;
      if (idx?.folderMap[id]) return idx.folderMap[id].name;
      try { return (await folderMeta(id)).name; } catch { return '…'; }
    }));
    if (!alive) return;
    fill(crumbs, ...names.flatMap((n, i) => [
      i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, icon('chevron')) : null,
      i === names.length - 1 ? h('b', { text: n, 'aria-current': 'page' }) : h('a', { href: hrefFor(i), text: n })
    ]));
    document.title = `${names[names.length - 1]} · ACCE Archive`;
  })();

  async function load(fresh = false) {
    fill(body, ...skeletonRows(7));
    count.textContent = '';
    if (fresh) clearListingCache();
    try {
      const [files, links] = await Promise.all([listFolder(here, { fresh }), linkItemsIn(here)]);
      if (!alive) return;
      rows = [...files, ...links.map((l) => ({ ...l, kind: 'link', name: l.title, mimeType: 'link', modifiedTime: l.approvedAt?.toDate?.().toISOString() }))];
      paint();
      const want = query.get('file');
      const target = want && rows.find((r) => r.id === want);
      if (target) openPreview({ ...target, path: [] }, { onChanged: () => load(true) });
    } catch (e) {
      if (!alive) return;
      fill(body, emptyState('alert', 'This folder could not be loaded', `${e.message}.`,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => load(true) }, icon('refresh'), 'Try again')));
    }
  }

  function sorted(list) {
    const val = (f) => sort.key === 'date' ? Date.parse(f.modifiedTime || 0) || 0 : sort.key === 'size' ? +(f.size || 0) : (f.name || '').toLowerCase();
    return [...list].sort((a, b) => {
      const af = isFolder(a), bf = isFolder(b);
      if (af !== bf) return af ? -1 : 1;                 // folders always first
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }

  function open(f, i) {
    if (isFolder(f)) navigate(`${hrefFor(ids.length - 1)}/${f.id}`);
    else {
      const rec = recordFor(f.id);    // catalogued? show its record; links and metadata come from the catalogue
      openPreview(rec?.status === 'published' ? { ...toEntry(rec), webContentLink: f.webContentLink, webViewLink: f.webViewLink } : { ...f, root: key, path: [] }, { onChanged: () => load(true) });
    }
  }

  function paint() {
    fill(layoutBtn, icon(layout === 'list' ? 'grid' : 'list'));
    const q = filter.value.trim().toLowerCase();
    const list = sorted(q ? rows.filter((f) => (f.name || '').toLowerCase().includes(q)) : rows);
    if (!list.length) {
      fill(body, q ? emptyState('search', 'Nothing here matches that', 'Try a shorter word, or search the whole archive.',
        h('a', { class: 'btn btn-ghost', href: `#/search?q=${encodeURIComponent(q)}` }, icon('search'), 'Search everywhere'))
        : emptyState('folder', 'This folder is empty', 'Have something that belongs here?', h('a', { class: 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Contribute')));
      count.textContent = '';
      return;
    }
    fill(body, layout === 'grid' ? grid(list) : table(list));
    let folders = 0, bytes = 0;
    for (const f of list) isFolder(f) ? folders++ : (bytes += +(f.size || 0));
    const files = list.length - folders;
    count.textContent = [folders && plural(folders, 'folder'), files && plural(files, 'file'), bytes && fmtSize(bytes)].filter(Boolean).join(' · ');
  }

  function sortHead(label, k, cls = '') {
    const active = sort.key === k;
    return h('th', { class: cls, 'aria-sort': active ? (sort.dir === 1 ? 'ascending' : 'descending') : null },
      h('button', { class: 'sort-btn', type: 'button', onclick: () => {
        sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'name' ? 1 : -1) };
        store.set('acce.sort', sort);
        paint();
      } }, label, active ? icon('chevron', sort.dir === 1 ? 'rot-90' : 'rot-270') : null));
  }

  function table(list) {
    return h('table', { class: 'dir-table' },
      h('thead', {}, h('tr', {}, sortHead('Name', 'name'), sortHead('Modified', 'date', 'col-date'), sortHead('Size', 'size', 'col-size'), h('th', { class: 'col-act' }, h('span', { class: 'sr-only', text: 'Actions' })))),
      h('tbody', {}, list.map((f, i) => {
        const folder = isFolder(f);
        return h('tr', { class: folder ? 'is-folder' : '', style: { '--i': Math.min(i, 20) } },
          h('td', { dataset: { cell: 'name' } },
            h('a', { class: 'file-link', href: folder ? `${hrefFor(ids.length - 1)}/${f.id}` : '#', onclick: (e) => { if (!folder) { e.preventDefault(); open(f, i); } } },
              fileIcon(f), h('span', { class: 'fname', text: f.name }))),
          h('td', { class: 'col-date', text: fmtDate(f.modifiedTime) }),
          h('td', { class: 'col-size', text: folder ? '-' : fmtSize(f.size) }),
          h('td', { class: 'col-act' }, folder || f.kind === 'link' ? null : h('span', { class: 'row-acts' },
            h('button', { class: 'icon-btn sm', type: 'button', title: 'Preview', 'aria-label': `Preview ${f.name}`, onclick: () => open(f, i) }, icon('eye')),
            h('a', { class: 'icon-btn sm', href: downloadUrl(f), target: '_blank', rel: 'noopener', title: 'Download', 'aria-label': `Download ${f.name}` }, icon('download')))));
      })));
  }

  function grid(list) {
    return h('div', { class: 'file-grid' }, list.map((f, i) => {
      const folder = isFolder(f);
      const thumb = !folder && f.thumbnailLink && ['pdf', 'doc', 'slides', 'image', 'sheet', 'video'].includes(kindOf(f))
        ? h('img', { src: f.thumbnailLink, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null;
      return h('a', { class: `tile ${folder ? 'is-folder' : ''}`, style: { '--i': Math.min(i, 24) }, href: folder ? `${hrefFor(ids.length - 1)}/${f.id}` : '#',
        onclick: (e) => { if (!folder) { e.preventDefault(); open(f, i); } } },
        h('div', { class: 'tile-thumb' }, fileIcon(f), thumb),
        h('div', { class: 'tile-name', text: f.name }),
        h('div', { class: 'tile-meta', text: folder ? 'Folder' : [fmtSize(f.size), fmtDate(f.modifiedTime)].filter((x) => x !== '-').join(' · ') }));
    }));
  }

  async function createFolder() {
    const name = await ask({ title: 'New folder', message: 'Created inside the current folder and visible to everyone.', confirm: 'Create', input: 'Folder name', minLength: 1 });
    if (!name) return;
    try { await call('createFolder', { parentId: here, name }); toast('Folder created', 'ok'); load(true); }
    catch (e) { toast(e.message, 'error'); }
  }

  filter.addEventListener('input', paint);
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (document.activeElement === filter && filter.value) { filter.value = ''; paint(); }
    else location.hash = back.getAttribute('href');
  };
  document.addEventListener('keydown', onKey);
  syncCatalog().catch(() => {});   // so previews can show catalogue records
  load();
  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
