/* ============================================================
   Google Drive (read-only, API key). Lists the public archive folders
   exactly as before, plus a crawler that builds a whole-archive search
   index by querying many parents per request.
   ============================================================ */
import { CONFIG } from '../config.js';
import { store } from '../lib/dom.js';

const API = 'https://www.googleapis.com/drive/v3/files';
export const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime,webContentLink,webViewLink,thumbnailLink,description,properties';

export const isFolder = (f) => f.mimeType === FOLDER;

export function rootKeyOf(id) {
  return Object.keys(CONFIG.folders).find((k) => CONFIG.folders[k].id === id) || null;
}

async function driveGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let reason = `request failed (${res.status})`, detail = '';
    try { detail = (await res.json()).error?.errors?.[0]?.reason || ''; } catch {}
    if (res.status === 403) reason = 'access denied - check the API key and folder sharing';
    if (/rateLimit/i.test(detail)) reason = 'too many requests, try again in a minute';
    if (res.status === 404) reason = 'folder not found or no longer shared';
    if (res.status === 429) reason = 'too many requests, try again in a minute';
    throw new Error(reason);
  }
  return res.json();
}

/** Children of one folder (all pages), cached in sessionStorage for CONFIG.cacheMinutes. */
export async function listFolder(folderId, { fresh = false } = {}) {
  const cacheKey = `acce.dir.${folderId}`;
  if (!fresh) {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (c && Date.now() - c.t < CONFIG.cacheMinutes * 60000) return c.files;
    } catch {}
  }
  let files = [], token = '';
  do {
    const url = `${API}?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}`
      + `&orderBy=folder,name&pageSize=1000&fields=nextPageToken,files(${FIELDS})`
      + (token ? `&pageToken=${encodeURIComponent(token)}` : '')
      + `&key=${CONFIG.driveApiKey}`;
    const data = await driveGet(url);
    files = files.concat(data.files || []);
    token = data.nextPageToken || '';
  } while (token);
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), files })); } catch {}
  return files;
}

/** Name + parent of a folder, used to rebuild breadcrumbs from a shared link. */
const metaCache = new Map();
export async function folderMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const key = rootKeyOf(id);
  if (key) { const m = { id, name: CONFIG.folders[key].name, parents: [] }; metaCache.set(id, m); return m; }
  const m = await driveGet(`${API}/${encodeURIComponent(id)}?fields=id,name,parents,mimeType&key=${CONFIG.driveApiKey}`);
  metaCache.set(id, m);
  return m;
}

export function fileMeta(id) {
  return driveGet(`${API}/${encodeURIComponent(id)}?fields=${FIELDS},parents&key=${CONFIG.driveApiKey}`);
}

