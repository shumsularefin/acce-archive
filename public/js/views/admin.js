/* ============================================================
   Staff dashboard.
   reviewer: overview, review queue, submissions, reports, activity
   admin:    + courses catalogue, contributors, maintenance
   owner:    + team roles, site settings
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fmtSize, fmtDate, relTime, plural, toast, ask, modal, emptyState, skeletonRows, copyText, fill } from '../lib/dom.js';
import { fb, fs, docs, isAdmin, isOwner } from '../services/firebase.js';
import { call, backendReady } from '../services/backend.js';
import { listFolder, isFolder, previewUrl, getIndex, cachedIndex, clearListingCache } from '../services/drive.js';
import { buildDocs, search } from '../lib/search.js';
import { buildMetaForm } from './metaform.js';
import { statusPill, STATUS } from './my.js';
import { fileIcon, openPreview } from './preview.js';

const TABS = [
  { key: 'overview', label: 'Overview', ic: 'chart' },
  { key: 'review', label: 'Review queue', ic: 'inbox' },
  { key: 'submissions', label: 'Submissions', ic: 'layers' },
  { key: 'reports', label: 'Reports', ic: 'flag' },
  { key: 'courses', label: 'Courses', ic: 'book', admin: true },
  { key: 'people', label: 'People', ic: 'users', admin: true },
  { key: 'settings', label: 'Settings', ic: 'settings', admin: true },
  { key: 'activity', label: 'Activity', ic: 'activity' }
];

export function render({ root, params, navigate }) {
  const tabs = TABS.filter((t) => !t.admin || isAdmin());
  const tab = tabs.find((t) => t.key === params[0])?.key || 'overview';
  const panel = h('div', { class: 'admin-panel' });
  const cleanups = [];

  root.append(h('section', { class: 'page admin' },
    h('div', { class: 'page-head row-between' },
      h('div', {}, h('span', { class: 'eyebrow', text: `Dashboard · ${fb.role}` }), h('h1', { text: tabs.find((t) => t.key === tab).label })),
      backendReady() ? null : h('span', { class: 'pill pill-warn' }, icon('alert'), 'Backend not connected')),
    h('div', { class: 'admin-layout' },
      h('nav', { class: 'admin-tabs glass', 'aria-label': 'Dashboard sections' }, tabs.map((t) =>
        h('a', { href: `#/admin/${t.key}`, class: t.key === tab ? 'active' : '', 'aria-current': t.key === tab ? 'page' : null }, icon(t.ic), h('span', { text: t.label }),
          t.key === 'review' ? h('b', { class: 'tab-count', id: 'q-count' }) : null))),
      panel)));

  const F = fs();
  // live queue size for the tab badge
  cleanups.push(F.onSnapshot(F.query(F.collection(fb.db, 'submissions'), F.where('status', '==', 'pending')), (s) => {
    const el = root.querySelector('#q-count'); if (el) el.textContent = s.size || '';
  }, () => {}));

  const ctx = { panel, navigate, F, sub: params[1], add: (fn) => cleanups.push(fn) };
  ({ overview, review, submissions, reports, courses, people, settings, activity })[tab](ctx);
  return () => cleanups.forEach((fn) => { try { fn(); } catch {} });
}

/* ================= overview ================= */
async function overview({ panel, F }) {
  const tiles = h('div', { class: 'tiles' }, ['pending', 'approved', 'rejected', 'reports'].map((k) => tile(k, '…')));
  const storage = h('div', { class: 'card glass' }, h('h2', {}, icon('database'), 'Drive storage'), ...skeletonRows(2, 1));
  const breakdown = h('div', { class: 'card glass' }, h('h2', {}, icon('layers'), 'Archive by collection'), ...skeletonRows(4, 2));
  const largest = h('div', { class: 'card glass' }, h('h2', {}, icon('archive'), 'Largest files'), ...skeletonRows(5, 2));
  const recent = h('div', { class: 'card glass' }, h('h2', {}, icon('activity'), 'Recent activity'), ...skeletonRows(5, 2));
  panel.append(tiles, h('div', { class: 'grid-2 gap' }, storage, breakdown), h('div', { class: 'grid-2 gap' }, largest, recent));

  if (backendReady()) {
    call('stats').then((s) => {
      fill(tiles, tile('pending', s.counts.pending, '#/admin/review'), tile('approved', s.counts.approved), tile('rejected', s.counts.rejected), tile('reports', s.counts.reports, '#/admin/reports'));
      fill(storage, h('h2', {}, icon('database'), 'Drive storage'), storageMeter(s.storage));
    }).catch((e) => fill(storage, h('h2', {}, icon('database'), 'Drive storage'), h('p', { class: 'danger', text: e.message })));
  } else {
    fill(storage, h('h2', {}, icon('database'), 'Drive storage'), h('p', { class: 'muted', text: 'Connect the Apps Script backend (CONFIG.backendUrl) to see storage and run reviews.' }));
    fill(tiles, ...['pending', 'approved', 'rejected', 'reports'].map((k) => tile(k, '-')));
  }

  getIndex().then((idx) => {
    const by = {};
    for (const f of idx.files) { const b = (by[f.root] ||= { n: 0, bytes: 0 }); b.n++; b.bytes += f.size; }
    const total = Object.values(by).reduce((a, b) => a + b.bytes, 0) || 1;
    fill(breakdown, h('h2', {}, icon('layers'), 'Archive by collection'),
      h('div', { class: 'bars' }, Object.entries(CONFIG.folders).map(([k, f]) => {
        const b = by[k] || { n: 0, bytes: 0 };
        return h('div', { class: 'bar-row' }, h('span', { text: f.name }), h('div', { class: 'bar' }, h('span', { style: { width: `${(b.bytes / total) * 100}%` } })), h('b', { text: `${fmtSize(b.bytes)} · ${b.n}` }));
      })),
      h('p', { class: 'muted small', text: `${plural(idx.files.length, 'file')} · ${fmtSize(total)} public · indexed ${relTime(idx.t)}` }));
    const top = [...idx.files].sort((a, b) => b.size - a.size).slice(0, 6);
    fill(largest, h('h2', {}, icon('archive'), 'Largest files'),
      h('div', { class: 'mini-list' }, top.map((f) => h('button', { type: 'button', class: 'mini-row', onclick: () => openPreview(f) }, fileIcon(f), h('span', { class: 'ellipsis', text: f.name }), h('b', { text: fmtSize(f.size) })))),
      h('p', { class: 'fine', text: 'Big scans can often be re-saved at 150 dpi greyscale for a fraction of the size.' }));
  }).catch(() => {});

  try {
    const snap = await F.getDocs(F.query(F.collection(fb.db, 'audit'), F.orderBy('at', 'desc'), F.limit(8)));
    const rows = docs(snap);
    fill(recent, h('h2', {}, icon('activity'), 'Recent activity'), rows.length ? auditList(rows) : h('p', { class: 'muted', text: 'Nothing yet.' }),
      h('a', { class: 'link', href: '#/admin/activity', text: 'Full activity log' }));
  } catch (e) { recent.append(h('p', { class: 'danger small', text: e.message })); }
}

