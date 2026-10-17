/* ============================================================
   Item preview modal: inline preview from whichever storage provider
   holds the bytes, the catalogue record, download / share / cite /
   report, and staff curation tools (edit record, take down).
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, modal, ask, toast, fmtSize, fmtDate, fmtSession, copyText, fill } from '../lib/dom.js';
import { kindOf, KIND_LABEL, fileMeta, isFolder, clearListingCache } from '../services/drive.js';
import { fb, isAdmin, report } from '../services/firebase.js';
import { call, backendReady } from '../services/backend.js';
import { resolve, PROVIDER_LABEL } from '../services/storage.js';
import { getItem, saveItem, libraryHref } from '../services/catalog.js';

const KIND_ICON = { folder: 'folder', pdf: 'pdf', doc: 'doc', sheet: 'sheet', slides: 'slides', archive: 'archive', image: 'image', audio: 'audio', video: 'video', code: 'code', link: 'link', file: 'file' };
const NO_PREVIEW = new Set(['archive', 'code', 'link', 'folder']);

export function fileIcon(f) {
  const k = kindOf(f);
  return h('span', { class: `ficon k-${k}`, title: KIND_LABEL[k] }, icon(KIND_ICON[k] || 'file'));
}

/** Catalogue record: the item itself, a raw link item, or (for un-catalogued Drive files) their Drive properties. */
export function recordOf(f) {
  if (f.item) return { ...f.item, record: f.item.submissionId || '' };
  if (f.kind === 'link') return { ...f, title: f.title };
  const p = f.properties || {};
  return {
    title: p.acce_title || '', type: p.acce_type || '', courseCode: p.acce_course || '', level: p.acce_level || '',
    session: p.acce_session || '', examYear: p.acce_year || '', examKind: p.acce_kind || '', curriculum: p.acce_curriculum || '',
    language: p.acce_lang || '', tags: p.acce_tags ? p.acce_tags.split(',') : [], record: p.acce_record || ''
  };
}

export const shareUrl = (f) => `${location.origin}${location.pathname}#/file/${encodeURIComponent(f.id)}`;

export async function openPreview(file, { onChanged } = {}) {
  let f = file;
  const k = kindOf(f);
  if (k === 'link') return openLink(f);
  const at = resolve(f);

  const frame = NO_PREVIEW.has(k) || !at.preview
    ? h('div', { class: 'pv-none' }, h('div', { class: 'empty-ic' }, icon(KIND_ICON[k])), h('p', { text: `${KIND_LABEL[k]} files cannot be previewed in the browser.` }),
      h('a', { class: 'btn btn-primary', href: at.download, target: '_blank', rel: 'noopener' }, icon('download'), 'Download'))
    : h('div', { class: 'pv-frame loading' }, h('iframe', {
      src: at.preview, title: `Preview of ${f.name}`, loading: 'lazy', allow: 'autoplay', referrerpolicy: 'no-referrer',
      onload: (e) => e.target.parentElement.classList.remove('loading')
    }), h('span', { class: 'spinner' }));

  const side = h('aside', { class: 'pv-side' });
  const m = modal({ title: f.name, body: h('div', { class: 'pv' }, frame, side), wide: true, className: 'modal-preview' });

  const draw = () => {
    const rec = recordOf(f);
    const urls = resolve(f);
    const fileName = f.fileName || f.name;
    const desc = f.item ? f.item.description : f.description;
    fill(side,
      h('div', { class: 'pv-title' }, fileIcon(f), h('div', {}, h('h3', { text: rec.title || f.name }), rec.title && rec.title !== fileName ? h('p', { class: 'muted small', text: fileName }) : null)),
      f.path?.length ? h(f.item ? 'a' : 'p', { class: 'pv-path', href: f.item ? libraryHref(f.item) : null, onclick: f.item ? () => m.close() : null }, icon('folder'), f.path.join(' / ')) : null,
      metaList(rec, f),
      desc ? h('details', { class: 'pv-desc', open: !rec.record }, h('summary', { text: 'Description' }), h('p', { text: stripRecord(desc) })) : null,
      h('div', { class: 'pv-actions' },
        h('a', { class: 'btn btn-primary', href: urls.download, target: '_blank', rel: 'noopener' }, icon('download'), 'Download'),
        h('a', { class: 'btn btn-ghost', href: urls.open, target: '_blank', rel: 'noopener' }, icon('external'), urls.provider === 'drive' ? 'Open in Drive' : 'Open original')),
      h('div', { class: 'pv-actions minor' },
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => copyText(shareUrl(f)) }, icon('link'), 'Copy link'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => copyText(citation(f, rec), 'Citation copied') }, icon('copy'), 'Cite'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => openReport(f) }, icon('flag'), 'Report')),
      isAdmin() ? h('div', { class: 'pv-staff' },
        h('span', { class: 'eyebrow', text: 'Curation' }),
        h('div', { class: 'pv-actions minor' },
          h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => annotate(f, rec, () => { m.close(); onChanged?.(); }) }, icon('edit'), 'Edit record'),
          h('button', { class: 'btn btn-quiet btn-sm danger', type: 'button', onclick: () => takedown(f, () => { m.close(); onChanged?.(); }) }, icon('trash'), 'Take down'))) : null);
  };
  draw();

  // Drive entries from the index carry only the essentials; fetch links, description and properties lazily.
  if (!f.item && !f.webViewLink && !isFolder(f)) {
    fileMeta(f.id).then((full) => { f = { ...f, ...full }; if (m.el.open) draw(); }).catch(() => {});
  }
}

