/* ============================================================
   ACCE Archive - submission & review backend (Google Apps Script)

   Deployed as a web app that executes as the Drive owner, so every
   file lands in the archive's own Drive quota. The browser proves who
   it is with a Firebase ID token on every call; this script verifies
   the token with Identity Toolkit and checks roles in Firestore before
   touching Drive or Firestore.

   Flow:  init -> chunk ... chunk -> (file lands in private Pending folder,
          submission becomes "pending") -> review(approve|reject)
   ============================================================ */
const VERSION = '2.0.0';
const MIB = 1024 * 1024;
const CHUNK_BYTES = 5 * MIB;                    // multiple of 256 KiB, as Drive requires
const ROLE_RANK = { reviewer: 1, admin: 2, owner: 3 };
// Permanent owners: always owners, never removable. Keep in step with firestore.rules and CONFIG.rootOwners.
const ROOT_OWNERS = ['muhammadshamsularefin01@gmail.com'];

const DEFAULT_ROOTS = {
  bsc: '1IiI3ZcOMbLLjsHiaveuOeApGqW3O360I',
  msc: '1mCOHlXy9C_NMyiSu15NkMTz18NU1ZXRH',
  qbank: '12ZeZZsPMwlrynliFI830PIRmtBY457U0',
  misc: '19MiNUd2hWEHmBuAE-AM4Vua-bpmZt4oL'
};

const DEFAULT_SETTINGS = {
  uploadsOpen: true,
  maxFileMB: 50,
  maxPendingPerUser: 15,
  maxPerDay: 25,
  reserveMB: 1024,                // refuse uploads when free space drops below this
  notifyAdmins: true,
  notifySubmitters: true,
  announcement: ''
};

/* ---------- configuration ---------- */
let CFG_ = null;
function cfg_() {
  if (CFG_) return CFG_;
  const p = PropertiesService.getScriptProperties().getProperties();
  CFG_ = {
    projectId: p.FIREBASE_PROJECT_ID || 'accearchive',
    apiKey: p.FIREBASE_API_KEY || '',
    roots: p.ROOT_FOLDERS ? JSON.parse(p.ROOT_FOLDERS) : DEFAULT_ROOTS,
    pendingFolder: p.PENDING_FOLDER_ID || '',
    withdrawnFolder: p.WITHDRAWN_FOLDER_ID || '',
    owners: ROOT_OWNERS.concat((p.OWNER_EMAILS || '').split(',').map(function (s) { return s.trim().toLowerCase(); }))
      .filter(function (e, i, a) { return e && a.indexOf(e) === i; }),
    siteUrl: (p.SITE_URL || 'https://accearchive.web.app').replace(/\/$/, '')
  };
  return CFG_;
}

function settings_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('settings');
  if (hit) return JSON.parse(hit);
  const s = Object.assign({}, DEFAULT_SETTINGS, fsGet_('config/settings') || {});
  delete s._id;
  s.maxFileMB = Math.min(Math.max(Number(s.maxFileMB) || 50, 1), 200);
  cache.put('settings', JSON.stringify(s), 60);
  return s;
}

/* ---------- HTTP entry points ---------- */
function doGet() {
  return json_({ ok: true, data: { service: 'acce-archive', version: VERSION } });
}

function doPost(e) {
  let out;
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 12 * MIB) fail_('too_large', 'Request is too large.');
    let req;
    try { req = JSON.parse(raw); } catch (x) { fail_('bad_request', 'Malformed request.'); }
    const route = ROUTES_[req && req.action];
    if (!route) fail_('bad_request', 'Unknown action.');
    const user = route.public ? null : verifyUser_(req.idToken);
    if (route.role) requireRole_(user, route.role);
    out = { ok: true, data: route.fn(req, user) };
  } catch (err) {
    if (!err.code) console.error(err && err.stack ? err.stack : err);
    out = { ok: false, error: {
      code: err.code || 'internal',
      message: err.code ? err.message : 'Unexpected server error. Please try again in a moment.'
    } };
  }
  return json_(out);
}