function tile(k, value, href) {
  const meta = { pending: ['In review', 'clock', 'warn'], approved: ['Published', 'check', 'ok'], rejected: ['Declined', 'x', 'bad'], reports: ['Open reports', 'flag', 'warn'] }[k];
  return h(href ? 'a' : 'div', { class: `tile-stat card glass t-${meta[2]}`, href },
    h('span', { class: 'ts-ic' }, icon(meta[1])), h('strong', { text: String(value) }), h('span', { text: meta[0] }));
}

function storageMeter(q) {
  if (!q.limit) return h('p', { class: 'muted', text: `${fmtSize(q.usage)} used · unlimited or pooled storage.` });
  const pct = (n) => Math.min((n / q.limit) * 100, 100);
  const drive = q.usageInDrive - q.usageInDriveTrash, trash = q.usageInDriveTrash, other = Math.max(q.usage - q.usageInDrive, 0);
  const used = q.usage / q.limit;
  const sz = (n) => (n ? fmtSize(n) : '0 B');
  const level = used > 0.9 ? 'bad' : used > 0.75 ? 'warn' : 'ok';
  return h('div', { class: 'storage' },
    h('div', { class: 'storage-top' }, h('strong', { text: `${(used * 100).toFixed(1)}%` }), h('span', { class: 'muted', text: `${fmtSize(q.usage)} of ${fmtSize(q.limit)} · ${fmtSize(q.limit - q.usage)} free` })),
    h('div', { class: `meter m-${level}` },
      h('span', { class: 'seg-drive', style: { width: `${pct(drive)}%` }, title: `Drive files ${fmtSize(drive)}` }),
      h('span', { class: 'seg-trash', style: { width: `${pct(trash)}%` }, title: `Trash ${sz(trash)}` }),
      h('span', { class: 'seg-other', style: { width: `${pct(other)}%` }, title: `Gmail & Photos ${sz(other)}` })),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'seg-drive' }), `Drive ${sz(drive)}`),
      h('span', {}, h('i', { class: 'seg-trash' }), `Trash ${sz(trash)}`),
      h('span', {}, h('i', { class: 'seg-other' }), `Gmail & Photos ${sz(other)}`)),
    level !== 'ok' ? h('p', { class: `note ${level === 'bad' ? 'danger' : ''}`, text: level === 'bad'
      ? 'Storage is nearly full. New uploads stop automatically at the reserve limit. Empty the Drive trash, compress large scans, or move a collection to a second account (see docs/STORAGE.md).'
      : 'Storage is filling up. Review the largest files and empty the Drive trash.' }) : null);
}

