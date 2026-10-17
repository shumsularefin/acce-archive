/* ============================================================
   Command-palette style quick search ( / or Ctrl+K ).
   ============================================================ */
import { h, icon, modal, fill } from '../lib/dom.js';
import { search, highlight } from '../lib/search.js';
import { openPreview, fileIcon } from './preview.js';

export async function openQuickSearch() {
  if (document.querySelector('.modal-qs')) return;
  const input = h('input', { class: 'qs-input', type: 'search', placeholder: 'Search the whole archive…', 'aria-label': 'Search', autocomplete: 'off' });
  const list = h('div', { class: 'qs-list', role: 'listbox' }, h('p', { class: 'muted small qs-hint', text: 'Loading the index…' }));
  const m = modal({
    title: 'Search',
    className: 'modal-qs',
    body: h('div', {}, h('div', { class: 'qs-bar' }, icon('search'), input, h('kbd', { text: 'Esc' })), list,
      h('div', { class: 'qs-foot' }, h('span', {}, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' to move'), h('span', {}, h('kbd', { text: 'Enter' }), ' to open'), h('a', { href: '#/search', class: 'link', text: 'Advanced search', onclick: () => m.close() })))
  });
  input.focus();

  let docs = [], hits = [], sel = 0;
  const { loadDocs } = await import('./search.js');
  try { docs = (await loadDocs(false)).docs; } catch (e) { fill(list, h('p', { class: 'muted small qs-hint', text: e.message })); return; }
  draw();

  function draw() {
    const q = input.value.trim();
    if (!q) { fill(list, h('p', { class: 'muted small qs-hint', text: `Type to search ${docs.length.toLocaleString()} files. Try a course code, a teacher or a year.` })); hits = []; return; }
    const r = search(docs, q);
    hits = r.results.slice(0, 8);
    sel = Math.min(sel, Math.max(hits.length - 1, 0));
    if (!hits.length) { fill(list, h('p', { class: 'muted small qs-hint', text: 'No matches.' })); return; }
    fill(list, ...hits.map((d, i) => h('button', {
      type: 'button', class: 'qs-item', role: 'option', 'aria-selected': String(i === sel),
      onmouseenter: () => { sel = i; mark(); }, onclick: () => choose(i)
    }, fileIcon(d.f), h('span', { class: 'qs-main' },
      h('span', { class: 'qs-name' }, highlight(d.f.properties?.acce_title || d.f.name, r.tokens).map((p) => (p.hit ? h('mark', { text: p.text }) : p.text))),
      h('span', { class: 'qs-path', text: d.f.path.join(' / ') })))),
    r.results.length > 8 ? h('a', { class: 'qs-more', href: `#/search?q=${encodeURIComponent(q)}`, onclick: () => m.close() }, `See all ${r.results.length.toLocaleString()} results`, icon('chevron')) : '');
  }
  const mark = () => list.querySelectorAll('.qs-item').forEach((el, i) => el.setAttribute('aria-selected', String(i === sel)));
  const choose = (i) => { const d = hits[i]; if (!d) return; m.close(); openPreview(d.f); };

  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, hits.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits.length) choose(sel);
      else if (input.value.trim()) { m.close(); location.hash = `#/search?q=${encodeURIComponent(input.value.trim())}`; }
    }
  });
}