export const previewUrl = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
export const viewUrl = (f) => f.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`;
export const downloadUrl = (f) => f.webContentLink || viewUrl(f);

/* ---------- file kinds ---------- */
export function kindOf(f) {
  const m = f.mimeType || '', n = (f.name || '').toLowerCase();
  if (m === FOLDER) return 'folder';
  if (f.kind === 'link') return 'link';
  if (m.includes('pdf')) return 'pdf';
  // check slides/sheets first: their OOXML types also contain "officedocument"
  if (/presentation|powerpoint/.test(m)) return 'slides';
  if (/sheet|excel|csv/.test(m)) return 'sheet';
  if (/word|document|rtf|opendocument\.text/.test(m)) return 'doc';
  if (/zip|rar|compressed|7z|tar/.test(m)) return 'archive';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (/\.(py|m|ipynb|tex|c|cpp|js)$/.test(n) || m.startsWith('text/x-')) return 'code';
  return 'file';
}

export const KIND_LABEL = {
  folder: 'Folder', pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', archive: 'Archive',
  image: 'Image', audio: 'Audio', video: 'Video', code: 'Code', link: 'Link', file: 'File'
};

/* ---------- whole-archive index ---------- */
const INDEX_KEY = 'acce.index.v2';
let indexPromise = null;
let memoryIndex = null;

/**
 * Breadth-first crawl of every collection, one folder per request with a
 * few requests in flight. (Drive refuses "'a' in parents or 'b' in parents"
 * queries made with an API key, so folders cannot be batched.)
 */
const CRAWL_PARALLEL = 6;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function listForCrawl(id) {
  const out = [];
  let token = '';
  do {
    const url = `${API}?q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}&pageSize=1000`
      + `&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,properties)`
      + (token ? `&pageToken=${encodeURIComponent(token)}` : '') + `&key=${CONFIG.driveApiKey}`;
    let data;
    for (let attempt = 0; ; attempt++) {
      try { data = await driveGet(url); break; }
      catch (e) {
        // rate limits (403 rateLimitExceeded or 429): back off and retry a few times
        if (attempt >= 3 || !/too many/.test(e.message)) throw e;
        await pause(800 * 2 ** attempt);
      }
    }
    out.push(...(data.files || []));
    token = data.nextPageToken || '';
  } while (token);
  return out;
}

async function crawl(onProgress) {
  const folders = {};   // id -> {name, parent, root}
  const files = [];
  const queue = [];
  for (const [key, f] of Object.entries(CONFIG.folders)) {
    folders[f.id] = { name: f.name, parent: null, root: key };
    queue.push(f.id);
  }
  let active = 0;
  await new Promise((resolve, reject) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      while (active < CRAWL_PARALLEL && queue.length) {
        const parent = queue.shift();
        active++;
        listForCrawl(parent).then((children) => {
          for (const f of children) {
            if (f.mimeType === FOLDER) {
              if (!folders[f.id]) { folders[f.id] = { name: f.name, parent, root: folders[parent].root }; queue.push(f.id); }
            } else {
              files.push([f.id, f.name, f.mimeType, +(f.size || 0), f.modifiedTime || '', f.createdTime || '', parent, f.properties || null]);
            }
          }
          onProgress?.({ folders: Object.keys(folders).length, files: files.length });
          active--;
          pump();
        }, reject);
      }
    };
    pump();
  });
  return { t: Date.now(), folders, files };
}

function hydrate(raw) {
  const pathOf = (id) => {
    const names = [];
    for (let cur = id, guard = 0; cur && guard < 30; guard++) { const f = raw.folders[cur]; if (!f) break; names.unshift(f.name); cur = f.parent; }
    return names;
  };
  const trailOf = (id) => {
    const ids = [];
    for (let cur = id, guard = 0; cur && guard < 30; guard++) { ids.unshift(cur); cur = raw.folders[cur]?.parent; }
    return ids;
  };
  const files = raw.files.map(([id, name, mimeType, size, modifiedTime, createdTime, parent, properties]) => ({
    id, name, mimeType, size, modifiedTime, createdTime, parent, properties: properties || {},
    root: raw.folders[parent]?.root, path: pathOf(parent)
  }));
  const folderList = Object.entries(raw.folders).map(([id, f]) => ({ id, name: f.name, mimeType: FOLDER, parent: f.parent, root: f.root, path: pathOf(f.parent) }));
  return { t: raw.t, files, folders: folderList, folderMap: raw.folders, trailOf, pathOf };
}

export function cachedIndex() {
  if (memoryIndex) return memoryIndex;
  const raw = store.get(INDEX_KEY);
  if (raw && raw.files && Date.now() - raw.t < CONFIG.indexHours * 3600000) memoryIndex = hydrate(raw);
  return memoryIndex;
}

export function getIndex({ fresh = false, onProgress } = {}) {
  if (!fresh) { const c = cachedIndex(); if (c) return Promise.resolve(c); }
  if (indexPromise) return indexPromise;
  indexPromise = crawl(onProgress).then((raw) => {
    if (!store.set(INDEX_KEY, raw)) store.del(INDEX_KEY);   // too big for localStorage: keep it in memory only
    memoryIndex = hydrate(raw);
    return memoryIndex;
  }).finally(() => { indexPromise = null; });
  return indexPromise;
}

/** Breadcrumb trail [{id,name}] for a folder, from the index when possible, else by walking parents. */
export async function trailFor(folderId) {
  const idx = cachedIndex();
  if (idx?.folderMap[folderId]) return idx.trailOf(folderId).map((id) => ({ id, name: idx.folderMap[id].name }));
  const trail = [];
  let id = folderId;
  for (let guard = 0; id && guard < 25; guard++) {
    const m = await folderMeta(id);
    trail.unshift({ id: m.id, name: m.name });
    if (rootKeyOf(m.id)) return trail;
    id = (m.parents || [])[0];
  }
  return null;  // not inside any public collection
}

export function clearListingCache() {
  try { Object.keys(sessionStorage).filter((k) => k.startsWith('acce.dir.')).forEach((k) => sessionStorage.removeItem(k)); } catch {}
}
