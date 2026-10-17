/* ============================================================
   ACCE Archive - GSTU   |   app.js
   Vanilla ES module-free script, deferred, zero dependencies.
   ============================================================ */

/* ---------- 1. CONFIG - edit these ---------- */
const CONFIG = {
  driveApiKey: 'AIzaSyB8ZmdkBYTJLmpbTDgQ1uyF8NJZbKt1NKk',

  // Google Drive folder IDs for each section
  folders: {
    bsc:   { id: '1IiI3ZcOMbLLjsHiaveuOeApGqW3O360I', name: 'BSc archive' },
    msc:   { id: '1mCOHlXy9C_NMyiSu15NkMTz18NU1ZXRH', name: 'MSc archive' },
    qbank: { id: '12ZeZZsPMwlrynliFI830PIRmtBY457U0', name: 'Question banks' },
    misc:  { id: '19MiNUd2hWEHmBuAE-AM4Vua-bpmZt4oL', name: 'Miscellaneous' }
  },

  // Firebase / Firestore  (Project settings → General → Web API key + Project ID)
  firebase: {
    projectId:  'YOUR_FIREBASE_PROJECT_ID',
    apiKey:     'YOUR_FIREBASE_WEB_API_KEY',
    collection: 'visitors'
  },

  idPattern: /^(\d{2})ACE0(\d{2})$/,   // 20ACE001
  sessionFrom: 2015,
  sessionTo:   2026,
  cacheMinutes: 10
};

/* ---------- 2. DOM ---------- */
const $ = (s) => document.querySelector(s);
const gate = $('#gate'), gateForm = $('#gate-form'), gateError = $('#gate-error');
const app = $('#app'), landing = $('#landing-view'), browser = $('#browser-view');
const fileList = $('#file-list'), status = $('#status'), table = $('#dir-table');
const crumbs = $('#crumbs'), filterBox = $('#filter'), countLine = $('#count');

/* ---------- 3. Session dropdown ---------- */
(function buildSessions(){
  const sel = $('#f-session'), frag = document.createDocumentFragment();
  for (let y = CONFIG.sessionTo; y >= CONFIG.sessionFrom; y--) {
    const o = document.createElement('option');
    o.value = String(y);
    o.textContent = `${y}–${String(y + 1).slice(2)}`;
    frag.appendChild(o);
  }
  sel.appendChild(frag);
})();

/* ---------- 4. Auth gate ---------- */
const STORE_KEY = 'acce.user';

function showError(msg){ gateError.textContent = msg; gateError.hidden = false; }

function validate(name, session, sid){
  if (name.trim().length < 3) return 'That name is too short to be a full name.';
  if (!session) return 'No session selected.';
  const m = CONFIG.idPattern.exec(sid);
  if (!m) return 'That student ID is not in the departmental format.';
  if (m[1] !== String(session).slice(2)) return 'That student ID does not belong to the selected session.';
  if (m[2] === '00') return 'That serial number is not valid.';
  return null;
}

function openApp(user){
  gate.hidden = true;
  app.hidden = false;
  $('#user-name').textContent = user.name.split(' ')[0];
  $('#user-initials').textContent = user.name.trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
  document.title = 'ACCE Archive · GSTU';
}

gateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const session = $('#f-session').value;
  const sid = $('#f-id').value.trim().toUpperCase();

  const err = validate(name, session, sid);
  $('#f-id').setAttribute('aria-invalid', err ? 'true' : 'false');
  if (err) return showError(err);

  const user = { name, session, sid, firstSeen: new Date().toISOString() };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(user)); } catch {}
  openApp(user);
  logVisitor(user);
});

$('#user-chip').addEventListener('click', () => {
  try { localStorage.removeItem(STORE_KEY); } catch {}
  location.reload();
});

(function restore(){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
  if (saved && !validate(saved.name, saved.session, saved.sid)) {
    openApp(saved);
    logVisitor(saved);          // bumps visit count, does not duplicate
  } else {
    $('#f-name').focus();
  }
})();

/* ---------- 5. Visitor log (Firestore REST, one document per student ID) ---------- */
function fsValue(v){ return typeof v === 'number' ? { integerValue: v } : { stringValue: String(v) }; }

