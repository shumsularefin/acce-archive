/* ============================================================
   The catalogue (Firestore items/*): the archive's source of truth.
   One record per work, with metadata plus a storage pointer.

   Built for the Firestore free tier (50k reads/day). Visitors never
   read the records one by one: admins publish a *snapshot*, i.e. every
   published record packed into a few catalogue/{n} documents. A visit
   costs 1 read (config/catalog), plus the chunks only when the snapshot
   version changed, plus only the records edited since (every write sets
   updatedAt; removals are status:"withdrawn" tombstones). Typically 2
   reads per visit, whatever the size of the archive.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { store } from '../lib/dom.js';
import { fb, fs, docs } from './firebase.js';
import { getIndex } from './drive.js';
import { inferMeta } from '../lib/infer.js';

const KEY = 'acce.catalog.v1';
const SKEW = 120e3;
const CHUNK_CHARS = 700_000;                 // keep each snapshot document well under Firestore's 1 MiB                         // overlap for client/server clock differences
const TIME_FIELDS = ['approvedAt', 'updatedAt', 'withdrawnAt'];

let mem = null;                              // {items: Map<id, item>, live, snapVersion, cursor, snapshot}
let syncing = null;
let courseMap = null;

function plain(id, data) {
  const o = { id, ...data };
  for (const k of TIME_FIELDS) if (o[k]?.toMillis) o[k] = o[k].toMillis();
  return o;
}

function persist() {
  if (!store.set(KEY, { items: [...mem.items.values()], live: mem.live, snapVersion: mem.snapVersion, cursor: mem.cursor, snapshot: mem.snapshot, courses: mem.courses || [] })) store.del(KEY);
}

function restore() {
  if (mem) return;
  const c = store.get(KEY);
  if (c?.items) mem = { items: new Map(c.items.map((i) => [i.id, i])), live: !!c.live, snapVersion: c.snapVersion || 0, cursor: c.cursor || 0, snapshot: c.snapshot || null, courses: c.courses || [] };
}

/**
 * Bring the local copy up to date. Resolves to the Map of records, or null without Firebase.
 * full: read every record directly (staff tools only - costs one read per record).
 */
