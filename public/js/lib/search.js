/* ============================================================
   Client-side search over the archive index.
   AND-matches every word against name, catalogue record and folder
   path, ranks name hits above path hits, and tolerates course codes
   written as "ACCE 3101", "acce-3101" or "acce3101".
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { kindOf } from '../services/drive.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const words = (s) => fold(s).replace(/[_\-.()[\],/]+/g, ' ');
const squash = (s) => fold(s).replace(/[^a-z0-9ঀ-৿]+/g, '');
const YEAR = /\b(19[89]\d|20\d\d)\b/;

export function yearOf(f) {
  const p = f.properties || {};
  if (p.acce_year) return p.acce_year;
  if (f.examYear) return String(f.examYear);
  const m = YEAR.exec(`${f.name} ${(f.path || []).slice(-2).join(' ')}`);
  return m ? m[1] : '';
}

export function typeOf(f) {
  return f.properties?.acce_type || f.type || '';
}

export function buildDocs(index, links = []) {
  const docs = index.files.map((f) => {
    const p = f.properties || {};
    const rec = [p.acce_title, p.acce_course, p.acce_tags, p.acce_session, p.acce_curriculum, TAXONOMY.types[p.acce_type], TAXONOMY.examKinds[p.acce_kind]].filter(Boolean).join(' ');
    return doc(f, f.name, rec, f.path.join(' '));
  });
  for (const l of links) {
    const f = { ...l, kind: 'link', name: l.title, mimeType: 'link', root: l.collection, path: (l.folderPath || '').split(' / ').filter(Boolean), createdTime: l.approvedAt?.toDate?.().toISOString() || '' };
    docs.push(doc(f, l.title, [l.courseCode, l.courseTitle, (l.tags || []).join(' '), l.instructors, l.authors, l.description, TAXONOMY.types[l.type]].join(' '), f.path.join(' ')));
  }
  return docs;
}

/** Search documents from catalogue entries (services/catalog.js toEntry). */
export function buildCatalogDocs(entries) {
  return entries.map((e) => {
    const it = e.item;
    const rec = [it.courseCode, it.courseTitle, (it.tags || []).join(' '), it.session, (it.curricula || []).join(' '), it.instructors, it.authors,
      it.description, TAXONOMY.types[it.type], TAXONOMY.examKinds[it.examKind], e.fileName].filter(Boolean).join(' ');
    const d = doc(e, it.title, rec, e.path.join(' '));
    d.year = it.examYear ? String(it.examYear) : yearOf({ name: e.fileName, path: e.path });
    d.type = it.type || '';
    return d;
  });
}

function doc(f, name, rec, path) {
  return {
    f, kind: kindOf(f), year: yearOf(f), type: typeOf(f),
    name: words(name), rec: words(rec), path: words(path),
    sq: squash(`${name} ${rec} ${path}`)
  };
}

export function tokenize(q) {
  return words(q).split(/\s+/).filter((t) => t.length > 0).slice(0, 8);
}

export function score(d, tokens) {
  let s = 0;
  for (const t of tokens) {
    if (d.name.includes(t)) s += (d.name.startsWith(t) || d.name.includes(' ' + t)) ? 5 : 3;
    else if (d.rec.includes(t)) s += 2.5;
    else if (d.path.includes(t)) s += 1;
    else if (t.length > 2 && d.sq.includes(squash(t))) s += 1.5;
    else return 0;
  }
  return s;
}

/**
 * @param docs   from buildDocs
 * @param q      free text
 * @param filters {root, kind, type, year}
 * @param sort   'rel' | 'new' | 'name'
 */
export function search(docs, q, filters = {}, sort = 'rel') {
  const tokens = tokenize(q);
  const out = [];
  for (const d of docs) {
    if (filters.root && d.f.root !== filters.root) continue;
    if (filters.kind && d.kind !== filters.kind) continue;
    if (filters.type && d.type !== filters.type) continue;
    if (filters.year && d.year !== filters.year) continue;
    const s = tokens.length ? score(d, tokens) : 1;
    if (s > 0) out.push({ d, s });
  }
  const newest = (a, b) => (b.d.f.createdTime || b.d.f.modifiedTime || '').localeCompare(a.d.f.createdTime || a.d.f.modifiedTime || '');
  if (sort === 'name') out.sort((a, b) => a.d.name.localeCompare(b.d.name));
  else if (sort === 'new' || !tokens.length) out.sort(newest);
  else out.sort((a, b) => b.s - a.s || newest(a, b));
  return { tokens, results: out.map((x) => x.d) };
}

export function facets(results) {
  const count = (k) => results.reduce((m, d) => (d[k] ? (m[d[k]] = (m[d[k]] || 0) + 1, m) : m), {});
  const roots = results.reduce((m, d) => (m[d.f.root] = (m[d.f.root] || 0) + 1, m), {});
  return { root: roots, kind: count('kind'), type: count('type'), year: count('year') };
}

/** Split text into [{text, hit}] for highlighting. */
export function highlight(text, tokens) {
  if (!tokens.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();          // same length as text, so marks line up
  const marks = new Array(text.length).fill(false);
  for (const t of tokens) {
    let i = lower.indexOf(t);
    while (i >= 0 && t) { for (let j = i; j < i + t.length; j++) marks[j] = true; i = lower.indexOf(t, i + t.length); }
  }
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}