/* ================= review queue ================= */
function review({ panel, F, sub, navigate, add }) {
  const listEl = h('div', { class: 'queue-list glass' }, ...skeletonRows(5, 1));
  const detail = h('div', { class: 'review-detail' });
  panel.append(h('div', { class: 'review-layout' }, listEl, detail));
  let items = [];

  add(F.onSnapshot(F.query(F.collection(fb.db, 'submissions'), F.where('status', '==', 'pending'), F.orderBy('createdAt', 'desc'), F.limit(200)), (snap) => {
    items = docs(snap);
    fill(listEl, ...(items.length ? items.map((s) => h('a', {
      class: `queue-row ${s.id === sub ? 'active' : ''}`, href: `#/admin/review/${s.id}`
    }, h('span', { class: `ficon k-${s.kind === 'link' ? 'link' : 'file'}` }, icon(s.kind === 'link' ? 'link' : 'file')),
    h('span', { class: 'qr-main' }, h('span', { class: 'qr-title', text: s.meta?.title || '(untitled)' }),
      h('span', { class: 'qr-sub', text: `${s.name} · ${relTime(s.createdAt)}` })))) : [emptyState('check', 'All caught up', 'No submissions are waiting for review.')]));
    if (!sub && items[0] && matchMedia('(min-width: 900px)').matches) navigate(`#/admin/review/${items[0].id}`);
    if (sub && !detail.childElementCount) showDetail();
  }, (e) => fill(listEl, h('p', { class: 'danger', text: e.message }))));

  async function showDetail() {
    if (!sub) { fill(detail, emptyState('inbox', 'Pick a submission', 'Select an item from the queue to review it.')); return; }
    const snap = await F.getDoc(F.doc(fb.db, 'submissions', sub));
    if (!snap.exists()) { fill(detail, emptyState('alert', 'Not found', 'This submission no longer exists.')); return; }
    const s = { id: snap.id, ...snap.data() };
    if (s.status !== 'pending') { fill(detail, submissionSummary(s)); return; }
    fill(detail, await reviewForm(s, () => {
      const next = items.find((i) => i.id !== s.id);
      navigate(next ? `#/admin/review/${next.id}` : '#/admin/review');
    }));
  }
  if (!sub) showDetail();
}

