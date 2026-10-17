/* ============================================================
   File preview modal: inline Drive preview, catalogue record,
   download / share / cite / report, and staff curation tools.
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, modal, ask, toast, fmtSize, fmtDate, fmtSession, copyText, fill } from '../lib/dom.js';
import { kindOf, KIND_LABEL, previewUrl, viewUrl, downloadUrl, fileMeta, isFolder, clearListingCache } from '../services/drive.js';
import { fb, isAdmin, report } from '../services/firebase.js';
import { call, backendReady } from '../services/backend.js';

const KIND_ICON = { folder: 'folder', pdf: 'pdf', doc: 'doc', sheet: 'sheet', slides: 'slides', archive: 'archive', image: 'image', audio: 'audio', video: 'video', code: 'code', link: 'link', file: 'file' };
const NO_PREVIEW = new Set(['archive', 'code', 'link', 'folder']);

export function fileIcon(f) {
  const k = kindOf(f);
  return h('span', { class: `ficon k-${k}`, title: KIND_LABEL[k] }, icon(KIND_ICON[k] || 'file'));
}

/** Catalogue record from Drive properties (set on approval/annotation) or a Firestore link item. */
export function recordOf(f) {
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

  const frame = NO_PREVIEW.has(k)
    ? h('div', { class: 'pv-none' }, h('div', { class: 'empty-ic' }, icon(KIND_ICON[k])), h('p', { text: `${KIND_LABEL[k]} files cannot be previewed in the browser.` }),
      h('a', { class: 'btn btn-primary', href: downloadUrl(f), target: '_blank', rel: 'noopener' }, icon('download'), 'Download'))
    : h('div', { class: 'pv-frame loading' }, h('iframe', {
      src: previewUrl(f.id), title: `Preview of ${f.name}`, loading: 'lazy', allow: 'autoplay', referrerpolicy: 'no-referrer',
      onload: (e) => e.target.parentElement.classList.remove('loading')
    }), h('span', { class: 'spinner' }));

  const side = h('aside', { class: 'pv-side' });
  const m = modal({ title: f.name, body: h('div', { class: 'pv' }, frame, side), wide: true, className: 'modal-preview' });

  const draw = () => {
    const rec = recordOf(f);
    fill(side, 
      h('div', { class: 'pv-title' }, fileIcon(f), h('div', {}, h('h3', { text: rec.title || f.name }), rec.title ? h('p', { class: 'muted small', text: f.name }) : null)),
      f.path?.length ? h('p', { class: 'pv-path' }, icon('folder'), f.path.join(' / ')) : null,
      metaList(rec, f),
      f.description ? h('details', { class: 'pv-desc', open: !rec.record }, h('summary', { text: 'Description' }), h('p', { text: stripRecord(f.description) })) : null,
      h('div', { class: 'pv-actions' },
        h('a', { class: 'btn btn-primary', href: downloadUrl(f), target: '_blank', rel: 'noopener' }, icon('download'), 'Download'),
        h('a', { class: 'btn btn-ghost', href: viewUrl(f), target: '_blank', rel: 'noopener' }, icon('external'), 'Open in Drive')),
      h('div', { class: 'pv-actions minor' },
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => copyText(shareUrl(f)) }, icon('link'), 'Copy link'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => copyText(citation(f, rec), 'Citation copied') }, icon('copy'), 'Cite'),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => openReport(f) }, icon('flag'), 'Report')),
      isAdmin() && backendReady() ? h('div', { class: 'pv-staff' },
        h('span', { class: 'eyebrow', text: 'Curation' }),
        h('div', { class: 'pv-actions minor' },
          h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => annotate(f, rec, () => { m.close(); onChanged?.(); }) }, icon('edit'), 'Edit record'),
          h('button', { class: 'btn btn-quiet btn-sm danger', type: 'button', onclick: () => takedown(f, () => { m.close(); onChanged?.(); }) }, icon('trash'), 'Take down'))) : null);
  };
  draw();

  // Index entries carry only the essentials; fetch links, description and properties lazily.
  if (!f.webViewLink && !isFolder(f)) {
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
    ['Curriculum', rec.curriculum],
    ['Language', TAXONOMY.languages[rec.language]],
    ['Format', KIND_LABEL[kindOf(f)]],
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

function openLink(item) {
  const rec = recordOf(item);
  modal({
    title: item.title || 'Link',
    body: h('div', { class: 'stack' },
      h('p', { class: 'pv-path' }, icon('link'), item.url),
      item.folderPath ? h('p', { class: 'pv-path' }, icon('folder'), item.folderPath) : null,
      metaList(rec, { mimeType: '', kind: 'link' }),
      item.description ? h('p', { class: 'pre', text: item.description }) : null,
      item.contributor ? h('p', { class: 'muted small', text: `Shared by ${item.contributor}` }) : null),
    actions: [
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openReport({ id: item.id, name: item.title }) }, icon('flag'), 'Report'),
      h('a', { class: 'btn btn-primary', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open link')]
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
async function annotate(f, rec, done) {
  const { buildMetaForm } = await import('./metaform.js');
  const form = await buildMetaForm({ initial: { ...rec, title: rec.title || f.name.replace(/\.[^.]+$/, ''), collection: f.root || 'misc', rights: 'educational' }, lockCollection: true, staff: true });
  const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save record' });
  const m = modal({ title: 'Catalogue record', wide: true, body: h('div', { class: 'stack' },
    h('p', { class: 'muted small', text: 'Stored with the file in Drive, so it travels with it and powers search.' }), form.el),
  actions: [h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => m.close() }), save] });
  save.onclick = async () => {
    let meta;
    try { meta = form.read(); } catch (e) { return toast(e.message, 'error'); }
    save.disabled = true;
    try { await call('annotate', { fileId: f.id, meta }); toast('Record saved', 'ok'); clearListingCache(); m.close(); done(); }
    catch (e) { toast(e.message, 'error'); save.disabled = false; }
  };
}

async function takedown(f, done) {
  const reason = await ask({ title: 'Take down this file?', message: `“${f.name}” will disappear from the public archive. A private copy is kept in the Withdrawn folder unless you delete it permanently afterwards in Drive.`, confirm: 'Take down', danger: true, input: 'Reason (kept in the audit log)', minLength: 5 });
  if (!reason) return;
  try { await call('takedown', { fileId: f.id, reason, mode: 'withdraw' }); toast('Taken down', 'ok'); clearListingCache(); done(); }
  catch (e) { toast(e.message, 'error'); }
}