export function syncCatalog({ full = false } = {}) {
  if (!fb.ready) return Promise.resolve(null);
  syncing ||= (async () => {
    const F = fs();
    restore();
    // config/catalog: live = browse from the catalogue (switched on by the first import, so a lone
    // approved submission never hides uncatalogued Drive files); snapshot = the published pack.
    const cfg = (await F.getDoc(F.doc(fb.db, 'config', 'catalog')).catch(() => null))?.data?.() || {};
    const live = !!cfg.live;
    const snap = cfg.snapshot ? { version: cfg.snapshot.version, chunks: cfg.snapshot.chunks || 0, builtAt: cfg.snapshot.builtAt?.toMillis?.() || 0, count: cfg.snapshot.count || 0 } : null;

    if (full) {
      const all = await F.getDocs(F.collection(fb.db, 'items'));
      mem = { items: new Map(all.docs.map((d) => [d.id, plain(d.id, d.data())])), live, snapVersion: 0, cursor: 0, snapshot: snap, courses: mem?.courses || [] };
    } else if (!live) {
      mem = { ...(mem || { items: new Map(), snapVersion: 0, cursor: 0 }), live, snapshot: snap };
    } else if (snap?.version) {
      if (!mem || mem.snapVersion !== snap.version) {
        const docsIn = await Promise.all(Array.from({ length: snap.chunks }, (_, i) => F.getDoc(F.doc(fb.db, 'catalogue', String(i)))));
        const items = new Map();
        for (const d of docsIn) for (const it of d.data()?.items || []) items.set(it.id, it);
        mem = { items, live, snapVersion: snap.version, cursor: snap.builtAt, snapshot: snap, courses: docsIn[0]?.data()?.courses || [] };
        courseMap = null;
      }
      // records edited since the snapshot (or since this browser last looked)
      let since = Math.max((mem.cursor || snap.builtAt) - SKEW, 0);
      for (;;) {
        const q = await F.getDocs(F.query(F.collection(fb.db, 'items'), F.where('updatedAt', '>', F.Timestamp.fromMillis(since)), F.orderBy('updatedAt'), F.limit(500)));
        for (const d of q.docs) { const it = plain(d.id, d.data()); mem.items.set(d.id, it); mem.cursor = Math.max(mem.cursor || 0, it.updatedAt || 0); }
        if (q.size < 500) break;
        since = q.docs[q.size - 1].data().updatedAt.toMillis();
      }
      mem.live = live; mem.snapshot = snap;
    } else {
      // live but no snapshot published yet (only until an admin opens the Catalogue tab)
      const all = await F.getDocs(F.collection(fb.db, 'items'));
      mem = { items: new Map(all.docs.map((d) => [d.id, plain(d.id, d.data())])), live, snapVersion: 0, cursor: 0, snapshot: null };
    }
    persist();
    return mem.items;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Records changed since the published snapshot (staff: decides when to republish). */
export function changesSinceSnapshot() {
  restore();
  if (!mem) return 0;
  const built = mem.snapshot?.builtAt || 0;
  return [...mem.items.values()].filter((i) => (i.updatedAt || 0) > built).length;
}

export const snapshotInfo = () => mem?.snapshot || null;

/**
 * Pack every published record into catalogue/{0..n} and point config/catalog at it (admins).
 * Run after an import, and whenever many records changed since the last one.
 */
export async function publishSnapshot() {
  const F = fs();
  const items = await syncCatalog({ full: true });
  const list = [...items.values()].filter((i) => i.status === 'published').map(compact);
  const chunks = [];
  let cur = [], size = 0;
  for (const it of list) {
    const n = JSON.stringify(it).length;
    if (cur.length && size + n > CHUNK_CHARS) { chunks.push(cur); cur = []; size = 0; }
    cur.push(it); size += n;
  }
  if (cur.length || !chunks.length) chunks.push(cur);
  const version = Date.now();
  // course titles travel in the first chunk, so visitors never read the courses collection
  const courseList = docs(await F.getDocs(F.collection(fb.db, 'courses'))).map(({ id, title, level, program, active }) => ({ id, title: title || '', level: level || '', program: program || '', active: active !== false }));
  for (let i = 0; i < chunks.length; i++) await F.setDoc(F.doc(fb.db, 'catalogue', String(i)), i === 0 ? { version, items: chunks[i], courses: courseList } : { version, items: chunks[i] });
  const old = mem?.snapshot?.chunks || 0;
  await F.setDoc(F.doc(fb.db, 'config', 'catalog'), {
    snapshot: { version, chunks: chunks.length, count: list.length, builtAt: F.serverTimestamp() },
    updatedAt: F.serverTimestamp(), updatedBy: fb.user.email
  }, { merge: true });
  for (let i = chunks.length; i < old; i++) await F.deleteDoc(F.doc(fb.db, 'catalogue', String(i))).catch(() => {});
  await syncCatalog();
  return { records: list.length, chunks: chunks.length };
}

/** What visitors need from a record (drops staff bookkeeping to keep the snapshot small). */
function compact(it) {
  const { updatedBy, withdrawnReason, withdrawnAt, ...rest } = it;
  for (const k of Object.keys(rest)) if (rest[k] === '' || rest[k] === null || (Array.isArray(rest[k]) && !rest[k].length)) delete rest[k];
  return rest;
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

/** Changes whenever the local catalogue does (new snapshot or newer edits); also "last updated" time. */
export function catalogStamp() { return Math.max(mem?.cursor || 0, mem?.snapshot?.builtAt || 0); }

export function allRecords() { restore(); return mem ? [...mem.items.values()] : []; }

/** Published links filed under a Drive folder, from the local catalogue (no reads). */
export function linksIn(folderId) {
  restore();
  return mem?.live ? [...mem.items.values()].filter((i) => i.kind === 'link' && i.status === 'published' && i.folderId === folderId) : [];
}

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

/** Course titles: from the snapshot when there is one (no reads), else the courses collection. */
export async function courses() {
  if (courseMap) return courseMap;
  restore();
  if (mem?.courses?.length) return (courseMap = new Map(mem.courses.map((c) => [c.id, c])));
  if (!fb.ready || mem?.snapshot) return (courseMap = new Map());
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
  const snap = await publishSnapshot();
  return { files: idx.files.length, added, updated, missing, snapshot: snap };
}