const ROUTES_ = {
  config:      { public: true, fn: actConfig_ },
  whoami:      { fn: actWhoami_ },
  init:        { fn: actInit_ },
  chunk:       { fn: actChunk_ },
  withdraw:    { fn: actWithdraw_ },
  review:      { role: 'reviewer', fn: actReview_ },
  stats:       { role: 'reviewer', fn: actStats_ },
  createFolder:{ role: 'admin', fn: actCreateFolder_ },
  annotate:    { role: 'admin', fn: actAnnotate_ },
  takedown:    { role: 'admin', fn: actTakedown_ },
  maintenance: { role: 'admin', fn: actMaintenance_ },
  setAdmin:    { role: 'owner', fn: actSetAdmin_ }
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

/* ---------- identity ---------- */
function verifyUser_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) fail_('unauthenticated', 'Please sign in first.');
  if (!cfg_().apiKey) fail_('misconfigured', 'The upload service is not configured yet (FIREBASE_API_KEY).');
  const cache = CacheService.getScriptCache();
  const key = 'tok:' + sha256Hex_(idToken);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(cfg_().apiKey), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) fail_('unauthenticated', 'Your sign-in has expired. Please sign in again.');
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || u.disabled) fail_('unauthenticated', 'This account cannot use the archive.');
  const user = {
    uid: u.localId,
    email: String(u.email || '').toLowerCase(),
    verified: u.emailVerified === true,
    name: u.displayName || ''
  };
  if (!user.email || !user.verified) fail_('unverified', 'A verified Google account is required.');
  cache.put(key, JSON.stringify(user), 300);
  return user;
}

function roleOf_(user) {
  if (cfg_().owners.indexOf(user.email) >= 0) return 'owner';
  const cache = CacheService.getScriptCache();
  const key = 'role:' + user.email;
  const hit = cache.get(key);
  if (hit !== null) return hit || null;
  const doc = fsGet_('admins/' + encodeURIComponent(user.email));
  const role = doc && ROLE_RANK[doc.role] ? doc.role : '';
  cache.put(key, role, 120);
  return role || null;
}