async function reviewForm(s, onDone) {
  const m = s.meta || {};
  const isFile = s.kind !== 'link';
  const ext = isFile ? s.file.name.split('.').pop().toLowerCase() : '';

  const previewBox = isFile
    ? h('div', { class: 'pv-frame loading' }, h('iframe', { src: previewUrl(s.file.driveId), title: 'Submission preview', referrerpolicy: 'no-referrer', onload: (e) => e.target.parentElement.classList.remove('loading') }), h('span', { class: 'spinner' }))
    : h('div', { class: 'pv-none' }, icon('link'), h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer', class: 'link', text: s.link }));

  const form = await buildMetaForm({ initial: m, staff: true, onCourse: (code) => suggestFrom(code) });
  const picker = folderPicker(m.collection);
  const newFolder = h('input', { class: 'input', placeholder: 'Optional: create a subfolder here, e.g. ACCE-3101 Thermodynamics', maxlength: 100 });
  const fileName = h('input', { class: 'input mono', maxlength: 160, value: isFile ? suggestedName(m, ext, s.file.name) : '', disabled: !isFile });
  const note = h('textarea', { class: 'input', rows: 2, maxlength: 1000, placeholder: 'Message to the contributor (required when declining)' });
  const approve = h('button', { class: 'btn btn-primary', type: 'button' }, icon('check'), 'Approve & publish');
  const reject = h('button', { class: 'btn btn-danger', type: 'button' }, icon('x'), 'Decline');
  const similar = h('div', { class: 'mini-list' });

  form.fields.collection.addEventListener('change', () => picker.reset(form.fields.collection.value));

  async function suggestFrom(code) {
    if (!code) return;
    const F = fs();
    try {
      const c = await F.getDoc(F.doc(fb.db, 'courses', code));
      const d = c.exists() && c.data().destinations?.[form.fields.collection.value];
      if (d) picker.suggest(d.folderId, d.path);
    } catch {}
  }
  suggestFrom(m.courseCode);

  // near-duplicates by title words, from the public index
  (async () => {
    const idx = cachedIndex() || await getIndex().catch(() => null);
    if (!idx) return;
    const words = (m.title || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(' ');
    const hits = words ? search(buildDocs(idx), words).results.slice(0, 5) : [];
    fill(similar, ...(hits.length ? hits.map((d) => h('button', { type: 'button', class: 'mini-row', onclick: () => openPreview(d.f) }, fileIcon(d.f), h('span', { class: 'ellipsis', text: `${d.f.path.slice(-1)[0]} / ${d.f.name}` }))) : [h('p', { class: 'muted small', text: 'No similar titles found.' })]));
  })();

  const run = async (decision) => {
    let meta;
    if (decision === 'approve') {
      try { meta = form.read(); } catch (e) { return toast(e.message, 'error'); }
      if (!picker.value()) return toast('Choose the destination folder.', 'error');
    } else if (note.value.trim().length < 5) { note.focus(); return toast('Tell the contributor why it was declined.', 'error'); }
    approve.disabled = reject.disabled = true;
    try {
      const out = await call('review', { submissionId: s.id, decision, note: note.value.trim(), meta, folderId: picker.value(), newFolderName: newFolder.value.trim(), fileName: fileName.value.trim() });
      toast(decision === 'approve' ? `Published to ${out.published.folderPath}` : 'Declined - the contributor has been told why', 'ok', 5000);
      clearListingCache();
      onDone();
    } catch (e) { toast(e.message, 'error', 7000); approve.disabled = reject.disabled = false; }
  };
  approve.onclick = () => run('approve');
  reject.onclick = () => run('reject');

  return h('div', { class: 'review-card card glass' },
    h('div', { class: 'row-between' },
      h('div', {}, h('h2', { text: m.title }), h('p', { class: 'muted small' }, `${s.name} · `, h('a', { href: `mailto:${s.email}`, class: 'link', text: s.email }), ` · ${TAXONOMY.affiliations[s.affiliation] || 'unknown'} · ${relTime(s.createdAt)}`)),
      statusPill(s.status)),
    h('div', { class: 'review-grid' },
      h('div', { class: 'stack' }, previewBox,
        isFile ? h('div', { class: 'facts' },
          h('span', {}, icon('file'), s.file.name), h('span', {}, fmtSize(s.file.size)),
          h('button', { class: 'link-btn mono small', type: 'button', title: 'SHA-256 (copy)', onclick: () => copyText(s.file.sha256, 'Checksum copied'), text: `sha256 ${s.file.sha256.slice(0, 12)}…` }),
          h('a', { class: 'link', href: `https://drive.google.com/file/d/${s.file.driveId}/view`, target: '_blank', rel: 'noopener' }, 'Open in Drive', icon('external'))) : null,
        h('div', { class: 'card inset' }, h('h4', { text: 'Rights declared' }), h('p', { class: 'small', text: `${TAXONOMY.rights[m.rights] || '-'} · ${m.credit ? 'wants credit' : 'anonymous'}` })),
        h('div', { class: 'card inset' }, h('h4', { text: 'Similar material already in the archive' }), similar)),
      h('div', { class: 'stack' },
        h('h3', { class: 'h-sub', text: 'Catalogue record' }), form.el,
        h('h3', { class: 'h-sub', text: 'File it under' }), picker.el, newFolder,
        isFile ? h('div', { class: 'field' }, h('label', { text: 'Published file name' }), fileName) : null,
        h('div', { class: 'field' }, h('label', { text: 'Note' }), note),
        h('div', { class: 'row-end' }, reject, approve))));
}

function suggestedName(m, ext, original) {
  const parts = [m.courseCode, m.title, m.examYear || (m.session ? m.session.replace('-', '–') : '')].filter(Boolean);
  const name = parts.join(' - ').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  return name ? `${name}.${ext}` : original;
}

/** Browse public folders (read-only API) and pick a destination. */
function folderPicker(collection) {
  let trail = [], chosen = null;
  const crumbs = h('div', { class: 'fp-crumbs' });
  const list = h('div', { class: 'fp-list' });
  const hint = h('div', { class: 'fp-hint', hidden: true });
  const el = h('div', { class: 'folder-picker card inset' }, hint, crumbs, list);

  async function go(t) {
    trail = t; chosen = t[t.length - 1].id;
    fill(crumbs, ...trail.flatMap((f, i) => [i ? icon('chevron') : null,
      h('button', { type: 'button', class: i === trail.length - 1 ? 'current' : '', text: f.name, onclick: () => go(trail.slice(0, i + 1)) })]),
    h('span', { class: 'pill pill-ok fp-chosen' }, icon('check'), 'Files here'));
    fill(list, h('span', { class: 'spinner' }));
    try {
      const sub = (await listFolder(chosen)).filter(isFolder);
      fill(list, ...(sub.length ? sub.map((f) => h('button', { type: 'button', class: 'fp-item', onclick: () => go([...trail, { id: f.id, name: f.name }]) }, icon('folder'), h('span', { text: f.name }), icon('chevron')))
        : [h('p', { class: 'muted small', text: 'No subfolders - the file will go directly in this folder.' })]));
    } catch (e) { fill(list, h('p', { class: 'danger small', text: e.message })); }
  }
  function reset(col) {
    const root = CONFIG.folders[col];
    if (root) go([{ id: root.id, name: root.name }]);
  }
  reset(collection);
  return {
    el, reset, value: () => chosen,
    suggest(folderId, path) {
      hint.hidden = false;
      fill(hint, icon('sparkle'), h('span', { text: 'Last used for this course: ' }),
        h('button', { type: 'button', class: 'link-btn', text: path, onclick: async () => {
          const { trailFor } = await import('../services/drive.js');
          const t = await trailFor(folderId);
          if (t) go(t); else toast('That folder is no longer available.', 'warn');
        } }));
    }
  };
}

function submissionSummary(s) {
  const m = s.meta || {};
  return h('div', { class: 'card glass stack' },
    h('div', { class: 'row-between' }, h('h2', { text: m.title || s.file?.name || s.link }), statusPill(s.status)),
    h('dl', { class: 'meta-list' },
      [['Submitted by', `${s.name} <${s.email}>`], ['Type', TAXONOMY.types[m.type]], ['Course', [m.courseCode, m.courseTitle].filter(Boolean).join(' - ')],
        ['File', s.file ? `${s.file.name} (${fmtSize(s.file.size)})` : s.link], ['Reviewer', s.reviewer?.email], ['Filed under', s.published?.folderPath], ['Note', s.note]]
        .filter(([, v]) => v).map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    h('h4', { text: 'History' }),
    h('ol', { class: 'timeline' }, (s.history || []).map((e) => h('li', {}, h('b', { text: e.action }), ` by ${e.by} · ${fmtDate(e.at)}`, e.note ? h('p', { class: 'muted small', text: e.note }) : null))),
    s.published?.fileId ? h('a', { class: 'btn btn-ghost', href: `#/file/${s.published.fileId}` }, icon('eye'), 'View in archive') : null);
}

/* ================= submissions ================= */
function submissions({ panel, F, add }) {
  let status = 'all';
  const chips = h('div', { class: 'chip-row' });
  const body = h('div', { class: 'table-card glass' }, ...skeletonRows(6, 4));
  panel.append(chips, body);
  let stop = null;
  const drawChips = () => fill(chips, ...['all', 'pending', 'approved', 'rejected', 'withdrawn', 'abandoned'].map((k) =>
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(status === k), text: k === 'all' ? 'All' : STATUS[k].label, onclick: () => { status = k; drawChips(); load(); } })));
  function load() {
    stop?.();
    const c = F.collection(fb.db, 'submissions');
    const q = status === 'all' ? F.query(c, F.orderBy('createdAt', 'desc'), F.limit(150)) : F.query(c, F.where('status', '==', status), F.orderBy('createdAt', 'desc'), F.limit(150));
    stop = F.onSnapshot(q, (snap) => {
      const rows = docs(snap);
      fill(body, rows.length ? h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ['Title', 'Contributor', 'Type', 'Status', 'Submitted'].map((t) => h('th', { text: t })))),
        h('tbody', {}, rows.map((s) => h('tr', { class: 'clickable', onclick: () => modal({ title: 'Submission', wide: true, body: submissionSummary(s) }) },
          h('td', { text: s.meta?.title || '-' }), h('td', { text: s.name }), h('td', { text: TAXONOMY.types[s.meta?.type] || '-' }),
          h('td', {}, statusPill(s.status)), h('td', { text: fmtDate(s.createdAt) })))))
        : emptyState('inbox', 'Nothing here', 'No submissions with this status.'));
    }, (e) => fill(body, h('p', { class: 'danger', text: e.message })));
  }
  add(() => stop?.());
  drawChips(); load();
}

