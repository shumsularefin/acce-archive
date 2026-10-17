/* ============================================================
   Library: virtual browsing generated from catalogue metadata.
   #/library/<collection>/<value>/<value>/…  where the levels come from
   CONFIG.library (e.g. year/term → course → material type), and
   ?cur=<curriculum> narrows to one curriculum. Nothing here depends on
   Drive folders: re-filing an item is a metadata edit.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fmtSize, fmtSession, plural, emptyState, skeletonRows, fill, debounce } from '../lib/dom.js';
import { loadCatalog, courses, dimsFor, dimValue, dimLabel, toEntry, NONE, DIM_NAME } from '../services/catalog.js';
import { isAdmin } from '../services/firebase.js';
import { openPreview, fileIcon } from './preview.js';

const PAGE = 40;
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

function sortValues(dim, values, cmap) {
  const last = (v) => (v === NONE ? 1 : 0);
  const order = {
    level: (v) => TAXONOMY.levels.indexOf(v),
    type: (v) => Object.keys(TAXONOMY.types).indexOf(v),
    examKind: (v) => Object.keys(TAXONOMY.examKinds).indexOf(v)
  }[dim];
  return values.sort((a, b) => last(a) - last(b)
    || (order ? order(a) - order(b) : 0)
    || (['examYear', 'session'].includes(dim) ? b.localeCompare(a) : dimLabel(dim, a, cmap).localeCompare(dimLabel(dim, b, cmap))));
}

export async function render({ root, params, query }) {
  const col = params[0] || '';
  const segs = (params[1] || '').split('/').filter(Boolean);
  let alive = true, shown = PAGE;
  root.append(h('section', { class: 'page' }, ...skeletonRows(6, 2)));

  const [items, cmap] = await Promise.all([loadCatalog(), courses()]);
  if (!alive) return;
  // Nothing catalogued yet (or no Firebase): the Drive folder view still works.
  if (!items.length) { location.replace(col && CONFIG.folders[col] ? `#/browse/${col}` : '#/'); return; }
  if (!CONFIG.folders[col]) return overview(root, items);

  const dims = dimsFor(col);
  const cur = query.get('cur') || '';
  const inCol = items.filter((i) => i.collection === col);
  const curricula = [...new Set(inCol.flatMap((i) => i.curricula || []))].sort().reverse();
  const scope = inCol.filter((i) => (!cur || (i.curricula || []).includes(cur)) && segs.every((v, k) => dimValue(i, dims[k]) === v));
  const qs = cur ? `?cur=${encodeURIComponent(cur)}` : '';
  const hrefAt = (n) => `#/library/${col}${segs.slice(0, n).map((v) => '/' + encodeURIComponent(v)).join('')}${qs}`;
  const title = segs.length ? dimLabel(dims[segs.length - 1], segs[segs.length - 1], cmap) : CONFIG.folders[col].name;
  document.title = `${title} · ACCE Archive`;

  const curSel = curricula.length ? h('select', { class: 'input input-sm', 'aria-label': 'Curriculum', onchange: (e) => {
    const p = e.target.value;
    location.hash = `#/library/${col}${segs.map((v) => '/' + encodeURIComponent(v)).join('')}${p ? `?cur=${encodeURIComponent(p)}` : ''}`;
  } }, h('option', { value: '', text: 'All curricula' }), curricula.map((c) => h('option', { value: c, text: c }))) : null;
  if (curSel) curSel.value = cur;
  const filter = h('input', { class: 'input input-sm filter', type: 'search', placeholder: 'Filter here', 'aria-label': 'Filter items', dataset: { slashTarget: '1' } });

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Library path' },
    h('a', { href: '#/library', text: 'Library' }),
    [CONFIG.folders[col].name, ...segs.map((v, k) => dimLabel(dims[k], v, cmap))].flatMap((label, i, all) => [
      h('span', { class: 'sep', 'aria-hidden': 'true' }, icon('chevron')),
      i === all.length - 1 ? h('b', { text: label, 'aria-current': 'page' }) : h('a', { href: hrefAt(i), text: label })]));

  const groupsBox = h('div');
  const listBox = h('div', { class: 'results' });
  const listHead = h('div', { class: 'results-head' });

  fill(root, h('section', { class: 'page library' },
    h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: segs.length ? DIM_NAME[dims[segs.length - 1]] : 'Collection' }), h('h1', { text: title }),
      h('p', { class: 'muted', text: `${plural(scope.length, 'item')}${cur ? ` in ${cur}` : ''}. Organised from catalogue records, so each item can sit under every curriculum it belongs to.` })),
    h('div', { class: 'browser-bar glass' }, crumbs, h('div', { class: 'bar-tools' }, curSel, filter,
      h('a', { class: 'btn btn-quiet btn-sm', href: `#/browse/${col}`, title: 'The original Google Drive folders' }, icon('folder'), 'Folders'))),
    groupsBox, listHead, listBox));

  /* next level */
  if (segs.length < dims.length) {
    const dim = dims[segs.length];
    const counts = new Map();
    for (const i of scope) { const v = dimValue(i, dim); counts.set(v, (counts.get(v) || 0) + 1); }
    const values = sortValues(dim, [...counts.keys()], cmap);
    if (values.length > 1 || (values.length === 1 && values[0] !== NONE)) {
      fill(groupsBox, h('div', { class: 'section-head tight' }, h('h2', { text: `By ${DIM_NAME[dim].toLowerCase()}` })),
        h('div', { class: 'lib-groups' }, values.map((v, i) => h('a', { class: `lib-group ${v === NONE ? 'is-none' : ''}`, style: { '--i': Math.min(i, 24) },
          href: `#/library/${col}${[...segs, v].map((x) => '/' + encodeURIComponent(x)).join('')}${qs}` },
        h('span', { class: 'lg-ic' }, icon({ level: 'layers', courseCode: 'book', type: 'tag', examYear: 'clock', examKind: 'question', session: 'clock' }[dim] || 'folder')),
        h('span', { class: 'lg-main' }, h('span', { class: 'lg-name', text: dimLabel(dim, v, cmap) }), h('span', { class: 'lg-count', text: plural(counts.get(v), 'item') })),
        icon('chevron')))));
    }
  }

  /* items at this level */
  function paintList() {
    const q = filter.value.trim().toLowerCase();
    const list = scope.filter((i) => !q || `${i.title} ${i.file?.name || ''} ${i.courseCode} ${(i.tags || []).join(' ')} ${i.instructors}`.toLowerCase().includes(q))
      .sort((a, b) => (b.examYear || 0) - (a.examYear || 0) || a.title.localeCompare(b.title));
    const atLeaf = segs.length >= dims.length;
    fill(listHead, h('h2', { class: 'h-sub', text: atLeaf ? 'Items' : `Everything in ${title}` }), h('span', { class: 'muted small', text: plural(list.length, 'item') }));
    if (!list.length) { fill(listBox, emptyState('search', q ? 'Nothing matches that filter' : 'Nothing here yet', q ? '' : 'Have something that belongs here?', q ? null : h('a', { class: 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Upload'))); return; }
    fill(listBox, ...list.slice(0, shown).map((it, i) => row(it, i)),
      list.length > shown ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => { shown += PAGE; paintList(); } }, `Show more (${list.length - shown} left)`) : null);
  }

  function row(it, i) {
    const e = toEntry(it, cmap);
    const meta = [TAXONOMY.types[it.type], it.courseCode, it.examYear || fmtSession(it.session), it.file?.size ? fmtSize(it.file.size) : it.kind === 'link' ? 'Link' : ''].filter(Boolean);
    return h('a', { class: 'result', href: `#/file/${encodeURIComponent(it.id)}`, style: { '--i': Math.min(i, 20) }, onclick: (ev) => { ev.preventDefault(); openPreview(e, { onChanged: rerender }); } },
      fileIcon(e),
      h('div', { class: 'result-main' },
        h('div', { class: 'result-name', text: it.title }),
        h('div', { class: 'result-path', text: meta.join(' · ') })),
      h('div', { class: 'result-meta' },
        (it.curricula || []).slice(0, 2).map((c) => h('span', { class: 'pill pill-quiet', text: c })),
        isAdmin() && it.curated === false ? h('span', { class: 'pill pill-warn', title: 'Details were inferred on import', text: 'Needs review' }) : null));
  }

  filter.addEventListener('input', debounce(() => { shown = PAGE; paintList(); }, 120));
  paintList();

  const want = query.get('item');
  const target = want && items.find((i) => i.id === want);
  if (target) openPreview(toEntry(target, cmap), { onChanged: rerender });
  return () => { alive = false; };
}

function overview(root, items) {
  const by = {};
  for (const i of items) by[i.collection] = (by[i.collection] || 0) + 1;
  fill(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'Library' }), h('h1', { text: 'Browse the catalogue' }),
      h('p', { class: 'muted', text: `${plural(items.length, 'item')} across ${Object.keys(by).length} collections.` })),
    h('div', { class: 'lib-groups' }, Object.entries(CONFIG.folders).map(([k, f], i) => h('a', { class: 'lib-group', href: `#/library/${k}`, style: { '--i': i } },
      h('span', { class: 'lg-ic' }, icon('layers')), h('span', { class: 'lg-main' }, h('span', { class: 'lg-name', text: f.name }), h('span', { class: 'lg-count', text: plural(by[k] || 0, 'item') })), icon('chevron'))))));
}
