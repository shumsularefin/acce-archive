/* ============================================================
   Best-guess catalogue metadata for files imported from Drive.
   Uses the Drive "acce_*" properties when present (set by earlier
   approvals), otherwise the file name and the folder path. Results
   are marked curated:false so staff can review them later.
   Pure functions - unit tested in tests/unit/infer.test.mjs.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';

const YEAR = /\b(19[89]\d|20\d\d)\b/;
const ORD = '(?:st|nd|rd|th)?';

export function cleanTitle(name) {
  return String(name || '').replace(/\.[^.]{1,6}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

export function inferCourse(text) {
  const prefixes = CONFIG.coursePrefixes.join('|');
  const m = new RegExp(`(?:^|[^A-Za-z])(${prefixes})[\\s_-]?(\\d{3,4}[A-Za-z]?)(?![\\d])`, 'i').exec(text);
  if (!m) return '';
  const digits = m[2].toUpperCase();
  if (/^(19[89]\d|20[0-4]\d)$/.test(digits)) return '';   // "CHE 2023" is a year, not a course
  return `${m[1].toUpperCase()}-${digits}`;
}

export function inferLevel(folders, collection) {
  for (const f of [...folders].reverse()) {
    const s = f.toLowerCase();
    let m = new RegExp(`\\b([1-4])${ORD}\\s*year[\\s,/-]*([12])${ORD}\\s*(?:term|semester|sem)\\b`).exec(s)
      || /\byear\s*([1-4])\s*[,/-]?\s*(?:term|semester|sem)\s*([12])\b/.exec(s)
      || /\b(?:l|level)\s*([1-4])\s*[,/-]?\s*(?:t|term)\s*([12])\b/.exec(s)
      || /^\s*([1-4])\s*[-/.]\s*([12])\s*$/.exec(s);
    if (m) return `${m[1]}-${m[2]}`;
    if (collection === 'msc') {
      m = /\b(?:term|semester|sem)\s*([1-3])\b/.exec(s);
      if (m) return `MS-${m[1]}`;
    }
  }
  return '';
}

export function inferExamKind(text) {
  const s = text.toLowerCase();
  if (/\bviva\b/.test(s)) return 'viva';
  if (/\b(in[\s-]?course|incourse|mid[\s-]?term|midterm)\b/.test(s)) return 'incourse';
  if (/\b(class[\s-]?test|quiz|ct\s*\d?)\b/.test(s)) return 'quiz';
  if (/\blab(oratory)?\s*(exam|final|test)\b/.test(s)) return 'lab';
  if (/\bassignment\b/.test(s)) return 'assignment';
  if (/\b(final|term[\s-]?final|semester[\s-]?final)\b/.test(s)) return 'final';
  return '';
}

export function inferType({ name, mimeType }, folders, collection) {
  const n = name.toLowerCase(), p = folders.join(' / ').toLowerCase(), all = `${p} / ${n}`;
  if (/\b(solution|solved|answer)s?\b/.test(n)) return 'solution';
  if (collection === 'qbank' || /\b(question|questions|ques|qbank|past paper)\b/.test(all)) return 'question';
  if (/\b(syllabus|curriculum|course outline)\b/.test(all)) return 'syllabus';
  if (/\b(thesis|dissertation|project report|internship report)\b/.test(all)) return 'thesis';
  if (/\b(lab|laboratory|experiment|practical)\b/.test(all)) return 'lab';
  if (/\b(notice|form|routine|calendar|circular|application)\b/.test(all)) return 'notice';
  if (/\b(journal|article|paper|review)\b/.test(n)) return 'paper';
  if (/presentation|powerpoint/.test(mimeType || '') || /\b(lecture|note|notes|slide|slides|handout|chapter|class)\b/.test(all)) return 'lecture';
  if (/\b(book|books|edition|handbook|textbook|reference)\b/.test(all) || /\b(ed|edn)\.?\s*\d/.test(n)) return 'book';
  if (/^(audio|video)\//.test(mimeType || '')) return 'media';
  if (/\b(software|setup|installer)\b/.test(all) || /\.(exe|msi|dmg|apk)$/.test(n)) return 'software';
  if (/\b(data|dataset)\b/.test(all) || /\.(csv|xlsx?)$/.test(n)) return 'dataset';
  return 'other';
}

/**
 * @param f  index entry: {name, mimeType, path: [root, ...folders], root, properties, createdTime}
 * @returns catalogue fields (without storage/status bookkeeping)
 */
export function inferMeta(f) {
  const p = f.properties || {};
  const folders = (f.path || []).slice(1);         // drop the collection root name
  const text = `${folders.join(' / ')} / ${f.name}`;
  const collection = f.root;
  const syl = /(syllabus|curriculum)\s*[-:]?\s*((?:19|20)\d\d)/i.exec(text);
  const curricula = (p.acce_curriculum || (syl ? `Syllabus ${syl[2]}` : '')).split(',').map((x) => x.trim()).filter(Boolean);
  const type = TAXONOMY.types[p.acce_type] ? p.acce_type : inferType(f, folders, collection);
  const examish = type === 'question' || type === 'solution';
  const yearM = YEAR.exec(`${f.name} ${folders.slice(-2).join(' ')}`);
  const sess = /\b((?:19|20)\d\d)\s*[-–]\s*(\d\d)\b/.exec(text);
  return {
    title: p.acce_title || cleanTitle(f.name),
    collection,
    type,
    courseCode: p.acce_course || inferCourse(text),
    courseTitle: '',
    level: TAXONOMY.levels.includes(p.acce_level) ? p.acce_level : inferLevel(folders, collection),
    session: p.acce_session || (sess ? `${sess[1]}-${sess[2]}` : ''),
    examKind: TAXONOMY.examKinds[p.acce_kind] ? p.acce_kind : (examish ? inferExamKind(text) : ''),
    examYear: p.acce_year ? Number(p.acce_year) : (examish && yearM ? Number(yearM[1]) : null),
    instructors: '', authors: '',
    curriculum: curricula.join(', '),
    curricula,
    language: TAXONOMY.languages[p.acce_lang] ? p.acce_lang : '',
    description: '',
    tags: p.acce_tags ? p.acce_tags.split(',').filter(Boolean) : [],
    rights: 'educational',
    credit: false
  };
}