function requireRole_(user, min) {
  user.role = roleOf_(user);
  if (!user.role || ROLE_RANK[user.role] < ROLE_RANK[min]) fail_('forbidden', 'You do not have permission to do that.');
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ---------- validation ---------- */
function clean_(v, max, keepLines) {
  let s = v === null || v === undefined ? '' : String(v);
  s = keepLines
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  s = s.trim();
  if (s.length > max) fail_('invalid', 'One of the fields is too long (limit ' + max + ' characters).');
  return s;
}

function pick_(v, dict, label, required) {
  if (!v) { if (required) fail_('invalid', 'Choose a ' + label + '.'); return ''; }
  if (!Object.prototype.hasOwnProperty.call(dict, v)) fail_('invalid', 'Unknown ' + label + '.');
  return v;
}

function normCourse_(v) {
  const s = clean_(v, 20).toUpperCase();
  if (!s) return '';
  const m = /^([A-Z]{2,6})[\s-]?(\d{3,4}[A-Z]?)$/.exec(s);
  if (!m) fail_('invalid', 'Course code should look like ACCE-3101.');
  return m[1] + '-' + m[2];
}

function validateMeta_(m) {
  m = m || {};
  const out = {};
  out.title = clean_(m.title, 160);
  if (out.title.length < 3) fail_('invalid', 'Give the material a descriptive title.');
  out.collection = pick_(m.collection, TAXONOMY.collections, 'collection', true);
  out.type = pick_(m.type, TAXONOMY.types, 'material type', true);
  out.courseCode = normCourse_(m.courseCode);
  out.courseTitle = clean_(m.courseTitle, 120);
  out.level = m.level ? (TAXONOMY.levels.indexOf(m.level) >= 0 ? m.level : fail_('invalid', 'Unknown year/term.')) : '';
  out.session = m.session ? (/^\d{4}-\d{2}$/.test(m.session) ? m.session : fail_('invalid', 'Session should look like 2021-22.')) : '';
  out.examYear = null;
  if (m.examYear) {
    const y = Number(m.examYear);
    if (!Number.isInteger(y) || y < 1980 || y > 2100) fail_('invalid', 'Exam year looks wrong.');
    out.examYear = y;
  }
  out.examKind = pick_(m.examKind, TAXONOMY.examKinds, 'exam kind', false);
  out.instructors = clean_(m.instructors, 200);
  out.authors = clean_(m.authors, 200);
  out.curriculum = clean_(m.curriculum, 120);
  // one work can belong to several curricula ("Syllabus 2019, Syllabus 2023") without being duplicated
  out.curricula = out.curriculum.split(',').map(function (c) { return c.trim(); }).filter(String).slice(0, 8);
  out.language = pick_(m.language, TAXONOMY.languages, 'language', false);
  out.description = clean_(m.description, 2000, true);
  out.tags = [];
  (Array.isArray(m.tags) ? m.tags : []).slice(0, 12).forEach(function (t) {
    const s = clean_(t, 30).toLowerCase();
    if (s && out.tags.indexOf(s) < 0) out.tags.push(s);
  });
  out.rights = pick_(m.rights, TAXONOMY.rights, 'rights statement', true);
  out.credit = m.credit !== false;
  return out;
}

function cleanFileName_(name) {
  let s = clean_(name, 300).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim();
  const dot = s.lastIndexOf('.');
  if (dot <= 0) fail_('type', 'The file needs an extension such as .pdf.');
  let base = s.slice(0, dot).trim(), ext = s.slice(dot + 1).toLowerCase();
  if (base.length > 150) base = base.slice(0, 150).trim();
  return { name: base + '.' + ext, ext: ext };
}

function validateFile_(f, settings) {
  f = f || {};
  const n = cleanFileName_(f.name);
  const mime = TAXONOMY.extensions[n.ext];
  if (!mime) fail_('type', 'Files of type .' + n.ext + ' are not accepted. Convert to PDF if you can.');
  const size = Number(f.size);
  if (!Number.isInteger(size) || size <= 0) fail_('invalid', 'The file is empty.');
  if (size > settings.maxFileMB * MIB) fail_('too_large', 'Files must be ' + settings.maxFileMB + ' MB or smaller. Compress it, split it, or submit a link instead.');
  const sha = String(f.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) fail_('invalid', 'Missing file checksum.');
  return { name: n.name, ext: n.ext, mime: mime, size: size, sha256: sha };
}

function validateLink_(url) {
  const s = clean_(url, 500);
  if (!/^https:\/\/[^\s/$.?#][^\s]*$/i.test(s)) fail_('invalid', 'Links must be full https:// addresses.');
  return s;
}

/* ---------- user actions ---------- */
function actConfig_() {
  const s = settings_();
  return {
    version: VERSION, uploadsOpen: s.uploadsOpen, maxFileMB: s.maxFileMB,
    chunkBytes: CHUNK_BYTES, announcement: s.announcement || ''
  };
}

function actWhoami_(req, user) {
  return { uid: user.uid, email: user.email, role: roleOf_(user) };
}

function actInit_(req, user) {
  const s = settings_();
  if (!s.uploadsOpen) fail_('closed', 'Submissions are paused right now. Please try again later.');
  if (!cfg_().pendingFolder) fail_('misconfigured', 'The upload service is not set up yet (run setup()).');

  const profile = fsGet_('users/' + user.uid);
  if (!profile) fail_('profile', 'Complete your profile before submitting.');
  if (profile.status === 'blocked') fail_('forbidden', 'Your account cannot submit material. Contact the archive team.');

  const open = fsCount_('submissions', [['uid', '==', user.uid], ['status', 'in', ['pending', 'uploading']]]);
  if (open >= s.maxPendingPerUser) fail_('limit', 'You have ' + open + ' submissions waiting for review. Please wait for those first.');
  const today = fsCount_('submissions', [['uid', '==', user.uid], ['createdAt', '>=', new Date(Date.now() - 864e5)]]);
  if (today >= s.maxPerDay) fail_('limit', 'Daily submission limit reached. Try again tomorrow.');

  const meta = validateMeta_(req.meta);
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  const now = new Date();
  const base = {
    status: 'pending', uid: user.uid, email: user.email,
    name: clean_(profile.displayName || user.name || user.email.split('@')[0], 80),
    affiliation: profile.affiliation || '',
    meta: meta, createdAt: now, updatedAt: now,
    history: [{ at: now, by: user.email, action: 'submitted', note: '' }]
  };

  if (req.kind === 'link') {
    base.kind = 'link';
    base.link = validateLink_(req.link);
    fsCreate_('submissions', id, base);
    audit_(user, 'submit', id, base.link);
    notifyAdminsOfSubmission_(id, base);
    return { submissionId: id, done: true };
  }

  const file = validateFile_(req.file, s);
  const fp = fsGet_('fingerprints/' + file.sha256);
  if (fp && fp.status !== 'removed') {
    fail_('duplicate', fp.status === 'pending'
      ? 'An identical file is already waiting for review.'
      : 'This exact file is already in the archive' + (fp.name ? ' as “' + fp.name + '”' : '') + '.');
  }

  const q = storageQuota_();
  if (q.limit && q.usage + file.size > q.limit - s.reserveMB * MIB) {
    fail_('storage', 'The archive is short on storage right now, so new uploads are on hold. You can still submit a link.');
  }

  const session = driveStartResumable_({
    name: file.name,
    parents: [cfg_().pendingFolder],
    description: 'Pending ACCE Archive submission ' + id,
    appProperties: { submissionId: id, uid: user.uid }
  }, file.mime, file.size);

  base.kind = 'file';
  base.status = 'uploading';
  base.file = { name: file.name, size: file.size, mime: file.mime, sha256: file.sha256, driveId: '' };
  base.history = [];
  fsCreate_('submissions', id, base);
  saveUpload_(id, { session: session, uid: user.uid, size: file.size, mime: file.mime, sha256: file.sha256, name: file.name, received: 0 });
  return { submissionId: id, uploadId: id, chunkBytes: CHUNK_BYTES };
}

function saveUpload_(id, st) { CacheService.getScriptCache().put('up:' + id, JSON.stringify(st), 21600); }
function loadUpload_(id) {
  const v = typeof id === 'string' && id.length < 40 ? CacheService.getScriptCache().get('up:' + id) : null;
  return v ? JSON.parse(v) : null;
}

function actChunk_(req, user) {
  const id = req.uploadId;
  const st = loadUpload_(id);
  if (!st) {
    // A retry after the final chunk already succeeded (its response was lost) lands here.
    const sub = /^[a-zA-Z0-9]{8,40}$/.test(String(id)) ? fsGet_('submissions/' + id) : null;
    if (sub && sub.uid === user.uid && sub.status === 'pending') return { done: true, submissionId: id };
  }
  if (!st || st.uid !== user.uid) fail_('expired', 'This upload session has expired. Please start the upload again.');

  const offset = Number(req.offset);
  if (offset !== st.received) {
    // The client and server disagree (usually a lost response); ask Drive for the truth.
    const s = driveUploadStatus_(st.session, st.size);
    if (s.expired) { abandon_(id); fail_('expired', 'This upload session has expired. Please start again.'); }
    if (s.file) return finalizeUpload_(id, st, s.file, user);
    st.received = s.received;
    saveUpload_(id, st);
    return { next: st.received };
  }

  let bytes;
  try { bytes = Utilities.base64Decode(String(req.data || '')); } catch (x) { fail_('bad_request', 'Corrupted chunk.'); }
  const last = offset + bytes.length === st.size;
  if (!bytes.length || bytes.length > CHUNK_BYTES || offset + bytes.length > st.size) fail_('bad_request', 'Chunk does not fit the file.');
  if (!last && bytes.length % (256 * 1024) !== 0) fail_('bad_request', 'Chunk size must be a multiple of 256 KiB.');

  const r = driveSendChunk_(st.session, bytes, offset, st.size, st.mime);
  if (r.expired) { abandon_(id); fail_('expired', 'This upload session has expired. Please start again.'); }
  if (r.file) return finalizeUpload_(id, st, r.file, user);
  st.received = r.received;
  saveUpload_(id, st);
  return { next: st.received };
}

function finalizeUpload_(id, st, file, user) {
  CacheService.getScriptCache().remove('up:' + id);
  const sizeOk = Number(file.size) === st.size;
  const hashOk = !file.sha256Checksum || file.sha256Checksum.toLowerCase() === st.sha256;
  if (!sizeOk || !hashOk) {
    driveDelete_(file.id);
    fsPatch_('submissions/' + id, { status: 'abandoned', updatedAt: new Date() });
    fail_('integrity', 'The file was damaged in transit. Please upload it again.');
  }
  const now = new Date();
  const sub = fsGet_('submissions/' + id);
  fsPatch_('submissions/' + id, {
    status: 'pending', 'file.driveId': file.id, updatedAt: now,
    history: [{ at: now, by: user.email, action: 'submitted', note: '' }]
  });
  fsSet_('fingerprints/' + st.sha256, {
    sha256: st.sha256, size: st.size, name: st.name, driveId: file.id,
    submissionId: id, source: 'submission', status: 'pending', at: now
  });
  audit_(user, 'submit', id, st.name);
  notifyAdminsOfSubmission_(id, sub);
  return { done: true, submissionId: id };
}

function abandon_(id) {
  CacheService.getScriptCache().remove('up:' + id);
  fsPatch_('submissions/' + id, { status: 'abandoned', updatedAt: new Date() });
}

function actWithdraw_(req, user) {
  const sub = mustGetSubmission_(req.submissionId);
  if (sub.uid !== user.uid) fail_('forbidden', 'You can only withdraw your own submissions.');
  if (['pending', 'uploading'].indexOf(sub.status) < 0) fail_('state', 'Only submissions awaiting review can be withdrawn.');
  removePendingFile_(sub);
  fsPatch_('submissions/' + sub._id, {
    status: 'withdrawn', updatedAt: new Date(),
    history: appendHistory_(sub, user.email, 'withdrawn', '')
  });
  audit_(user, 'withdraw', sub._id, '');
  return { status: 'withdrawn' };
}

/* ---------- reviewer actions ---------- */
function actReview_(req, user) {
  const sub = mustGetSubmission_(req.submissionId);
  if (sub.status !== 'pending') fail_('state', 'This submission was already ' + sub.status + '.');
  const note = clean_(req.note, 1000, true);
  const now = new Date();

  if (req.decision === 'reject') {
    if (note.length < 5) fail_('invalid', 'Tell the contributor why it was declined.');
    removePendingFile_(sub);
    fsPatch_('submissions/' + sub._id, {
      status: 'rejected', note: note, decidedAt: now, updatedAt: now,
      reviewer: { email: user.email, name: user.name },
      history: appendHistory_(sub, user.email, 'rejected', note)
    });
    audit_(user, 'reject', sub._id, note);
    notifySubmitter_(sub, 'rejected', note);
    return { status: 'rejected' };
  }
  if (req.decision !== 'approve') fail_('bad_request', 'Unknown decision.');

  const meta = validateMeta_(req.meta || sub.meta);
  let folderId = String(req.folderId || '');
  const where = folderId && locateInRoots_(folderId);
  if (!where) fail_('invalid', 'Choose a destination folder inside the public archive.');
  if (req.newFolderName) {
    const name = clean_(req.newFolderName, 100).replace(/[\\/]+/g, '-');
    if (name) { folderId = driveCreateFolder_(name, folderId).id; where.path.push(name); }
  }
  meta.collection = where.key;
  const folderPath = where.path.join(' / ');
  const credit = meta.credit ? sub.name : '';
  let published;

  if (sub.kind === 'link') {
    const itemId = 'link-' + sub._id;
    fsSet_('items/' + itemId, catalogItem_(meta, {
      kind: 'link', storage: { provider: 'url', url: sub.link }, folderId: folderId, folderPath: folderPath,
      contributor: credit, submissionId: sub._id, source: 'submission', approvedAt: now, updatedBy: user.email
    }));
    published = { itemId: itemId, folderId: folderId, folderPath: folderPath, url: sub.link };
  } else {
    if (!sub.file || !sub.file.driveId) fail_('state', 'The uploaded file is missing.');
    const fileName = req.fileName ? cleanFileName_(req.fileName) : null;
    const name = fileName && fileName.ext === sub.file.name.split('.').pop().toLowerCase() ? fileName.name : sub.file.name;
    const moved = driveUpdate_(sub.file.driveId, {
      name: name,
      description: describe_(meta, credit, sub._id),
      properties: driveProps_(meta, sub._id),
      appProperties: { submissionId: sub._id, uid: sub.uid }
    }, folderId, cfg_().pendingFolder);
    fsSet_('items/' + moved.id, catalogItem_(meta, {
      kind: 'file', file: { name: name, mime: sub.file.mime, size: sub.file.size, sha256: sub.file.sha256 },
      storage: { provider: 'drive', id: moved.id }, folderId: folderId, folderPath: folderPath, legacyPath: folderPath,
      contributor: credit, submissionId: sub._id, source: 'submission', approvedAt: now, updatedBy: user.email
    }));
    fsPatch_('fingerprints/' + sub.file.sha256, { status: 'published', driveId: moved.id, name: name });
    published = { fileId: moved.id, folderId: folderId, folderPath: folderPath, name: name, url: moved.webViewLink || '' };
  }

  if (meta.courseCode) {
    const course = {};
    course['destinations.' + where.key] = { folderId: folderId, path: folderPath };
    fsPatch_('courses/' + meta.courseCode, course);
  }
  fsPatch_('submissions/' + sub._id, {
    status: 'approved', meta: meta, note: note, decidedAt: now, updatedAt: now, published: published,
    reviewer: { email: user.email, name: user.name },
    history: appendHistory_(sub, user.email, 'approved', note)
  });
  audit_(user, 'approve', sub._id, folderPath);
  notifySubmitter_(sub, 'approved', note, published);
  return { status: 'approved', published: published };
}

function actStats_() {
  const counts = {};
  ['pending', 'approved', 'rejected', 'withdrawn'].forEach(function (s) {
    counts[s] = fsCount_('submissions', [['status', '==', s]]);
  });
  counts.reports = fsCount_('reports', [['status', '==', 'open']]);
  return { storage: storageQuota_(), counts: counts, version: VERSION };
}

/* ---------- admin actions ---------- */
function actCreateFolder_(req, user) {
  const where = locateInRoots_(String(req.parentId || ''));
  if (!where) fail_('invalid', 'Parent folder must be inside the public archive.');
  const name = clean_(req.name, 100).replace(/[\\/]+/g, '-');
  if (name.length < 1) fail_('invalid', 'Folder name is empty.');
  const f = driveCreateFolder_(name, req.parentId);
  audit_(user, 'create-folder', f.id, where.path.concat(name).join(' / '));
  return { id: f.id, name: f.name };
}

/** Attach catalogue metadata to any public file, including ones collected before the dashboard existed. */
function actAnnotate_(req, user) {
  const f = driveGet_(String(req.fileId || ''), 'id,name,mimeType,parents,size,sha256Checksum');
  const where = f.parents && f.parents[0] && locateInRoots_(f.parents[0]);
  if (!where || f.mimeType === FOLDER_MIME_) fail_('invalid', 'That file is not part of the public archive.');
  const meta = validateMeta_(Object.assign({ rights: 'educational' }, req.meta, { collection: where.key }));
  const existing = fsGet_('items/' + f.id);
  if (existing) delete existing._id;
  driveUpdate_(f.id, { description: describe_(meta, existing ? existing.contributor : '', existing ? existing.submissionId : ''),
    properties: driveProps_(meta, existing ? existing.submissionId : '') });
  fsSet_('items/' + f.id, catalogItem_(meta, {
    kind: 'file', file: { name: f.name, mime: f.mimeType, size: Number(f.size || 0), sha256: f.sha256Checksum || '' },
    storage: { provider: 'drive', id: f.id }, folderId: f.parents[0], folderPath: where.path.join(' / '), legacyPath: where.path.join(' / '),
    contributor: existing ? existing.contributor || '' : '', submissionId: existing ? existing.submissionId || '' : '',
    source: existing ? existing.source || 'import' : 'import', approvedAt: existing && existing.approvedAt ? existing.approvedAt : new Date(),
    curated: true, updatedBy: user.email
  }));
  audit_(user, 'annotate', f.id, meta.title);
  return { fileId: f.id };
}

/** Remove a published file or link from public view. mode "withdraw" keeps a private copy; "delete" frees the space. */
function actTakedown_(req, user) {
  const reason = clean_(req.reason, 500, true);
  if (reason.length < 5) fail_('invalid', 'Record why it is being taken down.');
  const id = String(req.fileId || '');
  // ids end up in REST paths, so allow no "/" or "."
  if (!/^(link-)?[\w-]{1,100}$/.test(id)) fail_('bad_request', 'Unknown file.');
  if (req.reportId && !/^[A-Za-z0-9]{8,40}$/.test(String(req.reportId))) fail_('bad_request', 'Unknown report.');
  if (id.indexOf('link-') === 0) {
    // keep the record (marked withdrawn) so every cached catalogue learns about it on its next sync
    if (fsGet_('items/' + id)) fsPatch_('items/' + id, { status: 'withdrawn', withdrawnReason: reason, withdrawnAt: new Date(), updatedAt: new Date(), updatedBy: user.email });
  } else {
    const f = driveGet_(id, 'id,name,mimeType,parents,sha256Checksum');
    const where = f.parents && f.parents[0] && locateInRoots_(f.parents[0]);
    if (!where || f.mimeType === FOLDER_MIME_) fail_('invalid', 'That file is not part of the public archive.');
    if (req.mode === 'delete') driveDelete_(f.id);
    else driveUpdate_(f.id, {}, cfg_().withdrawnFolder || fail_('misconfigured', 'Withdrawn folder missing; run setup().'), f.parents[0]);
    if (f.sha256Checksum) fsPatch_('fingerprints/' + f.sha256Checksum, { status: 'removed' });
    if (fsGet_('items/' + f.id)) fsPatch_('items/' + f.id, { status: 'withdrawn', withdrawnReason: reason, withdrawnAt: new Date(), updatedAt: new Date(), updatedBy: user.email });
  }
  if (req.reportId) fsPatch_('reports/' + req.reportId, { status: 'resolved', resolution: 'taken down: ' + reason, resolvedBy: user.email, resolvedAt: new Date() });
  audit_(user, 'takedown', id, reason);
  return { ok: true };
}

function actMaintenance_(req, user) {
  if (req.task === 'cleanup') return Object.assign({ task: 'cleanup' }, cleanup_());
  if (req.task === 'fingerprints') return Object.assign({ task: 'fingerprints' }, indexFingerprints_());
  fail_('bad_request', 'Unknown maintenance task.');
}

function actSetAdmin_(req, user) {
  const email = clean_(req.email, 200).toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) fail_('invalid', 'Enter a valid email address.');
  if (email === user.email) fail_('invalid', 'You cannot change your own role.');
  if (ROOT_OWNERS.indexOf(email) >= 0) fail_('invalid', 'That account is a permanent owner.');
  const folders = [cfg_().pendingFolder, cfg_().withdrawnFolder].filter(String);
  CacheService.getScriptCache().remove('role:' + email);
  CacheService.getScriptCache().remove('adminEmails');
  if (!req.role) {
    fsDelete_('admins/' + encodeURIComponent(email));
    folders.forEach(function (f) { try { driveUnshare_(f, email); } catch (e) { console.warn(e); } });
    audit_(user, 'remove-admin', email, '');
    return { email: email, role: null };
  }
  if (!ROLE_RANK[req.role]) fail_('invalid', 'Unknown role.');
  fsSet_('admins/' + encodeURIComponent(email), { email: email, role: req.role, addedBy: user.email, addedAt: new Date(), notify: req.notify !== false });
  // reviewers need to open pending files in Drive to judge them
  folders.forEach(function (f) { try { driveShare_(f, email, 'reader'); } catch (e) { console.warn(e); } });
  audit_(user, 'set-admin', email, req.role);
  return { email: email, role: req.role };
}

/* ---------- helpers ---------- */
/**
 * Catalogue record (items/{id}): the archive's source of truth. Bytes live wherever
 * `storage` points ({provider:'drive', id} | {provider:'r2', key} | {provider:'url', url}),
 * so files can move between providers without changing links or metadata.
 */
function catalogItem_(meta, extra) {
  const m = Object.assign({}, meta);
  return Object.assign({
    title: m.title, collection: m.collection, type: m.type, courseCode: m.courseCode, courseTitle: m.courseTitle,
    level: m.level, session: m.session, examKind: m.examKind, examYear: m.examYear, instructors: m.instructors,
    authors: m.authors, curriculum: m.curriculum, curricula: m.curricula || [], language: m.language,
    description: m.description, tags: m.tags || [], rights: m.rights, credit: m.credit !== false,
    status: 'published', curated: true, updatedAt: new Date()
  }, extra);
}

function mustGetSubmission_(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9]{8,40}$/.test(id)) fail_('bad_request', 'Unknown submission.');
  const sub = fsGet_('submissions/' + id);
  if (!sub) fail_('not_found', 'Submission not found.');
  return sub;
}