/* ================= reports ================= */
function reports({ panel, F, add }) {
  const body = h('div', { class: 'stack' }, ...skeletonRows(4, 2));
  panel.append(body);
  add(F.onSnapshot(F.query(F.collection(fb.db, 'reports'), F.where('status', '==', 'open'), F.orderBy('createdAt', 'desc'), F.limit(100)), (snap) => {
    const rows = docs(snap);
    fill(body, ...(rows.length ? rows.map((r) => h('article', { class: 'card glass report' },
      h('div', { class: 'row-between' }, h('div', {}, h('h3', { text: r.fileName || r.fileId }), h('p', { class: 'muted small', text: `${r.reason} · ${r.email} · ${relTime(r.createdAt)}` })), h('span', { class: 'pill pill-warn', text: r.reason })),
      r.details ? h('p', { class: 'pre', text: r.details }) : null,
      h('div', { class: 'row-end' },
        r.fileId.startsWith('link-') ? null : h('a', { class: 'btn btn-quiet btn-sm', href: `#/file/${r.fileId}` }, icon('eye'), 'Open'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => resolve(r, 'dismissed') }, 'Dismiss'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => resolve(r, 'resolved') }, icon('check'), 'Mark fixed'),
        isAdmin() && backendReady() ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => takedown(r) }, icon('trash'), 'Take down') : null)))
      : [emptyState('check', 'No open reports', 'Reports from readers about broken, misfiled or problematic material appear here.')]));
  }, (e) => fill(body, h('p', { class: 'danger', text: e.message }))));

  async function resolve(r, status) {
    const note = await ask({ title: status === 'dismissed' ? 'Dismiss report' : 'Mark as fixed', message: 'Add a short note for the record.', confirm: 'Save', input: 'What was done', minLength: 0 });
    if (note === null) return;
    try { await F.updateDoc(F.doc(fb.db, 'reports', r.id), { status, resolution: note, resolvedBy: fb.user.email, resolvedAt: F.serverTimestamp() }); toast('Report updated', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function takedown(r) {
    const reason = await ask({ title: 'Take down this file?', message: 'It is moved to the private Withdrawn folder and disappears from the public archive.', confirm: 'Take down', danger: true, input: 'Reason', minLength: 5 });
    if (!reason) return;
    try { await call('takedown', { fileId: r.fileId, reason, reportId: r.id, mode: 'withdraw' }); clearListingCache(); toast('Taken down', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }
}

/* ================= courses ================= */
function courses({ panel, F, add }) {
  const body = h('div', { class: 'table-card glass' }, ...skeletonRows(5, 4));
  panel.append(h('div', { class: 'row-between' },
    h('p', { class: 'muted', text: 'The course catalogue powers autocomplete and filing suggestions. Courses are never deleted when a curriculum changes - mark them inactive and record the curriculum versions they belong to.' }),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => edit() }, icon('plus'), 'Add course')), body);

  add(F.onSnapshot(F.collection(fb.db, 'courses'), (snap) => {
    const rows = docs(snap).sort((a, b) => a.id.localeCompare(b.id));
    fill(body, rows.length ? h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ['Code', 'Title', 'Level', 'Curricula', 'Status', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.map((c) => h('tr', {},
        h('td', { class: 'mono', text: c.id }), h('td', { text: c.title || '-' }), h('td', { text: c.level || '-' }),
        h('td', { text: (c.curricula || []).join(', ') || '-' }),
        h('td', {}, h('span', { class: `pill ${c.active === false ? 'pill-quiet' : 'pill-ok'}`, text: c.active === false ? 'Inactive' : 'Active' })),
        h('td', {}, h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Edit ${c.id}`, onclick: () => edit(c) }, icon('edit')))))))
      : emptyState('book', 'No courses yet', 'Add courses so contributors can pick them and reviewers get filing suggestions.'));
  }, (e) => fill(body, h('p', { class: 'danger', text: e.message }))));

  function edit(c = {}) {
    const code = h('input', { class: 'input mono', value: c.id || '', placeholder: 'ACCE-3101', disabled: !!c.id });
    const title = h('input', { class: 'input', value: c.title || '', maxlength: 160 });
    const program = h('select', { class: 'input' }, h('option', { value: 'bsc', text: 'BSc' }), h('option', { value: 'msc', text: 'MSc' }));
    program.value = c.program || 'bsc';
    const level = h('select', { class: 'input' }, h('option', { value: '', text: '-' }), TAXONOMY.levels.map((l) => h('option', { value: l, text: l })));
    level.value = c.level || '';
    const credits = h('input', { class: 'input', type: 'number', step: '0.5', min: 0, max: 10, value: c.credits ?? '' });
    const curricula = h('input', { class: 'input', value: (c.curricula || []).join(', '), placeholder: 'Syllabus 2019, Syllabus 2023' });
    const instructors = h('input', { class: 'input', value: (c.instructors || []).join(', '), placeholder: 'Names, most recent first' });
    const active = h('input', { type: 'checkbox', checked: c.active !== false });
    const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save' });
    const f = (l, i) => h('div', { class: 'field' }, h('label', { text: l }), i);
    const m = modal({ title: c.id ? `Edit ${c.id}` : 'Add course', body: h('div', { class: 'stack' },
      h('div', { class: 'grid-2' }, f('Code', code), f('Programme', program)), f('Title', title),
      h('div', { class: 'grid-2' }, f('Year / term', level), f('Credits', credits)),
      f('Curriculum versions', curricula), f('Instructors over time', instructors),
      h('label', { class: 'check' }, active, h('span', { text: 'Currently offered' }))),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => m.close() }), save] });
    save.onclick = async () => {
      const { normCourse } = await import('./metaform.js');
      const id = c.id || normCourse(code.value);
      if (!id) return toast('Course code should look like ACCE-3101.', 'error');
      const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
      try {
        await F.setDoc(F.doc(fb.db, 'courses', id), {
          code: id, title: title.value.trim(), program: program.value, level: level.value, credits: credits.value ? Number(credits.value) : null,
          curricula: list(curricula.value), instructors: list(instructors.value), active: active.checked,
          updatedAt: F.serverTimestamp(), updatedBy: fb.user.email
        }, { merge: true });
        toast('Course saved', 'ok'); m.close();
      } catch (e) { toast(e.message, 'error'); }
    };
  }
}

/* ================= people ================= */
function people({ panel, F, add }) {
  const team = h('div', { class: 'card glass' }, h('h2', {}, icon('shield'), 'Archive team'), ...skeletonRows(3, 2));
  const users = h('div', { class: 'table-card glass' }, ...skeletonRows(6, 4));
  panel.append(team, h('h2', { class: 'h-sub', text: 'Recent visitors & contributors' }), users);

  add(F.onSnapshot(F.collection(fb.db, 'admins'), (snap) => {
    const rows = docs(snap);
    const roleSel = (r) => {
      const s = h('select', { class: 'input input-sm', disabled: !isOwner() || r.email === fb.user.email.toLowerCase(), onchange: () => setRole(r.email, s.value) },
        ['reviewer', 'admin', 'owner'].map((x) => h('option', { value: x, text: x })));
      s.value = r.role;
      return s;
    };
    fill(team, h('h2', {}, icon('shield'), 'Archive team'),
      h('p', { class: 'muted small', text: 'Reviewers approve and decline. Admins also curate, take down and manage courses. Owners manage the team and settings.' }),
      h('div', { class: 'mini-list' }, rows.map((r) => h('div', { class: 'mini-row' }, icon('user'), h('span', { class: 'ellipsis', text: r.email }), roleSel(r),
        isOwner() && r.email !== fb.user.email.toLowerCase() ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${r.email}`, onclick: () => setRole(r.email, null) }, icon('x')) : null))),
      isOwner() && backendReady() ? addMember() : null);
  }, (e) => team.append(h('p', { class: 'danger', text: e.message }))));

  function addMember() {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'name@gmail.com' });
    const role = h('select', { class: 'input' }, ['reviewer', 'admin', 'owner'].map((x) => h('option', { value: x, text: x })));
    return h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); setRole(email.value.trim(), role.value).then(() => { email.value = ''; }); } },
      email, role, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Add'));
  }
  async function setRole(email, role) {
    if (!role && !(await ask({ title: 'Remove from team?', message: `${email} will lose dashboard access.`, confirm: 'Remove', danger: true }))) return;
    try { await call('setAdmin', { email, role }); toast(role ? `${email} is now ${role}` : `${email} removed`, 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }

  add(F.onSnapshot(F.query(F.collection(fb.db, 'users'), F.orderBy('lastSeen', 'desc'), F.limit(100)), (snap) => {
    const rows = docs(snap);
    fill(users, h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ['Name', 'Email', 'Affiliation', 'Student ID', 'Last seen', 'Visits', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.map((u) => h('tr', { class: u.status === 'blocked' ? 'is-blocked' : '' },
        h('td', { text: u.displayName }), h('td', { text: u.email }), h('td', { text: TAXONOMY.affiliations[u.affiliation] || '-' }),
        h('td', { class: 'mono', text: u.studentId || '-' }), h('td', { text: relTime(u.lastSeen) }), h('td', { text: u.visits || 1 }),
        h('td', {}, h('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: u.status === 'blocked' ? 'Unblock' : 'Block',
          onclick: async () => {
            const next = u.status === 'blocked' ? 'active' : 'blocked';
            if (next === 'blocked' && !(await ask({ title: `Block ${u.displayName}?`, message: 'They can still browse but can no longer submit material.', confirm: 'Block', danger: true }))) return;
            try { await F.updateDoc(F.doc(fb.db, 'users', u.id), { status: next }); toast(next === 'blocked' ? 'Blocked' : 'Unblocked', 'ok'); } catch (e) { toast(e.message, 'error'); }
          } })))))));
  }, (e) => fill(users, h('p', { class: 'danger', text: e.message }))));
}

