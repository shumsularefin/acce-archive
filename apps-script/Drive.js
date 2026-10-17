/* ============================================================
   Google Drive REST helpers (v3), authorised as the script owner.
   ============================================================ */
const DRIVE_API_ = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME_ = 'application/vnd.google-apps.folder';

function driveFetch_(method, url, body, extra) {
  const opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const text = res.getContentText();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
  return { code: code, json: json, headers: res.getHeaders() };
}

function driveOk_(r, what) {
  if (r.code >= 200 && r.code < 300) return r.json;
  const msg = (r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.code);
  const e = new Error('Drive (' + what + '): ' + msg);
  e.code = r.code === 404 ? 'not_found' : 'backend';
  throw e;
}

function driveGet_(id, fields) {
  return driveOk_(driveFetch_('get', DRIVE_API_ + '/files/' + encodeURIComponent(id) +
    '?supportsAllDrives=true&fields=' + encodeURIComponent(fields || 'id,name,mimeType,parents,trashed')), 'get');
}

function driveList_(q, fields, pageToken) {
  const url = DRIVE_API_ + '/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
    '&q=' + encodeURIComponent(q) +
    '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
  return driveOk_(driveFetch_('get', url), 'list');
}

function driveUpdate_(id, meta, addParent, removeParent) {
  let url = DRIVE_API_ + '/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=id,name,parents,webViewLink,size';
  if (addParent) url += '&addParents=' + encodeURIComponent(addParent);
  if (removeParent) url += '&removeParents=' + encodeURIComponent(removeParent);
  return driveOk_(driveFetch_('patch', url, meta || {}), 'update');
}

/** Permanent delete (frees quota immediately, unlike trash). */
function driveDelete_(id) {
  const r = driveFetch_('delete', DRIVE_API_ + '/files/' + encodeURIComponent(id) + '?supportsAllDrives=true');
  if (r.code !== 204 && r.code !== 200 && r.code !== 404) driveOk_(r, 'delete');
}

function driveCreateFolder_(name, parentId) {
  return driveOk_(driveFetch_('post', DRIVE_API_ + '/files?supportsAllDrives=true&fields=id,name',
    { name: name, mimeType: FOLDER_MIME_, parents: [parentId] }), 'create folder');
}

function driveShare_(fileId, email, role) {
  return driveOk_(driveFetch_('post', DRIVE_API_ + '/files/' + encodeURIComponent(fileId) +
    '/permissions?sendNotificationEmail=false&supportsAllDrives=true',
    { type: 'user', role: role || 'reader', emailAddress: email }), 'share');
}

function driveUnshare_(fileId, email) {
  const r = driveOk_(driveFetch_('get', DRIVE_API_ + '/files/' + encodeURIComponent(fileId) +
    '/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress,role)'), 'permissions');
  (r.permissions || []).forEach(function (p) {
    if ((p.emailAddress || '').toLowerCase() === email && p.role !== 'owner') {
      driveFetch_('delete', DRIVE_API_ + '/files/' + encodeURIComponent(fileId) + '/permissions/' + p.id + '?supportsAllDrives=true');
    }
  });
}

function storageQuota_() {
  const r = driveOk_(driveFetch_('get', DRIVE_API_ + '/about?fields=storageQuota'), 'about');
  const q = r.storageQuota || {};
  return {
    limit: q.limit ? Number(q.limit) : 0,          // 0 = unlimited (pooled/Workspace)
    usage: Number(q.usage || 0),
    usageInDrive: Number(q.usageInDrive || 0),
    usageInDriveTrash: Number(q.usageInDriveTrash || 0)
  };
}

/**
 * Resolve which public collection a folder belongs to by walking up its
 * parents. Returns {key, path:[names root→folder]} or null when the folder
 * is outside every public root. This guards every write the dashboard asks for.
 */
function locateInRoots_(folderId) {
  const roots = cfg_().roots;
  const byId = {};
  Object.keys(roots).forEach(function (k) { byId[roots[k]] = k; });
  const names = [];
  let id = folderId;
  for (let depth = 0; depth < 20 && id; depth++) {
    let f;
    try { f = driveGet_(id, 'id,name,mimeType,parents,trashed'); }
    catch (e) { if (e.code === 'not_found') return null; throw e; }   // walked out of what we can see

    if (f.trashed || f.mimeType !== FOLDER_MIME_) return null;
    if (byId[f.id]) {
      names.unshift(TAXONOMY.collections[byId[f.id]] || f.name);
      return { key: byId[f.id], path: names };
    }
    names.unshift(f.name);
    id = (f.parents || [])[0];
  }
  return null;
}

/** Start a resumable upload session and return its session URI. */
function driveStartResumable_(meta, mime, size) {
  const r = driveFetch_('post',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true' +
    '&fields=' + encodeURIComponent('id,name,size,mimeType,sha256Checksum,md5Checksum'),
    meta, { headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size)
    } });
  driveOk_(r, 'start upload');
  const loc = header_(r.headers, 'location');
  if (!loc) { const e = new Error('Drive did not open an upload session.'); e.code = 'backend'; throw e; }
  return loc;
}

/** Send one chunk. Returns {received} while incomplete or {file} once Drive has the whole file. */
function driveSendChunk_(session, bytes, offset, total, mime) {
  const end = offset + bytes.length - 1;
  const res = UrlFetchApp.fetch(session, {
    method: 'put',
    payload: bytes,
    contentType: mime,
    headers: { 'Content-Range': 'bytes ' + offset + '-' + end + '/' + total },
    muteHttpExceptions: true,
    followRedirects: false     // 308 means "resume incomplete", not a redirect
  });
  return parseUploadResponse_(res);
}

/** Ask Drive how much of a session it has (used to recover from a lost response). */
function driveUploadStatus_(session, total) {
  const res = UrlFetchApp.fetch(session, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + total },
    muteHttpExceptions: true,
    followRedirects: false
  });
  return parseUploadResponse_(res);
}

function parseUploadResponse_(res) {
  const code = res.getResponseCode();
  if (code === 308) {
    const range = header_(res.getHeaders(), 'range');        // "bytes=0-1048575"
    return { received: range ? Number(range.split('-')[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) return { file: JSON.parse(res.getContentText()) };
  if (code === 404 || code === 410) return { expired: true };
  const e = new Error('Drive refused the upload (HTTP ' + code + ').');
  e.code = 'backend';
  throw e;
}

function header_(headers, name) {
  const want = name.toLowerCase();
  const key = Object.keys(headers || {}).filter(function (k) { return k.toLowerCase() === want; })[0];
  const v = key ? headers[key] : '';
  return Array.isArray(v) ? v[0] : v;
}