function metaList(rec, f) {
  const rows = [
    ['Type', TAXONOMY.types[rec.type]],
    ['Course', rec.courseCode],
    ['Year / term', rec.level],
    ['Session', fmtSession(rec.session)],
    ['Exam', [TAXONOMY.examKinds[rec.examKind], rec.examYear].filter(Boolean).join(' ')],
    ['Curriculum', (rec.curricula?.length ? rec.curricula : [rec.curriculum]).filter(Boolean).join(', ')],
    ['Teacher(s)', rec.instructors],
    ['Author(s)', rec.authors],
    ['Language', TAXONOMY.languages[rec.language]],
    ['Format', KIND_LABEL[kindOf(f)]],
    ['Stored in', f.item ? PROVIDER_LABEL[f.item.storage?.provider] : ''],
    ['Size', f.size ? fmtSize(f.size) : ''],
    ['Updated', f.modifiedTime ? fmtDate(f.modifiedTime) : '']
  ].filter(([, v]) => v);
  return h('dl', { class: 'meta-list' },
    rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]),
    rec.tags?.length ? [h('dt', { text: 'Tags' }), h('dd', {}, rec.tags.map((t) => h('a', { class: 'tag', href: `#/search?q=${encodeURIComponent(t)}`, text: t })))] : null);
}

const stripRecord = (d) => d.replace(/\n*ACCE Archive record \w+\s*$/, '').trim();

function citation(f, rec) {
  const year = rec.examYear || (f.createdTime || f.modifiedTime || '').slice(0, 4) || 'n.d.';
  const parts = [rec.title || f.name.replace(/\.[^.]+$/, ''), rec.courseCode, TAXONOMY.types[rec.type]].filter(Boolean);
  return `${parts.join('. ')} (${year}). ACCE Archive, Department of Applied Chemistry and Chemical Engineering, Gopalganj Science and Technology University. ${shareUrl(f)}`;
}

function openLink(entry) {
  const item = entry.item || entry;
  const rec = recordOf(entry);
  const url = resolve(entry).open;
  modal({
    title: item.title || 'Link',
    body: h('div', { class: 'stack' },
      h('p', { class: 'pv-path' }, icon('link'), url),
      item.folderPath ? h('p', { class: 'pv-path' }, icon('folder'), item.folderPath) : null,
      metaList(rec, { mimeType: '', kind: 'link' }),
      item.description ? h('p', { class: 'pre', text: item.description }) : null,
      item.contributor ? h('p', { class: 'muted small', text: `Shared by ${item.contributor}` }) : null),
    actions: [
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openReport({ id: item.id, name: item.title }) }, icon('flag'), 'Report'),
      h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open link')]
  });
}

/* ---------- report ---------- */
const REASONS = { broken: 'Does not open / broken', wrong: 'Wrong folder or details', duplicate: 'Duplicate of another file', copyright: 'Copyright concern', privacy: 'Contains personal information', other: 'Something else' };