/* ================= settings & maintenance ================= */
async function settings({ panel, F }) {
  const snap = await F.getDoc(F.doc(fb.db, 'config', 'settings')).catch(() => null);
  const s = { uploadsOpen: true, maxFileMB: 50, maxPendingPerUser: 15, maxPerDay: 25, reserveMB: 1024, notifyAdmins: true, notifySubmitters: true, announcement: '', ...(snap?.exists() ? snap.data() : {}) };
  const ro = !isOwner();
  const num = (k, min, max) => h('input', { class: 'input', type: 'number', min, max, value: s[k], disabled: ro, dataset: { k } });
  const chk = (k) => h('input', { type: 'checkbox', checked: !!s[k], disabled: ro, dataset: { k } });
  const fields = { uploadsOpen: chk('uploadsOpen'), notifyAdmins: chk('notifyAdmins'), notifySubmitters: chk('notifySubmitters'),
    maxFileMB: num('maxFileMB', 1, 200), maxPendingPerUser: num('maxPendingPerUser', 1, 100), maxPerDay: num('maxPerDay', 1, 200), reserveMB: num('reserveMB', 0, 10240),
    announcement: h('input', { class: 'input', value: s.announcement, maxlength: 280, disabled: ro, placeholder: 'Shown as a banner to everyone, e.g. “Term final questions for 2024 are now in!”' }) };
  const f = (l, i, hint) => h('div', { class: 'field' }, h('label', { text: l }), i, hint ? h('p', { class: 'fine', text: hint }) : null);
  const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: ro, text: 'Save settings' });
  save.onclick = async () => {
    const out = {};
    for (const [k, el] of Object.entries(fields)) out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    try { await F.setDoc(F.doc(fb.db, 'config', 'settings'), out, { merge: true }); toast('Settings saved - the backend picks them up within a minute', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const out = h('pre', { class: 'console', hidden: true });
  const task = (name, label, text) => h('div', { class: 'maint' }, h('div', {}, h('strong', { text: label }), h('p', { class: 'muted small', text })),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !backendReady(), onclick: async (e) => {
      e.target.disabled = true; out.hidden = false; out.textContent = `Running ${label.toLowerCase()}…`;
      try { out.textContent = JSON.stringify(await call('maintenance', { task: name }), null, 2); } catch (x) { out.textContent = x.message; }
      e.target.disabled = false;
    } }, 'Run'));

  panel.append(
    h('div', { class: 'card glass stack' }, h('h2', {}, icon('settings'), 'Submission settings'), ro ? h('p', { class: 'muted small', text: 'Only owners can change settings.' }) : null,
      h('label', { class: 'check' }, fields.uploadsOpen, h('span', { text: 'Accept new submissions' })),
      h('div', { class: 'grid-2' }, f('Max file size (MB)', fields.maxFileMB), f('Keep this much Drive space free (MB)', fields.reserveMB, 'Uploads pause automatically below this.')),
      h('div', { class: 'grid-2' }, f('Open submissions per person', fields.maxPendingPerUser), f('Submissions per person per day', fields.maxPerDay)),
      h('label', { class: 'check' }, fields.notifyAdmins, h('span', { text: 'Email the team about new submissions' })),
      h('label', { class: 'check' }, fields.notifySubmitters, h('span', { text: 'Email contributors when their submission is decided' })),
      f('Site announcement', fields.announcement), h('div', { class: 'row-end' }, save)),
    h('div', { class: 'card glass stack' }, h('h2', {}, icon('refresh'), 'Maintenance'),
      task('cleanup', 'Clean up', 'Marks stalled uploads as incomplete and deletes orphaned files from the Pending folder. Also runs nightly.'),
      task('fingerprints', 'Index checksums', 'Records a fingerprint of every public file so duplicate uploads are refused. Run after adding files directly in Drive.'),
      out));
}

/* ================= activity ================= */
async function activity({ panel, F }) {
  const body = h('div', { class: 'card glass' }, ...skeletonRows(8, 3));
  panel.append(body);
  try {
    const rows = docs(await F.getDocs(F.query(F.collection(fb.db, 'audit'), F.orderBy('at', 'desc'), F.limit(150))));
    fill(body, rows.length ? auditList(rows) : emptyState('activity', 'No activity yet', 'Every review, takedown and team change is recorded here.'));
  } catch (e) { fill(body, h('p', { class: 'danger', text: e.message })); }
}

function auditList(rows) {
  const verb = { submit: 'submitted', approve: 'approved', reject: 'declined', withdraw: 'withdrew', takedown: 'took down', annotate: 'edited the record of', 'create-folder': 'created folder', 'set-admin': 'changed role of', 'remove-admin': 'removed' };
  return h('ol', { class: 'timeline' }, rows.map((r) => h('li', {},
    h('b', { text: r.actor }), ` ${verb[r.action] || r.action} `, h('span', { class: 'mono small', text: r.target }),
    h('span', { class: 'muted small', text: ` · ${relTime(r.at)}` }), r.note ? h('p', { class: 'muted small', text: r.note }) : null)));
}
