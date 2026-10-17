/* ============================================================
   Whole-archive search with facets (collection, format, type, year).
   State lives in the URL so results can be shared.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fmtSize, fmtDate, debounce, relTime, emptyState, plural, fill } from '../lib/dom.js';
import { getIndex, KIND_LABEL } from '../services/drive.js';
import { allLinkItems } from '../services/firebase.js';
import { buildDocs, search, facets, highlight } from '../lib/search.js';
import { openPreview, fileIcon } from './preview.js';

const PAGE = 40;
let docsCache = null, docsStamp = 0;

async function loadDocs(fresh, onProgress) {
  const [idx, links] = await Promise.all([getIndex({ fresh, onProgress }), allLinkItems()]);
  if (!docsCache || fresh || docsStamp !== idx.t) { docsCache = buildDocs(idx, links); docsStamp = idx.t; }
  return { docs: docsCache, idx };
}
export { loadDocs };

export function render({ root, query }) {
  let alive = true, docs = [], idxTime = 0, shown = PAGE;
  const state = {
    q: query.get('q') || '', root: query.get('c') || '', kind: query.get('k') || '',
    type: query.get('type') || '', year: query.get('y') || '', sort: query.get('sort') || 'rel'
  };

  const input = h('input', { class: 'hero-input', type: 'search', value: state.q, placeholder: 'Course code, title, teacher, year…', 'aria-label': 'Search', enterkeyhint: 'search', dataset: { slashTarget: '1' } });
  const sortSel = h('select', { class: 'input input-sm', 'aria-label': 'Sort results', onchange: () => { state.sort = sortSel.value; update(); } },
    h('option', { value: 'rel', text: 'Best match' }), h('option', { value: 'new', text: 'Newest first' }), h('option', { value: 'name', text: 'Name A–Z' }));
  sortSel.value = state.sort;
  const facetBox = h('aside', { class: 'facets glass' });
  const results = h('div', { class: 'results' });
  const summary = h('div', { class: 'results-head' });
  const reindex = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => boot(true) }, icon('refresh'), 'Re-index');

  root.append(h('section', { class: 'page search-page' },
    h('form', { class: 'hero-search glass', role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); } }, icon('search'), input),
    h('div', { class: 'search-layout' }, facetBox, h('div', {}, summary, results))));

  input.addEventListener('input', debounce(() => { state.q = input.value; update(); }, 140));
  input.focus();

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.root) p.set('c', state.root);
    if (state.kind) p.set('k', state.kind);
    if (state.type) p.set('type', state.type);
    if (state.year) p.set('y', state.year);
    if (state.sort !== 'rel') p.set('sort', state.sort);
    history.replaceState(null, '', `#/search${p.toString() ? '?' + p : ''}`);
  }

  function update() {
    shown = PAGE;
    syncUrl();
    paint();
  }

  function paint() {
    const base = search(docs, state.q, {}, state.sort);
    const { tokens, results: list } = search(docs, state.q, state, state.sort);
    drawFacets(facets(base.results));
    fill(summary, 
      h('p', {}, h('strong', { text: list.length.toLocaleString() }), ` result${list.length === 1 ? '' : 's'}`,
        state.q ? [' for ', h('q', { text: state.q })] : null,
        h('span', { class: 'muted small', text: ` · indexed ${relTime(idxTime)}` })),
      h('div', { class: 'results-tools' }, sortSel, reindex));
    if (!list.length) {
      fill(results, emptyState('search', 'No matches', 'Try fewer words, a course code like ACCE-3101, or clear the filters.',
        h('a', { class: 'btn btn-ghost', href: '#/submit' }, icon('upload'), 'Missing something? Contribute it')));
      return;
    }
    fill(results, ...list.slice(0, shown).map((d, i) => resultRow(d, tokens, i)),
      list.length > shown ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => { shown += PAGE; paint(); } }, `Show more (${(list.length - shown).toLocaleString()} left)`) : null);
  }

  function resultRow(d, tokens, i) {
    const f = d.f;
    const title = f.properties?.acce_title;
    const href = f.kind === 'link' ? '#' : `#/file/${f.id}`;
    return h('a', { class: 'result', href, style: { '--i': Math.min(i, 20) }, onclick: (e) => { e.preventDefault(); openPreview(f); } },
      fileIcon(f),
      h('div', { class: 'result-main' },
        h('div', { class: 'result-name' }, marked(title || f.name, tokens)),
        title ? h('div', { class: 'result-sub', text: f.name }) : null,
        h('div', { class: 'result-path' }, marked(f.path.join(' / '), tokens))),
      h('div', { class: 'result-meta' },
        d.type ? h('span', { class: 'pill', text: TAXONOMY.types[d.type] }) : h('span', { class: 'pill pill-quiet', text: KIND_LABEL[d.kind] }),
        h('span', { class: 'muted small', text: [f.size ? fmtSize(f.size) : '', fmtDate(f.modifiedTime || f.createdTime)].filter((x) => x && x !== '-').join(' · ') })));
  }

  const marked = (text, tokens) => highlight(text, tokens).map((p) => (p.hit ? h('mark', { text: p.text }) : p.text));

  function drawFacets(fc) {
    const group = (label, key, entries, names) => {
      if (!entries.length) return null;
      return h('div', { class: 'facet' }, h('h4', { text: label }),
        h('div', { class: 'facet-opts' }, entries.map(([k, n]) => h('button', {
          type: 'button', class: 'facet-opt', 'aria-pressed': String(state[key] === k),
          onclick: () => { state[key] = state[key] === k ? '' : k; update(); }
        }, h('span', { text: names ? names[k] || k : k }), h('b', { text: n.toLocaleString() })))));
    };
    const order = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    const any = state.root || state.kind || state.type || state.year;
    fill(facetBox, 
      h('div', { class: 'facet-head' }, h('h3', {}, icon('settings'), 'Refine'),
        any ? h('button', { class: 'link-btn', type: 'button', text: 'Clear', onclick: () => { state.root = state.kind = state.type = state.year = ''; update(); } }) : null),
      group('Collection', 'root', order(fc.root), Object.fromEntries(Object.entries(CONFIG.folders).map(([k, v]) => [k, v.name]))),
      group('Material', 'type', order(fc.type), TAXONOMY.types),
      group('Format', 'kind', order(fc.kind), KIND_LABEL),
      group('Year', 'year', Object.entries(fc.year).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)));
  }

  async function boot(fresh = false) {
    fill(results, h('div', { class: 'stat stat-loading' }, h('span', { class: 'spinner' }), h('span', { class: 'prog', text: 'Building the search index…' })));
    try {
      const out = await loadDocs(fresh, (p) => { if (alive) fill(results.querySelector('.prog'), `Indexed ${plural(p.files, 'file')} in ${plural(p.folders, 'folder')}…`); });
      if (!alive) return;
      docs = out.docs; idxTime = out.idx.t;
      paint();
    } catch (e) {
      if (alive) fill(results, emptyState('alert', 'Search is unavailable', e.message, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => boot(true) }, 'Try again')));
    }
  }
  boot();
  return () => { alive = false; };
}
