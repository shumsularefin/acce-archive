// Runs the Apps Script sources in a Node VM with in-memory fakes for
// Drive, Firestore, Identity Toolkit and the Apps Script services.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps-script');
const FILES = ['Taxonomy.js', 'Firestore.js', 'Drive.js', 'Code.js', 'Setup.js'];
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

/** Synchronous HTTP (UrlFetchApp is synchronous) via curl, used against the emulators. */
function curlFetch(url, opts = {}) {
  const args = ['-s', '-X', (opts.method || 'get').toUpperCase(), '-w', '\n%{http_code}', '-H', `Content-Type: ${opts.contentType || 'application/json'}`];
  for (const [k, v] of Object.entries(opts.headers || {})) args.push('-H', `${k}: ${v}`);
  if (opts.payload !== undefined) args.push('--data-binary', '@-');
  args.push(url);
  const out = execFileSync('curl', args, { input: opts.payload ?? '', maxBuffer: 64 * 1024 * 1024 }).toString();
  const i = out.lastIndexOf('\n');
  const body = out.slice(0, i), code = Number(out.slice(i + 1));
  return { getResponseCode: () => code, getContentText: () => body, getHeaders: () => ({}) };
}

/**
 * @param remote  {firestore, auth} emulator origins: Firestore and token checks then go over
 *                real HTTP to the emulators instead of the in-memory fakes. Drive stays fake.
 */