function removePendingFile_(sub) {
  if (sub.kind === 'file' && sub.file) {
    if (sub.file.driveId) driveDelete_(sub.file.driveId);
    const fp = sub.file.sha256 && fsGet_('fingerprints/' + sub.file.sha256);
    if (fp && fp.submissionId === sub._id) fsDelete_('fingerprints/' + sub.file.sha256);
  }
  CacheService.getScriptCache().remove('up:' + sub._id);
}

function appendHistory_(sub, by, action, note) {
  return (sub.history || []).concat([{ at: new Date(), by: by, action: action, note: note || '' }]).slice(-40);
}

function audit_(user, action, target, note) {
  try {
    fsCreate_('audit', null, { at: new Date(), actor: user.email, action: action, target: String(target || ''), note: String(note || '').slice(0, 500) });
  } catch (e) { console.warn('audit failed', e); }
}

/** Human-readable record stored with the file itself, so Drive alone stays self-describing. */
function describe_(m, contributor, submissionId) {
  const lines = [m.title];
  const add = function (k, v) { if (v) lines.push(k + ': ' + v); };
  add('Type', TAXONOMY.types[m.type]);
  add('Course', [m.courseCode, m.courseTitle].filter(String).join(' – '));
  add('Year/term', m.level);
  add('Session', m.session);
  add('Exam', [TAXONOMY.examKinds[m.examKind], m.examYear].filter(Boolean).join(' '));
  add('Instructors', m.instructors);
  add('Authors', m.authors);
  add('Curriculum', m.curriculum);
  add('Language', TAXONOMY.languages[m.language]);
  add('Tags', (m.tags || []).join(', '));
  add('Rights', TAXONOMY.rights[m.rights]);
  add('Contributed by', contributor);
  if (m.description) lines.push('', m.description);
  if (submissionId) lines.push('', 'ACCE Archive record ' + submissionId);
  return lines.join('\n').slice(0, 4000);
}

