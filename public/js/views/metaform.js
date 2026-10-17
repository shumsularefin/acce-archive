/* ============================================================
   Catalogue metadata form, used by submissions, review and curation.
   Field set follows a Dublin Core-style record adapted to coursework:
   title, type, course, level, session, exam, people, curriculum,
   language, subject tags, description, rights.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h } from '../lib/dom.js';
import { courses as loadCourses } from '../services/firebase.js';

const COURSE_RE = /^([A-Z]{2,6})[\s-]?(\d{3,4}[A-Z]?)$/;
export const normCourse = (v) => { const m = COURSE_RE.exec((v || '').trim().toUpperCase()); return m ? `${m[1]}-${m[2]}` : null; };

let courseCache;
const getCourses = () => (courseCache ||= loadCourses());

function sessions() {
  const out = [];
  for (let y = CONFIG.sessionTo; y >= CONFIG.sessionFrom - 10; y--) out.push(`${y}-${String(y + 1).slice(2)}`);
  return out;
}

const opt = (dict, placeholder) => [h('option', { value: '', text: placeholder }), ...Object.entries(dict).map(([k, v]) => h('option', { value: k, text: v }))];
let uid = 0;

/**
 * @returns {{el: HTMLElement, read: () => object, set: (meta) => void}}
 * read() throws an Error with a readable message when something required is missing.
 */
