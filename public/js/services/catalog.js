/* ============================================================
   The catalogue (Firestore items/*): the archive's source of truth.
   One record per work, with metadata plus a storage pointer.

   Browsers keep a copy in localStorage and fetch only records changed
   since their last sync (every write sets updatedAt; removals become
   status:"withdrawn" rather than deletes), with a full refresh daily.
   So a visit normally costs a handful of reads, not one per file.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { store } from '../lib/dom.js';
import { fb, fs, docs } from './firebase.js';
import { getIndex } from './drive.js';
import { inferMeta } from '../lib/infer.js';

const KEY = 'acce.catalog.v1';
const FULL_EVERY = 24 * 3600e3;
const SKEW = 120e3;                         // overlap for client/server clock differences
const TIME_FIELDS = ['approvedAt', 'updatedAt', 'withdrawnAt'];

let mem = null;                              // {items: Map<id, item>, syncedAt, fullAt, live}
let syncing = null;
let courseMap = null;

function plain(id, data) {
  const o = { id, ...data };
  for (const k of TIME_FIELDS) if (o[k]?.toMillis) o[k] = o[k].toMillis();
  return o;
}

function persist() {
  if (!store.set(KEY, { items: [...mem.items.values()], syncedAt: mem.syncedAt, fullAt: mem.fullAt, live: mem.live })) store.del(KEY);
}

function restore() {
  if (mem) return;
  const c = store.get(KEY);
  if (c?.items) mem = { items: new Map(c.items.map((i) => [i.id, i])), syncedAt: c.syncedAt || 0, fullAt: c.fullAt || 0, live: !!c.live };
}

/** Bring the local copy up to date. Resolves to the Map of all records (any status), or null without Firebase. */
export function syncCatalog({ full = false } = {}) {
  if (!fb.ready) return Promise.resolve(null);
  syncing ||= (async () => {
    const F = fs();
    restore();
    const started = Date.now();
    // config/catalog.live: staff switch the site to catalogue browsing after the first import,
    // so a lone approved submission never hides the not-yet-catalogued Drive files.
    const cfgSnap = await F.getDoc(F.doc(fb.db, 'config', 'catalog')).catch(() => null);
    const live = !!cfgSnap?.data?.()?.live;
    if (full || !mem || started - mem.fullAt > FULL_EVERY) {
      const snap = await F.getDocs(F.collection(fb.db, 'items'));
      mem = { items: new Map(snap.docs.map((d) => [d.id, plain(d.id, d.data())])), syncedAt: started, fullAt: started, live };
    } else {
      let since = F.Timestamp.fromMillis(Math.max(mem.syncedAt - SKEW, 0));
      for (;;) {
        const snap = await F.getDocs(F.query(F.collection(fb.db, 'items'), F.where('updatedAt', '>', since), F.orderBy('updatedAt'), F.limit(500)));
        snap.docs.forEach((d) => mem.items.set(d.id, plain(d.id, d.data())));
        if (snap.size < 500) break;
        since = snap.docs[snap.size - 1].data().updatedAt;
      }
      mem.syncedAt = started;
      mem.live = live;
    }
    persist();
    return mem.items;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Published records, synced. Empty when Firebase is unavailable or the catalogue is not switched on yet. */
export async function loadCatalog(opts) {
  try { await syncCatalog(opts); } catch (e) { console.warn('Catalogue sync failed', e); restore(); }
  return mem?.live ? [...mem.items.values()].filter((i) => i.status === 'published') : [];
}

export const catalogLive = () => !!mem?.live;

/** Switch browsing/search between the catalogue and the raw Drive folders (admins). */
export async function setCatalogLive(live, extra = {}) {
  const F = fs();
  await F.setDoc(F.doc(fb.db, 'config', 'catalog'), { live, ...extra, updatedAt: F.serverTimestamp(), updatedBy: fb.user.email }, { merge: true });
  restore();
  if (mem) { mem.live = live; persist(); }
}

export function catalogStamp() { return mem?.syncedAt || 0; }

export function allRecords() { restore(); return mem ? [...mem.items.values()] : []; }

/** The local record for an id, without a network call (null if not catalogued or not synced yet). */
export function recordFor(id) { restore(); return mem?.items.get(id) || null; }

export async function getItem(id) {
  restore();
  if (mem?.items.has(id)) return mem.items.get(id);
  if (!fb.ready) return null;
  const F = fs();
  try { const s = await F.getDoc(F.doc(fb.db, 'items', id)); return s.exists() ? plain(s.id, s.data()) : null; } catch { return null; }
}

/** Staff edit of a record (rules: admins only). */
export async function saveItem(id, patch) {
  const F = fs();
  await F.setDoc(F.doc(fb.db, 'items', id), { ...patch, updatedAt: F.serverTimestamp(), updatedBy: fb.user.email }, { merge: true });
  const s = await F.getDoc(F.doc(fb.db, 'items', id));
  restore();
  if (mem) { mem.items.set(id, plain(id, s.data())); persist(); }
}

export async function courses() {
  if (courseMap) return courseMap;
  if (!fb.ready) return (courseMap = new Map());
  try {
    const F = fs();
    courseMap = new Map(docs(await F.getDocs(F.collection(fb.db, 'courses'))).map((c) => [c.id, c]));
  } catch { courseMap = new Map(); }
  return courseMap;
}

/* ---------- virtual hierarchy ---------- */
export const dimsFor = (collection) => CONFIG.library[collection] || CONFIG.library.default;
export const NONE = '_';

export function dimValue(item, dim) {
  const v = item[dim];
  return v === undefined || v === null || v === '' ? NONE : String(v);
}

export function dimLabel(dim, value, cmap) {
  if (value === NONE) return { level: 'General', courseCode: 'Other material', type: 'Uncategorised', examYear: 'Year not recorded', examKind: 'Other', session: 'Any session' }[dim] || 'Other';
  if (dim === 'level') return value.startsWith('MS') ? `MSc term ${value.slice(3)}` : `Year ${value[0]} · Term ${value[2]}`;
  if (dim === 'courseCode') { const c = cmap?.get(value); return c?.title ? `${value} · ${c.title}` : value; }
  if (dim === 'type') return TAXONOMY.types[value] || value;
  if (dim === 'examKind') return TAXONOMY.examKinds[value] || value;
  if (dim === 'session') return value.replace('-', '–');
  return value;
}

export const DIM_NAME = { level: 'Year / term', courseCode: 'Course', type: 'Material', examYear: 'Exam year', examKind: 'Exam', session: 'Session' };

export function libraryHref(item) {
  return `#/library/${item.collection}/${dimsFor(item.collection).map((d) => encodeURIComponent(dimValue(item, d))).join('/')}`;
}

/** Catalogue record -> the entry shape the preview, search and lists use. */
export function toEntry(it, cmap) {
  const link = it.kind === 'link';
  const dims = dimsFor(it.collection);
  return {
    id: it.id, item: it, storage: it.storage,
    name: it.title, fileName: it.file?.name || '',
    mimeType: link ? 'link' : it.file?.mime || '', kind: link ? 'link' : undefined,
    size: it.file?.size || 0,
    createdTime: it.approvedAt ? new Date(it.approvedAt).toISOString() : '',
    modifiedTime: it.updatedAt ? new Date(it.updatedAt).toISOString() : '',
    root: it.collection,
    path: [CONFIG.folders[it.collection]?.name || it.collection,
      ...dims.map((d) => [d, dimValue(it, d)]).filter(([, v]) => v !== NONE).map(([d, v]) => dimLabel(d, v, cmap))],
    url: it.storage?.url
  };
}

/* ---------- import from Drive (admins) ---------- */
/**
 * Catalogue every file in the public Drive folders. New files get inferred metadata
 * (curated:false); known files only get their file facts refreshed, so staff edits are
 * never overwritten; files that disappeared from Drive are marked status:"missing".
 */
export async function importFromDrive(onProgress) {
  const F = fs();
  onProgress?.({ phase: 'crawl', files: 0 });
  const idx = await getIndex({ fresh: true, onProgress: (p) => onProgress?.({ phase: 'crawl', files: p.files }) });
  const existing = await syncCatalog({ full: true });
  const seen = new Set();
  const writes = [];
  let added = 0, updated = 0, missing = 0;

  for (const f of idx.files) {
    seen.add(f.id);
    const ex = existing.get(f.id);
    const file = { name: f.name, size: f.size, mime: f.mimeType, sha256: ex?.file?.sha256 || '' };
    const facts = { file, storage: { provider: 'drive', id: f.id }, folderId: f.parent, legacyPath: f.path.join(' / ') };
    if (!ex) {
      writes.push([f.id, { ...inferMeta(f), ...facts, kind: 'file', status: 'published', source: 'import', curated: false, contributor: '',
        approvedAt: f.createdTime ? F.Timestamp.fromDate(new Date(f.createdTime)) : F.serverTimestamp() }]);
      added++;
    } else {
      const changed = ex.file?.name !== file.name || ex.file?.size !== file.size || ex.legacyPath !== facts.legacyPath || ex.status === 'missing';
      if (changed) {
        writes.push([f.id, { ...facts, ...(ex.status === 'missing' ? { status: 'published' } : {}), ...(ex.curated ? {} : { title: inferMeta(f).title }) }]);
        updated++;
      }
    }
  }
  for (const ex of existing.values()) {
    if (ex.storage?.provider === 'drive' && ex.kind === 'file' && ex.status === 'published' && !seen.has(ex.id)) {
      writes.push([ex.id, { status: 'missing' }]);
      missing++;
    }
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = F.writeBatch(fb.db);
    for (const [id, data] of writes.slice(i, i + 400)) {
      batch.set(F.doc(fb.db, 'items', id), { ...data, updatedAt: F.serverTimestamp(), updatedBy: fb.user.email }, { merge: true });
    }
    await batch.commit();
    onProgress?.({ phase: 'write', done: Math.min(i + 400, writes.length), total: writes.length });
  }
  await setCatalogLive(true, { lastImport: { files: idx.files.length, added, updated, missing } });
  await syncCatalog({ full: true });
  return { files: idx.files.length, added, updated, missing };
}