/** Public, machine-readable Drive properties (each key+value must stay under 124 bytes). */
function driveProps_(m, submissionId) {
  const p = {
    acce_title: m.title, acce_type: m.type, acce_course: m.courseCode, acce_level: m.level,
    acce_session: m.session, acce_year: m.examYear ? String(m.examYear) : '', acce_kind: m.examKind,
    acce_curriculum: m.curriculum, acce_lang: m.language, acce_tags: (m.tags || []).join(','), acce_record: submissionId || ''
  };
  Object.keys(p).forEach(function (k) {
    let v = String(p[k] || '');
    while (Utilities.newBlob(k + v).getBytes().length > 120) v = v.slice(0, -1);
    p[k] = v || null;            // null clears a property
  });
  return p;
}

/* ---------- notifications ---------- */
function adminEmails_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('adminEmails');
  if (hit) return JSON.parse(hit);
  const list = cfg_().owners.slice();
  fsQuery_('admins', [], null, 50).forEach(function (a) {
    if (a.notify !== false && a.email && list.indexOf(a.email) < 0) list.push(a.email);
  });
  cache.put('adminEmails', JSON.stringify(list), 600);
  return list;
}

function notifyAdminsOfSubmission_(id, sub) {
  try {
    if (!settings_().notifyAdmins || MailApp.getRemainingDailyQuota() < 5) return;
    const to = adminEmails_();
    if (!to.length) return;
    const m = sub.meta || {};
    MailApp.sendEmail({
      to: to.join(','),
      subject: '[ACCE Archive] New submission: ' + m.title,
      name: 'ACCE Archive',
      htmlBody: mailHtml_('New submission waiting for review',
        '<b>' + esc_(m.title) + '</b><br>' + esc_(TAXONOMY.types[m.type] || '') + (m.courseCode ? ' · ' + esc_(m.courseCode) : '') +
        '<br>From ' + esc_(sub.name || '') + ' (' + esc_(sub.email || '') + ')',
        cfg_().siteUrl + '/#/admin/review/' + id, 'Open review queue')
    });
  } catch (e) { console.warn('notify admins failed', e); }
}