export async function buildMetaForm({ initial = {}, hideTitle = false, lockCollection = false, staff = false, onCourse } = {}) {
  const id = `mf${++uid}`;
  const list = await getCourses().catch(() => []);
  const byCode = Object.fromEntries(list.map((c) => [c.id, c]));

  const f = {
    title: h('input', { class: 'input', id: `${id}-title`, maxlength: 160, placeholder: 'e.g. Chemical Engineering Thermodynamics - lecture 1-12' }),
    collection: h('select', { class: 'input', id: `${id}-col`, disabled: lockCollection }, opt(TAXONOMY.collections, 'Choose a collection')),
    type: h('select', { class: 'input', id: `${id}-type` }, opt(TAXONOMY.types, 'What kind of material?')),
    courseCode: h('input', { class: 'input mono', id: `${id}-code`, maxlength: 16, placeholder: 'ACCE-3101', list: `${id}-courses`, autocomplete: 'off' }),
    courseTitle: h('input', { class: 'input', id: `${id}-ctitle`, maxlength: 120, placeholder: 'Course title' }),
    level: h('select', { class: 'input', id: `${id}-level` }, h('option', { value: '', text: 'Year / term' }), TAXONOMY.levels.map((l) => h('option', { value: l, text: l.startsWith('MS') ? `MSc term ${l.slice(3)}` : `Year ${l[0]}, term ${l[2]}` }))),
    session: h('select', { class: 'input', id: `${id}-session` }, h('option', { value: '', text: 'Academic session' }), sessions().map((s) => h('option', { value: s, text: s.replace('-', '–') }))),
    examKind: h('select', { class: 'input', id: `${id}-ek` }, opt(TAXONOMY.examKinds, 'Exam')),
    examYear: h('input', { class: 'input', id: `${id}-ey`, type: 'number', min: 1980, max: 2100, placeholder: String(new Date().getFullYear()) }),
    instructors: h('input', { class: 'input', id: `${id}-inst`, maxlength: 200, placeholder: 'Course teacher(s) at the time' }),
    authors: h('input', { class: 'input', id: `${id}-auth`, maxlength: 200, placeholder: 'Author(s) or editor(s)' }),
    curriculum: h('input', { class: 'input', id: `${id}-cur`, maxlength: 120, placeholder: 'e.g. Syllabus 2019, Syllabus 2023', list: `${id}-curricula` }),
    language: h('select', { class: 'input', id: `${id}-lang` }, opt(TAXONOMY.languages, 'Language')),
    tags: h('input', { class: 'input', id: `${id}-tags`, maxlength: 400, placeholder: 'heat transfer, distillation, lab 3' }),
    description: h('textarea', { class: 'input', id: `${id}-desc`, rows: 3, maxlength: 2000, placeholder: 'What is inside? Chapters, which questions are solved, anything missing…' })
  };

  const rights = h('div', { class: 'radio-list', role: 'radiogroup' }, Object.entries(TAXONOMY.rights).map(([k, v]) =>
    h('label', { class: 'radio' }, h('input', { type: 'radio', name: `${id}-rights`, value: k }), h('span', { text: v }))));
  const credit = h('input', { type: 'checkbox', checked: true });

  const datalists = [
    h('datalist', { id: `${id}-courses` }, list.map((c) => h('option', { value: c.id, label: c.title || '' }))),
    h('datalist', { id: `${id}-curricula` }, [...new Set(list.flatMap((c) => c.curricula || []))].map((v) => h('option', { value: v })))
  ];

  const field = (label, input, extra = '') => h('div', { class: `field ${extra}`.trim() }, h('label', { for: input.id, text: label }), input);
  const examRow = h('div', { class: 'grid-2' }, field('Exam', f.examKind), field('Exam year', f.examYear));

  const el = h('div', { class: 'metaform' },
    datalists,
    hideTitle ? null : field('Title', f.title),
    h('div', { class: 'grid-2' }, field('Collection', f.collection), field('Material type', f.type)),
    h('div', { class: 'grid-2' }, field('Course code', f.courseCode), field('Course title', f.courseTitle)),
    h('div', { class: 'grid-2' }, field('Year / term', f.level), field('Session', f.session)),
    examRow,
    h('details', { class: 'more', open: staff },
      h('summary', { text: 'More details (optional)' }),
      h('div', { class: 'grid-2' }, field('Course teacher(s)', f.instructors), field('Author(s)', f.authors)),
      h('div', { class: 'grid-2' }, field('Curriculum version(s), comma separated', f.curriculum), field('Language', f.language)),
      field('Keywords (comma separated)', f.tags),
      field('Description', f.description)),
    staff ? null : h('fieldset', { class: 'field' }, h('legend', { class: 'label', text: 'Rights' }), rights),
    staff ? null : h('label', { class: 'check' }, credit, h('span', { text: 'Credit me by name when this is published' })));

  const syncExam = () => { examRow.hidden = !['question', 'solution'].includes(f.type.value); };
  f.type.addEventListener('change', syncExam);
  f.courseCode.addEventListener('change', () => {
    const code = normCourse(f.courseCode.value);
    if (code) f.courseCode.value = code;
    const c = code && byCode[code];
    if (c) {
      if (!f.courseTitle.value && c.title) f.courseTitle.value = c.title;
      if (!f.level.value && c.level) f.level.value = c.level;
    }
    onCourse?.(code, c || null);
  });

  function set(m = {}) {
    for (const k of ['title', 'collection', 'type', 'courseCode', 'courseTitle', 'level', 'session', 'examKind', 'instructors', 'authors', 'curriculum', 'language', 'description']) {
      if (m[k] !== undefined && m[k] !== null) f[k].value = m[k];
    }
    if (m.examYear) f.examYear.value = m.examYear;
    if (m.tags) f.tags.value = (Array.isArray(m.tags) ? m.tags : String(m.tags).split(',')).join(', ');
    if (m.rights) rights.querySelectorAll('input').forEach((r) => { r.checked = r.value === m.rights; });
    if (m.credit === false) credit.checked = false;
    syncExam();
  }
  set(initial);

  function read() {
    const v = (k) => f[k].value.trim();
    const meta = {
      title: v('title').replace(/\s+/g, ' '), collection: f.collection.value, type: f.type.value,
      courseCode: '', courseTitle: v('courseTitle'), level: f.level.value, session: f.session.value,
      examKind: examRow.hidden ? '' : f.examKind.value, examYear: examRow.hidden || !v('examYear') ? null : Number(v('examYear')),
      instructors: v('instructors'), authors: v('authors'), curriculum: v('curriculum'), language: f.language.value,
      tags: v('tags').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
      description: f.description.value.trim(),
      rights: staff ? (initial.rights || 'educational') : (rights.querySelector('input:checked')?.value || ''),
      credit: staff ? initial.credit !== false : credit.checked
    };
    if (v('courseCode')) {
      meta.courseCode = normCourse(v('courseCode'));
      if (!meta.courseCode) throw focusErr(f.courseCode, 'Course code should look like ACCE-3101.');
    }
    if (!hideTitle && meta.title.length < 3) throw focusErr(f.title, 'Give the material a descriptive title.');
    if (!meta.collection) throw focusErr(f.collection, 'Choose a collection.');
    if (!meta.type) throw focusErr(f.type, 'Choose the material type.');
    if (meta.examYear && (meta.examYear < 1980 || meta.examYear > 2100)) throw focusErr(f.examYear, 'Exam year looks wrong.');
    if (!meta.rights) throw new Error('Choose a rights statement.');
    return meta;
  }

  return { el, read, set, fields: f };
}

function focusErr(input, message) {
  input.focus();
  input.setAttribute('aria-invalid', 'true');
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'), { once: true });
  return new Error(message);
}