export function createHarness({ roots = { bsc: 'root-bsc', msc: 'root-msc', qbank: 'root-q', misc: 'root-misc' }, remote = null, projectId = 'demo' } = {}) {
  /* ---------- fake Firestore (bypasses rules, like the real owner token) ---------- */
  const db = new Map();
  const clone = (v) => structuredClone(v);
  const fsApi = {
    fsGet_: (p) => (db.has(p) ? { ...clone(db.get(p)), _id: p.split('/').pop() } : null),
    fsCreate_: (col, id, data) => {
      id = id || crypto.randomUUID().replace(/-/g, '');
      const p = `${col}/${id}`;
      if (db.has(p)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
      db.set(p, clone(data));
      return id;
    },
    fsSet_: (p, data) => { const d = clone(data); delete d._id; db.set(p, d); },
    fsPatch_: (p, data, opts = {}) => {
      if (opts.mustExist && !db.has(p)) throw new Error('missing');
      const doc = db.get(p) || {};
      for (const [k, v] of Object.entries(data)) {
        const parts = k.split('.');
        let node = doc;
        parts.slice(0, -1).forEach((x) => { node = node[x] = node[x] || {}; });
        node[parts.at(-1)] = clone(v);
      }
      db.set(p, doc);
    },
    fsDelete_: (p) => { db.delete(decodeURIComponent(p)); },
    fsQuery_: (col, filters = [], orderBy, limit) => {
      let rows = [...db.entries()].filter(([p]) => p.startsWith(col + '/') && p.split('/').length === 2)
        .map(([p, d]) => ({ ...clone(d), _id: p.split('/')[1] }));
      for (const [f, op, v] of filters) {
        rows = rows.filter((r) => {
          const x = r[f];
          if (op === '==') return x === v;
          if (op === 'in') return v.includes(x);
          if (op === '>=') return x >= v;
          if (op === '<') return x < v;
          throw new Error('op ' + op);
        });
      }
      return limit ? rows.slice(0, limit) : rows;
    },
    fsCount_: (col, filters) => fsApi.fsQuery_(col, filters).length,
    fsCommit_: (writes) => writes.forEach((w) => (w.del ? db.delete(w.del) : fsApi.fsSet_(w.set, w.data)))
  };
  // admin docs are addressed as admins/<encodeURIComponent(email)>
  const norm = (p) => decodeURIComponent(p);
  for (const k of ['fsGet_', 'fsSet_', 'fsPatch_']) { const f = fsApi[k]; fsApi[k] = (p, ...a) => f(norm(p), ...a); }

  /* ---------- fake Drive ---------- */
  const drive = new Map();      // id -> {id,name,mimeType,parents,size,bytes,properties,...}
  const FOLDER = 'application/vnd.google-apps.folder';
  const addFolder = (id, name, parent) => drive.set(id, { id, name, mimeType: FOLDER, parents: parent ? [parent] : [] });
  for (const [k, id] of Object.entries(roots)) addFolder(id, k.toUpperCase(), 'my-drive');
  addFolder('pending', 'Pending', 'system');
  addFolder('withdrawn', 'Withdrawn', 'system');
  addFolder('private', 'Private stuff', 'my-drive');
  const sessions = new Map();
  let seq = 0;
  const quota = { limit: String(15 * 1024 ** 3), usage: String(2 * 1024 ** 3), usageInDrive: String(1024 ** 3), usageInDriveTrash: '0' };

  const res = (code, body, headers = {}) => ({
    getResponseCode: () => code,
    getContentText: () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    getHeaders: () => headers
  });
  const tokens = new Map();     // idToken -> user record
  const fetchLog = [];

  function fetch(url, opts = {}) {
    const method = (opts.method || 'get').toLowerCase();
    fetchLog.push(`${method} ${url}`);
    const u = new URL(url);
    if (remote && u.host === 'firestore.googleapis.com') return curlFetch(remote.firestore + u.pathname + u.search, opts);
    if (remote && u.host === 'identitytoolkit.googleapis.com') return curlFetch(`${remote.auth}/identitytoolkit.googleapis.com${u.pathname}${u.search}`, opts);
    if (u.host === 'identitytoolkit.googleapis.com') {
      const t = JSON.parse(opts.payload).idToken;
      return tokens.has(t) ? res(200, { users: [tokens.get(t)] }) : res(400, { error: { message: 'INVALID_ID_TOKEN' } });
    }
    if (u.host === 'upload.fake') {
      const s = sessions.get(u.pathname);
      if (!s) return res(404, {});
      const range = (opts.headers || {})['Content-Range'];
      if (range.startsWith('bytes */')) return s.received ? res(308, '', { Range: `bytes=0-${s.received - 1}` }) : res(308, '');
      const [, a, b, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range).map(Number);
      if (a !== s.received) return res(400, {});
      const bytes = Buffer.from(opts.payload.map((x) => x & 255));
      if (bytes.length !== b - a + 1) return res(400, {});
      s.chunks.push(bytes);
      s.received += bytes.length;
      if (s.received < total) return res(308, '', { Range: `bytes=0-${s.received - 1}` });
      const all = Buffer.concat(s.chunks);
      const id = `file${++seq}`;
      const file = { ...s.meta, id, mimeType: s.mime, size: String(all.length), sha256Checksum: s.corrupt ? 'f'.repeat(64) : crypto.createHash('sha256').update(all).digest('hex') };
      drive.set(id, file);
      sessions.delete(u.pathname);
      return res(200, { id, name: file.name, size: file.size, mimeType: file.mimeType, sha256Checksum: file.sha256Checksum });
    }
    if (u.pathname === '/upload/drive/v3/files') {
      const key = `/session/${++seq}`;
      sessions.set(key, { meta: JSON.parse(opts.payload), mime: opts.headers['X-Upload-Content-Type'], received: 0, chunks: [], corrupt: harness.corruptNext });
      harness.corruptNext = false;
      return res(200, {}, { Location: `https://upload.fake${key}` });
    }
    if (u.pathname === '/drive/v3/about') return res(200, { storageQuota: quota });
    const m = /^\/drive\/v3\/files(?:\/([^/]+))?(\/permissions)?/.exec(u.pathname);
    if (m) {
      const id = m[1] && decodeURIComponent(m[1]);
      if (m[2]) return res(200, { permissions: [] });
      if (!id && method === 'post') {
        const meta = JSON.parse(opts.payload);
        const nid = `folder${++seq}`;
        drive.set(nid, { id: nid, name: meta.name, mimeType: meta.mimeType, parents: meta.parents });
        return res(200, { id: nid, name: meta.name });
      }
      if (!id) {
        const q = u.searchParams.get('q');
        const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((x) => x[1]);
        return res(200, { files: [...drive.values()].filter((f) => f.parents?.some((p) => parents.includes(p))) });
      }
      const f = drive.get(id);
      if (!f) return res(404, { error: { message: 'File not found' } });
      if (method === 'get') return res(200, f);
      if (method === 'delete') { drive.delete(id); return res(204); }
      if (method === 'patch') {
        const meta = opts.payload ? JSON.parse(opts.payload) : {};
        Object.assign(f, meta);
        const add = u.searchParams.get('addParents'), rem = u.searchParams.get('removeParents');
        if (rem) f.parents = f.parents.filter((p) => p !== rem);
        if (add) f.parents.push(add);
        return res(200, { ...f, webViewLink: `https://drive.google.com/file/d/${id}/view` });
      }
    }
    throw new Error('Unhandled fetch ' + method + ' ' + url);
  }

  /* ---------- Apps Script services ---------- */
  const props = { FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: projectId, ROOT_FOLDERS: JSON.stringify(roots), PENDING_FOLDER_ID: 'pending', WITHDRAWN_FOLDER_ID: 'withdrawn', OWNER_EMAILS: 'owner@gmail.com' };
  const cache = new Map();
  const mail = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Decode: (s) => signed(Buffer.from(s, 'base64')),
      computeDigest: (_alg, s) => signed(crypto.createHash('sha256').update(s).digest()),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      newBlob: (s) => ({ getBytes: () => Buffer.from(s) })
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (m) => mail.push(m) },
    ScriptApp: { getOAuthToken: () => 'owner' },     // "owner" is the emulator's admin token
    UrlFetchApp: { fetch }
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  if (!remote) Object.assign(ctx, fsApi);   // replace the REST layer with the in-memory store

  const harness = {
    ctx, db, drive, mail, cache, fetchLog, quota, corruptNext: false,
    addUser(uid, email, { profile = true, role = null, verified = true } = {}) {
      const token = `tok-${uid}`;
      tokens.set(token, { localId: uid, email, emailVerified: verified, displayName: uid });
      if (profile) db.set(`users/${uid}`, { displayName: `User ${uid}`, email, affiliation: 'student' });
      if (role) db.set(`admins/${email}`, { email, role });
      return token;
    },
    addFolder,
    post(body) {
      const out = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(out.content);
    },
    call(body) {
      const r = harness.post(body);
      if (!r.ok) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
      return r.data;
    },
    /** Uploads a Buffer through init + chunk exactly as the browser does. */
    upload(token, buf, meta, name = 'notes.pdf') {
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const init = harness.call({ action: 'init', idToken: token, meta, file: { name, size: buf.length, sha256 } });
      let offset = 0, out;
      while (offset < buf.length) {
        const part = buf.subarray(offset, offset + init.chunkBytes);
        out = harness.call({ action: 'chunk', idToken: token, uploadId: init.uploadId, offset, data: part.toString('base64') });
        if (out.done) break;
        offset = out.next;
      }
      return { ...init, ...out, sha256 };
    }
  };
  return harness;
}

export const META = { title: 'Thermodynamics lecture notes', collection: 'bsc', type: 'lecture', courseCode: 'acce 3101', rights: 'own' };