function notifySubmitter_(sub, outcome, note, published) {
  try {
    if (!settings_().notifySubmitters || !sub.email || MailApp.getRemainingDailyQuota() < 5) return;
    const title = (sub.meta && sub.meta.title) || 'your submission';
    const approved = outcome === 'approved';
    MailApp.sendEmail({
      to: sub.email,
      subject: approved ? 'Published in the ACCE Archive: ' + title : 'About your ACCE Archive submission: ' + title,
      name: 'ACCE Archive',
      htmlBody: mailHtml_(approved ? 'Your submission is now public' : 'Your submission was not accepted',
        '<b>' + esc_(title) + '</b>' + (approved && published ? '<br>Filed under ' + esc_(published.folderPath) : '') +
        (note ? '<br><br>Reviewer note:<br>' + esc_(note).replace(/\n/g, '<br>') : '') +
        '<br><br>Thank you for helping the department’s archive grow.',
        cfg_().siteUrl + '/#/my', 'See your submissions')
    });
  } catch (e) { console.warn('notify submitter failed', e); }
}

function mailHtml_(heading, body, link, label) {
  return '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0d2a1e">' +
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#12833f">ACCE Archive · GSTU</div>' +
    '<h2 style="margin:8px 0 14px;font-size:20px">' + esc_(heading) + '</h2>' +
    '<p style="line-height:1.55;font-size:14px">' + body + '</p>' +
    '<p><a href="' + esc_(link) + '" style="display:inline-block;background:#12833f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">' + esc_(label) + '</a></p></div>';
}

function esc_(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