async function logVisitor(user){
  const fb = CONFIG.firebase;
  if (!fb.projectId || fb.projectId.startsWith('YOUR_')) return queueLocally(user);

  const base = `https://firestore.googleapis.com/v1/projects/${fb.projectId}/databases/(default)/documents/${fb.collection}`;
  const now = new Date().toISOString();
  const fields = {
    name: fsValue(user.name), session: fsValue(user.session), studentId: fsValue(user.sid),
    firstSeen: fsValue(user.firstSeen || now), lastSeen: fsValue(now),
    device: fsValue(navigator.userAgent.slice(0, 180))
  };

  try {
    const create = await fetch(`${base}?documentId=${encodeURIComponent(user.sid)}&key=${fb.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields })
    });
    if (create.status === 409) {
      const mask = ['name','session','lastSeen','device'].map(f => `updateMask.fieldPaths=${f}`).join('&');
      await fetch(`${base}/${encodeURIComponent(user.sid)}?${mask}&key=${fb.apiKey}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { name: fields.name, session: fields.session, lastSeen: fields.lastSeen, device: fields.device } })
      });
    }
  } catch { queueLocally(user); }
}

function queueLocally(user){
  try {
    const q = JSON.parse(localStorage.getItem('acce.queue') || '[]');
    if (!q.some(u => u.sid === user.sid)) q.push({ ...user, at: new Date().toISOString() });
    localStorage.setItem('acce.queue', JSON.stringify(q));
  } catch {}
}

/* ---------- 6. Drive browser ---------- */
let trail = [];            // [{id,name}]
let rows = [];             // current folder files, for filtering
let sort = { key: 'name', dir: 1 };

const fmtSize = (b) => {
  if (!b) return '-';
  const n = +b, u = ['B','KB','MB','GB'], i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

function iconFor(f){
  if (f.mimeType === 'application/vnd.google-apps.folder') return '📁';
  if (f.mimeType.includes('pdf')) return '📕';
  if (/word|document/.test(f.mimeType)) return '📝';
  if (/sheet|excel/.test(f.mimeType)) return '📊';
  if (/presentation|powerpoint/.test(f.mimeType)) return '📽️';
  if (/zip|rar|compressed/.test(f.mimeType)) return '🗄️';
  if (f.mimeType.startsWith('image/')) return '🖼️';
  return '📄';
}

document.querySelectorAll('.program-box').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = CONFIG.folders[btn.dataset.key];
    if (!f || f.id.startsWith('YOUR_')) {
      alert(`${f ? f.name : 'This section'} has no folder linked yet. Add its Drive folder ID in app.js.`);
      return;
    }
    landing.hidden = true; browser.hidden = false;
    trail = [{ id: f.id, name: f.name }];
    load(f.id);
  });
});

$('#back-btn').addEventListener('click', () => {
  if (trail.length > 1) { trail.pop(); load(trail.at(-1).id); }
  else { browser.hidden = true; landing.hidden = false; filterBox.value = ''; }
});

filterBox.addEventListener('input', () => render(rows, filterBox.value.trim().toLowerCase()));

function drawCrumbs(){
  crumbs.innerHTML = '';
  trail.forEach((f, i) => {
    if (i) crumbs.append(' / ');
    if (i === trail.length - 1) {
      const b = document.createElement('b'); b.textContent = f.name; crumbs.append(b);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = f.name;
      btn.onclick = () => { trail = trail.slice(0, i + 1); load(f.id); };
      crumbs.append(btn);
    }
  });
}

function skeleton(){
  fileList.innerHTML = Array.from({ length: 6 }, () =>
    '<tr class="skeleton"><td><span style="width:55%"></span></td><td class="col-date"><span style="width:70px"></span></td><td class="col-size"><span style="width:44px"></span></td></tr>'
  ).join('');
  table.hidden = false; status.hidden = true;
}

