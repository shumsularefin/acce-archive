/* ============================================================
   My uploads: live status of the signed-in user's submissions.
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, relTime, fmtSize, toast, ask, emptyState, skeletonRows, fill } from '../lib/dom.js';
import { fb, fs, docs } from '../services/firebase.js';
import { call } from '../services/backend.js';

export const STATUS = {
  uploading: { label: 'Uploading', cls: 'pill-quiet', ic: 'upload' },
  pending: { label: 'In review', cls: 'pill-warn', ic: 'clock' },
  approved: { label: 'Published', cls: 'pill-ok', ic: 'check' },
  rejected: { label: 'Not accepted', cls: 'pill-bad', ic: 'x' },
  withdrawn: { label: 'Withdrawn', cls: 'pill-quiet', ic: 'back' },
  abandoned: { label: 'Incomplete', cls: 'pill-quiet', ic: 'alert' }
};
export const statusPill = (s) => { const st = STATUS[s] || { label: s, cls: 'pill-quiet', ic: 'info' }; return h('span', { class: `pill ${st.cls}` }, icon(st.ic), st.label); };

export function render({ root }) {
  const F = fs();
  const list = h('div', { class: 'sub-list' }, ...skeletonRows(4));
  const tally = h('div', { class: 'chip-row' });
  root.append(h('section', { class: 'page' },
    h('div', { class: 'page-head row-between' },
      h('div', {}, h('span', { class: 'eyebrow', text: 'Your uploads' }), h('h1', { text: 'My uploads' })),
      h('a', { class: 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Upload')),
    tally, list));

  const q = F.query(F.collection(fb.db, 'submissions'), F.where('uid', '==', fb.user.uid), F.orderBy('createdAt', 'desc'), F.limit(100));
  const stop = F.onSnapshot(q, (snap) => {
    const items = docs(snap).filter((s) => s.status !== 'abandoned' || Date.now() - s.createdAt?.toMillis?.() < 7 * 864e5);
    const counts = items.reduce((m, s) => (m[s.status] = (m[s.status] || 0) + 1, m), {});
    fill(tally, ...Object.entries(counts).map(([s, n]) => h('span', { class: 'chip static' }, STATUS[s]?.label || s, h('b', { text: n }))));
    if (!items.length) {
      fill(list, emptyState('inbox', 'Nothing submitted yet', 'Your first contribution could save the next batch hours of searching.',
        h('a', { class: 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Upload material')));
      return;
    }
    fill(list, ...items.map(card));
  }, (e) => fill(list, emptyState('alert', 'Could not load your uploads', e.message)));

  function card(s) {
    const m = s.meta || {};
    const pub = s.published;
    return h('article', { class: 'sub-card card glass' },
      h('div', { class: 'sub-top' },
        h('div', {}, h('h3', { text: m.title || s.file?.name || s.link }),
          h('p', { class: 'muted small' }, [TAXONOMY.types[m.type], m.courseCode, s.file ? fmtSize(s.file.size) : 'Link', `submitted ${relTime(s.createdAt)}`].filter(Boolean).join(' · '))),
        statusPill(s.status)),
      s.note ? h('blockquote', { class: 'note' }, h('b', { text: s.status === 'rejected' ? 'Reviewer: ' : 'Note: ' }), s.note) : null,
      h('div', { class: 'sub-actions' },
        pub?.fileId ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/file/${pub.fileId}` }, icon('eye'), 'View in archive') : null,
        pub?.url && !pub.fileId ? h('a', { class: 'btn btn-ghost btn-sm', href: pub.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open link') : null,
        pub?.folderPath ? h('span', { class: 'muted small' }, icon('folder'), pub.folderPath) : null,
        ['pending', 'uploading'].includes(s.status) ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => withdraw(s) }, icon('back'), 'Withdraw') : null));
  }

  async function withdraw(s) {
    const ok = await ask({ title: 'Withdraw this submission?', message: 'The uploaded file is deleted and the reviewers will not see it.', confirm: 'Withdraw', danger: true });
    if (!ok) return;
    try { await call('withdraw', { submissionId: s.id }); toast('Withdrawn', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }

  return stop;
}
