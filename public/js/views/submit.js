/* ============================================================
   Contribute: files (drag & drop, batch) or a link, described once,
   uploaded in resumable chunks to the private review folder.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fmtSize, toast, emptyState, fill } from '../lib/dom.js';
import { fb, isOwner } from '../services/firebase.js';
import { backendReady, backendConfig, uploadFile, submitLink, extOf, acceptAttr } from '../services/backend.js';
import { inferCourse, inferType } from '../lib/infer.js';
import { buildMetaForm } from './metaform.js';
import { profileForm } from './gate.js';

const MAX_BATCH = 10;
const titleFromName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function render({ root, query, navigate }) {
  if (!backendReady()) {
    root.append(h('section', { class: 'page narrow' }, h('div', { class: 'card glass' }, isOwner()
      ? emptyState('upload', 'Connect the upload service',
        'Uploads go through your Apps Script web app. Paste its URL in Dashboard \u2192 Settings and students can start uploading straight away.',
        h('a', { class: 'btn btn-primary', href: '#/admin/settings' }, icon('settings'), 'Open settings'))
      : emptyState('clock', 'Uploads open soon',
        'The archive team is still switching uploads on. You can browse, preview and download everything in the meantime.',
        h('a', { class: 'btn', href: '#/', text: 'Back to the archive' })))));
    return;
  }
  if (!fb.profile) {
    // asked once, here rather than at sign-in, so browsing never waits on it
    root.append(h('section', { class: 'page narrow' },
      h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'Upload \u00b7 one-time step' }), h('h1', { text: 'Tell us who you are' }),
        h('p', { class: 'muted', text: 'Reviewers use this to credit your uploads. You only do this once.' })),
      h('div', { class: 'card glass' }, profileForm({ submitLabel: 'Continue to upload', onSaved: () => navigate('#/submit') }))));
    return;
  }
  const cfg = await backendConfig();
  if (cfg && !cfg.uploadsOpen) {
    root.append(h('section', { class: 'page narrow' }, emptyState('clock', 'Submissions are paused', cfg.announcement || 'The archive team has paused new submissions for now. Please check back soon.')));
    return;
  }
  const maxMB = cfg?.maxFileMB || CONFIG.maxFileMB;

  let mode = 'file', busy = false, controller = null;
  const queue = [];   // {file, title, status, progress, error, el}

  /* ---------- step 1: what ---------- */
  const picker = h('input', { type: 'file', multiple: true, accept: acceptAttr, hidden: true, onchange: () => { addFiles(picker.files); picker.value = ''; } });
  const drop = h('div', { class: 'dropzone', tabindex: 0, role: 'button', 'aria-label': 'Choose files to upload',
    onclick: () => picker.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } } },
    h('div', { class: 'dz-ic' }, icon('upload')),
    h('strong', { text: 'Drop files here or click to choose' }),
    h('span', { class: 'muted small', text: `PDF preferred · up to ${maxMB} MB each · up to ${MAX_BATCH} files at once` }), picker);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  const list = h('div', { class: 'queue' });

  const linkUrl = h('input', { class: 'input', type: 'url', id: 's-url', placeholder: 'https://…', maxlength: 500 });
  const linkTitle = h('input', { class: 'input', id: 's-ltitle', maxlength: 160, placeholder: 'What is it? e.g. NPTEL lectures on mass transfer' });
  const linkPane = h('div', { class: 'stack', hidden: true },
    h('div', { class: 'field' }, h('label', { for: 's-url', text: 'Link' }), linkUrl),
    h('div', { class: 'field' }, h('label', { for: 's-ltitle', text: 'Title' }), linkTitle),
    h('p', { class: 'fine', text: 'Links are ideal for videos, publisher pages and big datasets: they use no archive storage.' }));
  const filePane = h('div', { class: 'stack' }, drop, list);

  const seg = h('div', { class: 'segmented', role: 'tablist' },
    ['file', 'link'].map((m) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(m === mode), dataset: { m },
      onclick: () => setMode(m) }, icon(m === 'file' ? 'upload' : 'link'), m === 'file' ? 'Upload files' : 'Share a link')));
  function setMode(m) {
    if (busy) return;
    mode = m;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === m)));
    filePane.hidden = m !== 'file';
    linkPane.hidden = m !== 'link';
  }

  /* ---------- step 2: describe ---------- */
  const meta = await buildMetaForm({ hideTitle: true, simple: true, initial: {
    collection: CONFIG.folders[query.get('c')] ? query.get('c') : 'bsc', rights: 'educational'
  } });

  /* ---------- step 3: confirm ---------- */
  const declare = h('input', { type: 'checkbox', id: 's-declare' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const send = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icon('upload'), 'Submit for review');
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button', hidden: true, text: 'Cancel', onclick: () => controller?.abort() });

  const form = h('form', { class: 'submit-form', novalidate: true },
    step(1, 'Choose files', seg, filePane, linkPane),
    step(2, 'Where does it belong?', h('p', { class: 'muted small', text: 'We fill in what we can from the file name. Applies to every file in this batch.' }), meta.el),
    step(3, 'Send for review',
      h('label', { class: 'check' }, declare, h('span', { text: 'I have the right to share this, it is relevant to the department, and it contains no one’s private information (phone numbers, marks, ID cards).' })),
      err, h('div', { class: 'row-end' }, cancel, send)));

  const success = h('div', { class: 'card glass success-card', hidden: true });

  root.append(h('section', { class: 'page submit-page' },
    h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'Upload' }), h('h1', { text: 'Add to the archive' }),
      h('p', { class: 'muted', text: `Signed in as ${fb.profile?.displayName || fb.user.email} (${fb.user.email}). Everything is reviewed before it appears publicly; follow its progress in My uploads.` })),
    h('div', { class: 'submit-layout' }, h('div', {}, form, success), guide(maxMB))));

  function step(n, title, ...content) {
    return h('fieldset', { class: 'step card glass' }, h('legend', {}, h('span', { class: 'step-n', text: n }), title), ...content);
  }

  /* ---------- queue ---------- */
  function addFiles(files) {
    for (const file of files) {
      if (queue.length >= MAX_BATCH) { toast(`Up to ${MAX_BATCH} files per batch.`, 'warn'); break; }
      const ext = extOf(file.name);
      let problem = '';
      if (!TAXONOMY.extensions[ext]) problem = `.${ext || '?'} files are not accepted. Convert to PDF if you can.`;
      else if (file.size > maxMB * 1048576) problem = `Larger than ${maxMB} MB. Compress it, split it, or share a link.`;
      else if (!file.size) problem = 'This file is empty.';
      if (problem) { toast(`${file.name}: ${problem}`, 'error', 6000); continue; }
      if (queue.some((q) => q.file.name === file.name && q.file.size === file.size)) continue;
      queue.push({ file, title: titleFromName(file.name), status: 'ready', progress: 0, error: '' });
      prefill(file);
    }
    drawQueue();
  }

  /** Guess the course and material type from a file name, without overwriting anything typed. */
  function prefill(file) {
    const fl = meta.fields;
    const code = inferCourse(file.name);
    if (code && !fl.courseCode.value) { fl.courseCode.value = code; fl.courseCode.dispatchEvent(new Event('change')); }
    const type = inferType({ name: file.name, mimeType: file.type }, [], fl.collection.value);
    if (type !== 'other' && !fl.type.value) { fl.type.value = type; fl.type.dispatchEvent(new Event('change')); }
  }

  function drawQueue() {
    fill(list, ...queue.map((item, i) => {
      const title = h('input', { class: 'input input-sm', value: item.title, maxlength: 160, 'aria-label': `Title for ${item.file.name}`, disabled: busy || item.status === 'done',
        oninput: (e) => { item.title = e.target.value; } });
      const bar = h('div', { class: 'bar' }, h('span', { style: { width: `${Math.round(item.progress * 100)}%` } }));
      const statusText = { ready: 'Ready', hashing: 'Checking file…', starting: 'Starting…', uploading: `Uploading ${Math.round(item.progress * 100)}%`, retrying: 'Connection hiccup, retrying…', done: 'Sent for review', error: item.error }[item.status] || '';
      item.el = h('div', { class: `q-item st-${item.status}` },
        h('span', { class: 'ficon k-file' }, icon(item.status === 'done' ? 'check' : item.status === 'error' ? 'alert' : 'file')),
        h('div', { class: 'q-main' }, title,
          h('div', { class: 'q-sub' }, h('span', { class: 'mono small', text: item.file.name }), h('span', { class: 'muted small', text: fmtSize(item.file.size) })),
          item.status !== 'ready' ? bar : null,
          item.status !== 'ready' ? h('span', { class: `q-status small ${item.status === 'error' ? 'danger' : 'muted'}`, text: statusText }) : null),
        busy || item.status === 'done' ? null : h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${item.file.name}`, onclick: () => { queue.splice(i, 1); drawQueue(); } }, icon('x')));
      return item.el;
    }));
  }

  /* ---------- submit ---------- */
  const leaveGuard = (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', leaveGuard);

  form.addEventListener('input', () => { err.hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    let m;
    try {
      m = meta.read();
      if (mode === 'file' && !queue.some((q) => q.status !== 'done')) throw new Error('Add at least one file.');
      if (mode === 'file' && queue.some((q) => q.status !== 'done' && q.title.trim().length < 3)) throw new Error('Give every file a title of at least 3 characters.');
      if (mode === 'link' && !/^https:\/\/\S+$/i.test(linkUrl.value.trim())) throw new Error('Links must start with https://');
      if (mode === 'link' && linkTitle.value.trim().length < 3) throw new Error('Give the link a title.');
      if (!declare.checked) throw new Error('Please confirm the declaration.');
    } catch (x) { err.textContent = x.message; err.hidden = false; return; }

    busy = true; send.disabled = true; cancel.hidden = mode !== 'file';
    controller = new AbortController();
    let sent = 0;
    try {
      if (mode === 'link') {
        await submitLink(linkUrl.value.trim(), { ...m, title: linkTitle.value.trim() });
        sent = 1;
      } else {
        for (const item of queue) {
          if (item.status === 'done') continue;
          try {
            await uploadFile(item.file, { ...m, title: item.title.trim() }, {
              signal: controller.signal,
              onProgress: (p) => { item.status = p.phase; item.progress = p.total ? p.loaded / p.total : 0; drawQueue(); }
            });
            item.status = 'done'; item.progress = 1; sent++;
          } catch (x) {
            if (x.name === 'AbortError') { item.status = 'error'; item.error = 'Cancelled'; drawQueue(); break; }
            item.status = 'error'; item.error = x.message;
          }
          drawQueue();
        }
      }
    } catch (x) {
      err.textContent = x.message; err.hidden = false;
    } finally {
      busy = false; send.disabled = false; cancel.hidden = true;
      drawQueue();
    }
    const failed = queue.filter((q) => q.status === 'error').length;
    if (sent && !failed) showSuccess(sent);
    else if (sent) toast(`${sent} sent, ${failed} need attention - fix and submit again.`, 'warn', 7000);
  });

  function showSuccess(n) {
    form.hidden = true;
    success.hidden = false;
    fill(success, 
      h('div', { class: 'success-burst' }, icon('check')),
      h('h2', { text: n === 1 ? 'Sent for review' : `${n} items sent for review` }),
      h('p', { class: 'muted', text: 'Thank you! A reviewer will check it soon. You will get an email when it is published, and you can follow it in My uploads.' }),
      h('div', { class: 'row-center' },
        h('a', { class: 'btn btn-primary', href: '#/my' }, icon('inbox'), 'Track my uploads'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { queue.length = 0; drawQueue(); linkUrl.value = ''; linkTitle.value = ''; declare.checked = false; form.hidden = false; success.hidden = true; } }, 'Submit more')));
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return () => { window.removeEventListener('beforeunload', leaveGuard); controller?.abort(); };
}

function guide(maxMB) {
  return h('aside', { class: 'guide card glass' },
    h('h3', {}, icon('info'), 'What belongs here'),
    h('ul', { class: 'ticks' },
      h('li', { text: 'Lecture notes, slides and handouts' }),
      h('li', { text: 'Past question papers and solutions' }),
      h('li', { text: 'Lab manuals, reports and project write-ups' }),
      h('li', { text: 'Theses, papers and reference books you may share' }),
      h('li', { text: 'Syllabi, forms and departmental notices' })),
    h('h3', {}, icon('sparkle'), 'Tips for a quick approval'),
    h('ul', { class: 'ticks' },
      h('li', { text: 'One file per document, named clearly. PDF is best.' }),
      h('li', { text: 'Scans: 150–200 dpi greyscale keeps files small and readable.' }),
      h('li', { text: 'Add the course code and session so it can be filed correctly.' }),
      h('li', { text: `Over ${maxMB} MB or a video? Share a link instead.` })),
    h('h3', {}, icon('shield'), 'Please do not upload'),
    h('ul', { class: 'crosses' },
      h('li', { text: 'Result sheets, attendance, ID cards or anything with personal data' }),
      h('li', { text: 'Commercial e-books you do not have permission to share' }),
      h('li', { text: 'Exact duplicates - the archive detects and refuses them' })),
    h('a', { class: 'link', href: '#/about', text: 'Read the collection policy' }));
}