async function load(folderId){
  drawCrumbs();
  filterBox.value = '';
  skeleton();

  const cacheKey = `acce.dir.${folderId}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (c && Date.now() - c.t < CONFIG.cacheMinutes * 60000) { rows = c.files; return render(rows); }
  } catch {}

  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false`
            + `&orderBy=folder,name&pageSize=1000`
            + `&fields=files(id,name,mimeType,size,modifiedTime,webContentLink,webViewLink)`
            + `&key=${CONFIG.driveApiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status === 403 ? 'access denied - check the API key and folder sharing' : `request failed (${res.status})`);
    const data = await res.json();
    rows = data.files || [];
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), files: rows })); } catch {}
    render(rows);
  } catch (e) {
    table.hidden = true; status.hidden = false;
    status.className = 'status-msg error-msg';
    status.textContent = `This folder could not be loaded: ${e.message}.`;
  }
}

function sortRows(list){
  const val = (f) => sort.key === 'date' ? Date.parse(f.modifiedTime || 0) || 0
                   : sort.key === 'size' ? +(f.size || 0)
                   : f.name.toLowerCase();
  return [...list].sort((a, b) => {
    const af = a.mimeType === 'application/vnd.google-apps.folder';
    const bf = b.mimeType === 'application/vnd.google-apps.folder';
    if (af !== bf) return af ? -1 : 1;                 // folders always first
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    sort = { key, dir: sort.key === key ? -sort.dir : (key === 'name' ? 1 : -1) };
    document.querySelectorAll('.sort-btn').forEach(b => b.removeAttribute('aria-sort'));
    btn.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
    render(rows, filterBox.value.trim().toLowerCase());
  });
});

function render(files, q = ''){
  const list = sortRows(q ? files.filter(f => f.name.toLowerCase().includes(q)) : files);
  if (!list.length){
    table.hidden = true; status.hidden = false; status.className = 'status-msg';
    status.textContent = q ? 'Nothing here matches that.' : 'This folder is empty. Upload material to the Drive folder and it appears here.';
    countLine.textContent = '';
    return;
  }
  table.hidden = false; status.hidden = true;

  const frag = document.createDocumentFragment();
  let folders = 0, bytes = 0;
  for (const f of list){
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    isFolder ? folders++ : bytes += +(f.size || 0);
    const tr = document.createElement('tr');
    if (isFolder) tr.className = 'is-folder';

    const nameTd = document.createElement('td');
    nameTd.dataset.cell = 'name';
    nameTd.innerHTML = `<span class="icon">${iconFor(f)}</span>`;
    const a = document.createElement('a');
    a.className = 'file-link'; a.textContent = f.name;
    if (isFolder){
      a.href = '#'; a.setAttribute('role', 'button');
      a.onclick = (ev) => { ev.preventDefault(); trail.push({ id: f.id, name: f.name }); load(f.id); };
    } else {
      a.href = f.webContentLink || f.webViewLink || '#';
      a.target = '_blank'; a.rel = 'noopener';
      a.title = 'Download ' + f.name;
    }
    nameTd.appendChild(a);

    const dateTd = document.createElement('td');
    dateTd.className = 'col-date'; dateTd.textContent = fmtDate(f.modifiedTime);
    const sizeTd = document.createElement('td');
    sizeTd.className = 'col-size'; sizeTd.textContent = isFolder ? '-' : fmtSize(f.size);

    tr.append(nameTd, dateTd, sizeTd);
    frag.appendChild(tr);
  }
  fileList.replaceChildren(frag);

  const fileCount = list.length - folders;
  const parts = [];
  if (folders) parts.push(`${folders} folder${folders > 1 ? 's' : ''}`);
  if (fileCount) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
  if (bytes) parts.push(fmtSize(bytes));
  countLine.textContent = parts.join(' · ');
}

/* ---------- 6b. Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (app.hidden) return;
  if (e.key === '/' && document.activeElement !== filterBox && !browser.hidden){
    e.preventDefault(); filterBox.focus();
  } else if (e.key === 'Escape'){
    if (document.activeElement === filterBox && filterBox.value){
      filterBox.value = ''; render(rows);
    } else if (!browser.hidden){
      $('#back-btn').click();
    }
  }
});

/* ---------- 7. Theme ---------- */
const themeBtn = $('#theme-btn');
try {
  const t = localStorage.getItem('acce.theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {}
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name=theme-color]').content = next === 'light' ? '#eaf3ee' : '#06231b';
  try { localStorage.setItem('acce.theme', next); } catch {}
});