export function openReport(f) {
  if (!fb.user) return toast('Sign in to report a problem.', 'warn');
  const reason = h('select', { class: 'input' }, Object.entries(REASONS).map(([k, v]) => h('option', { value: k, text: v })));
  const details = h('textarea', { class: 'input', rows: 4, maxlength: 1500, placeholder: 'What is wrong? Links to the original or the correct folder help.' });
  const send = h('button', { class: 'btn btn-primary', type: 'button', text: 'Send report' });
  const m = modal({
    title: 'Report a problem',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted', text: f.name }),
      h('div', { class: 'field' }, h('label', { text: 'Reason' }), reason),
      h('div', { class: 'field' }, h('label', { text: 'Details' }), details),
      h('p', { class: 'fine', text: 'Copyright holders: reports are reviewed promptly and material is withdrawn while a concern is checked.' })),
    actions: [h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => m.close() }), send]
  });
  send.onclick = async () => {
    send.disabled = true;
    try { await report(f, reason.value, details.value.trim()); toast('Thanks - the archive team will look at it.', 'ok'); m.close(); }
    catch (e) { toast('Could not send the report: ' + e.message, 'error'); send.disabled = false; }
  };
}

/* ---------- staff ---------- */
/** Edit (or create) the catalogue record. Writes Firestore directly; rules allow admins only. */
async function annotate(f, rec, done) {
  const { buildMetaForm } = await import('./metaform.js');
  const existing = f.item || await getItem(f.id);
  const base = existing || rec;
  const form = await buildMetaForm({ initial: { ...base, curriculum: (base.curricula || []).join(', ') || base.curriculum || '', title: base.title || f.name.replace(/\.[^.]+$/, ''), collection: base.collection || f.root || 'misc', rights: base.rights || 'educational' }, staff: true });
  const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save record' });
  const m = modal({ title: 'Catalogue record', wide: true, body: h('div', { class: 'stack' },
    h('p', { class: 'muted small', text: 'The catalogue is the archive\u2019s source of truth: browsing and search are built from these records, wherever the file is stored.' }), form.el),
  actions: [h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => m.close() }), save] });
  save.onclick = async () => {
    let meta;
    try { meta = form.read(); } catch (e) { return toast(e.message, 'error'); }
    meta.curricula = meta.curriculum.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 8);
    save.disabled = true;
    try {
      const fresh = existing ? {} : {
        kind: 'file', status: 'published', source: 'manual', contributor: '',
        file: { name: f.name, size: +(f.size || 0), mime: f.mimeType || '', sha256: '' },
        storage: { provider: 'drive', id: f.id }, approvedAt: new Date()
      };
      await saveItem(existing?.id || f.id, { ...fresh, ...meta, curated: true });
      toast('Record saved', 'ok'); clearListingCache(); m.close(); done();
    } catch (e) { toast(e.code === 'permission-denied' ? 'Only admins can edit records.' : e.message, 'error'); save.disabled = false; }
  };
}

async function takedown(f, done) {
  const withBackend = backendReady() && (f.item?.storage?.provider || 'drive') !== 'r2';
  const reason = await ask({
    title: 'Take down this item?',
    message: withBackend
      ? `\u201c${f.name}\u201d will disappear from the public archive. The file is moved to the private Withdrawn folder.`
      : `\u201c${f.name}\u201d will be hidden from browsing and search. Until the upload backend is connected, also move the file out of the public Drive folder yourself.`,
    confirm: 'Take down', danger: true, input: 'Reason (kept in the record)', minLength: 5
  });
  if (!reason) return;
  try {
    if (withBackend) await call('takedown', { fileId: f.id, reason, mode: 'withdraw' });
    else {
      const item = f.item || await getItem(f.id);
      if (!item) throw new Error('Catalogue this file first (Edit record), or connect the upload backend.');
      await saveItem(item.id, { status: 'withdrawn', withdrawnReason: reason, withdrawnAt: new Date() });
    }
    toast('Taken down', 'ok'); clearListingCache(); done();
  } catch (e) { toast(e.message, 'error'); }
}
