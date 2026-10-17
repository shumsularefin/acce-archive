/* ============================================================
   Landing page: hero search, collections, archive stats, recent additions.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fmtSize, relTime, plural, fill } from '../lib/dom.js';
import { getIndex, cachedIndex } from '../services/drive.js';
import { loadCatalog, catalogStamp, courses, toEntry } from '../services/catalog.js';
import { fb } from '../services/firebase.js';
import { student } from '../services/student.js';
import { openPreview, fileIcon } from './preview.js';

const COLLECTION_UI = {
  bsc:   { ic: 'book',     text: 'Course books, lecture material and papers for the undergraduate programme.' },
  msc:   { ic: 'cap',      text: 'Thesis work, advanced texts and graduate coursework.' },
  qbank: { ic: 'question', text: 'Term finals, in-course and viva questions sorted by year.' },
  misc:  { ic: 'flask',    text: 'Forms, notices, software, lab manuals and everything else.' }
};

export function render({ root, navigate }) {
  let alive = true;
  const first = (fb.profile?.displayName || fb.user?.displayName || student.get()?.name || '').split(' ')[0];

  const q = h('input', { class: 'hero-input', type: 'search', placeholder: 'Search books, courses, question papers…', 'aria-label': 'Search the archive', enterkeyhint: 'search' });
  const form = h('form', { class: 'hero-search glass', role: 'search', onsubmit: (e) => { e.preventDefault(); navigate(`#/search?q=${encodeURIComponent(q.value.trim())}`); } },
    icon('search'), q, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Search' }));

  const quick = h('div', { class: 'chip-row hero-chips' },
    ['question', 'lecture', 'book', 'lab', 'thesis'].map((t) =>
      h('a', { class: 'chip chip-link', href: `#/search?type=${t}`, text: TAXONOMY.types[t] })));

  const stats = h('div', { class: 'stats' });
  const shelf = h('div', { class: 'shelf' }, Object.entries(CONFIG.folders).map(([key, f]) => {
    const ui = COLLECTION_UI[key] || { ic: 'folder', text: '' };
    return h('a', { class: 'program-box', href: `#/browse/${key}`, dataset: { key } },
      h('div', { class: 'pb-top' }, h('span', { class: 'pb-glyph' }, icon(ui.ic)), h('span', { class: 'pb-count', dataset: { count: key } })),
      h('h3', { text: f.name }), h('p', { text: ui.text }),
      h('span', { class: 'pb-go' }, 'Open', icon('chevron')));
  }));
  const recent = h('div', { class: 'recent-list' }, Array.from({ length: 5 }, () => h('div', { class: 'sk-row' }, h('span', { style: { width: '60%' } }))));

  root.append(h('section', { class: 'page home' },
    h('div', { class: 'hero' },
      h('div', { class: 'watermark watermark-page', 'aria-hidden': 'true' }),
      h('span', { class: 'eyebrow', text: first ? `Welcome back, ${first}` : 'Departmental archive' }),
      h('h1', { class: 'hero-title' }, 'Everything ACCE, ', h('em', { text: 'in one archive.' })),
      h('p', { class: 'hero-sub', text: 'Lecture notes, reference books, past questions, lab manuals and theses from every batch of Applied Chemistry & Chemical Engineering, GSTU.' }),
      form, quick, stats),
    h('div', { class: 'section-head' }, h('h2', { text: 'Collections' }), h('a', { class: 'link', href: '#/search', text: 'Search everything' })),
    shelf,
    h('div', { class: 'home-split' },
      h('div', { class: 'card glass' },
        h('div', { class: 'section-head tight' }, h('h2', {}, icon('sparkle'), 'Recently added'), h('a', { class: 'link', href: '#/search?sort=new', text: 'See all' })),
        recent),
      h('div', { class: 'card glass contribute-card' },
        h('h2', {}, icon('upload'), 'Help the archive grow'),
        h('p', { class: 'muted', text: 'Have notes, slides, a question paper or a thesis that the next batch should have? Send it in. A reviewer checks every submission before it goes public.' }),
        h('ol', { class: 'steps' },
          h('li', {}, h('b', { text: 'Submit' }), h('span', { text: 'Upload a file or share a link with a few details.' })),
          h('li', {}, h('b', { text: 'Review' }), h('span', { text: 'Archive staff check it is genuine and relevant.' })),
          h('li', {}, h('b', { text: 'Publish' }), h('span', { text: 'It is filed in the right folder for everyone.' }))),
        h('a', { class: 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Contribute material')))));

  const paint = (idx) => {
    if (!alive) return;
    const byRoot = {};
    let bytes = 0;
    for (const f of idx.files) { byRoot[f.root] = (byRoot[f.root] || 0) + 1; bytes += f.size; }
    root.querySelectorAll('[data-count]').forEach((el) => { el.textContent = plural(byRoot[el.dataset.count] || 0, idx.catalog ? 'item' : 'file'); });
    if (idx.catalog) root.querySelectorAll('.program-box').forEach((a) => { a.href = `#/library/${a.dataset.key}`; });
    fill(stats,
      stat(idx.files.length.toLocaleString(), idx.catalog ? 'items' : 'files'),
      idx.catalog ? stat(idx.courses.toLocaleString(), 'courses') : stat((idx.folders.length - Object.keys(CONFIG.folders).length).toLocaleString(), 'folders'),
      stat(fmtSize(bytes), 'of material'),
      stat(relTime(idx.t) || 'now', idx.catalog ? 'last updated' : 'last indexed'));
    const latest = [...idx.files].sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || '')).slice(0, 7);
    fill(recent, ...(latest.length ? latest.map((f) => h('button', { class: 'recent-row', type: 'button', onclick: () => openPreview(f) },
      fileIcon(f), h('span', { class: 'rr-main' }, h('span', { class: 'rr-name', text: f.name }), h('span', { class: 'rr-path', text: f.path.join(' / ') })),
      h('span', { class: 'rr-when', text: relTime(f.createdTime) }))) : [h('p', { class: 'muted', text: 'Nothing indexed yet.' })]));
  };

  const fromDrive = () => {
    const cached = cachedIndex();
    if (cached) return paint(cached);
    fill(stats, h('div', { class: 'stat stat-loading' }, h('span', { class: 'spinner' }), h('span', { text: 'Indexing the archive…' })));
    getIndex({ onProgress: (p) => { if (alive) fill(stats.querySelector('.stat-loading span:last-child'), `Indexing the archive… ${p.files.toLocaleString()} files`); } })
      .then(paint)
      .catch(() => { if (alive) { fill(stats); fill(recent, h('p', { class: 'muted', text: 'Could not load recent additions.' })); } });
  };

  // The catalogue is the source of truth once it exists; until then, crawl the Drive folders.
  Promise.all([loadCatalog(), courses()]).then(([items, cmap]) => {
    if (!alive) return;
    if (!items.length) return fromDrive();
    const files = items.map((i) => toEntry(i, cmap));
    paint({ catalog: true, files, t: catalogStamp(), courses: new Set(items.map((i) => i.courseCode).filter(Boolean)).size });
  }).catch(fromDrive);
  return () => { alive = false; };
}

const stat = (value, label) => h('div', { class: 'stat' }, h('strong', { text: value }), h('span', { text: label }));
