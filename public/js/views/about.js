/* ============================================================
   About the archive: scope, organisation, review, rights, privacy.
   Mirrors docs/COLLECTION_POLICY.md - keep both in step.
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { h, icon } from '../lib/dom.js';

const section = (id, ic, title, ...body) => h('section', { class: 'card glass prose', id }, h('h2', {}, icon(ic), title), ...body);
const ul = (...items) => h('ul', {}, items.map((t) => h('li', { text: t })));

export function render({ root }) {
  root.append(h('section', { class: 'page narrow about' },
    h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'About' }), h('h1', { text: 'How the archive works' }),
      h('p', { class: 'muted', text: 'The ACCE Archive preserves the teaching and learning material of the Department of Applied Chemistry and Chemical Engineering, GSTU, so every batch can build on the last.' })),

    h('nav', { class: 'toc chip-row' }, [['scope', 'What we keep'], ['organisation', 'Organisation'], ['review', 'Review'], ['rights', 'Rights'], ['takedown', 'Take-down'], ['privacy', 'Privacy'], ['preservation', 'Preservation']]
      .map(([id, t]) => h('a', { class: 'chip chip-link', href: `#/about#${id}`, text: t }))),

    section('scope', 'layers', 'What the archive keeps',
      h('p', { text: 'Anything that helps someone study, teach or research in the department:' }),
      h('div', { class: 'type-grid' }, Object.values(TAXONOMY.types).filter((t) => t !== 'Other').map((t) => h('span', { class: 'chip static', text: t }))),
      h('p', { text: 'Material stays even when courses, teachers or curricula change. Older versions are kept and labelled with the curriculum and session they belong to, because past papers and old syllabi stay useful for years.' })),

    section('organisation', 'folder', 'How it is organised',
      h('p', { text: 'Four collections - BSc, MSc, Question banks and Miscellaneous - hold folders arranged by year/term and course. Folder structure is kept shallow and stable; everything that changes over time is recorded as metadata instead:' }),
      ul('Course code and title - the stable anchor for filing (e.g. ACCE-3101).',
        'Curriculum or syllabus version - so revised curricula sit side by side with older ones.',
        'Academic session and exam year - so a question bank reads as a timeline.',
        'Course teacher(s) at the time - recorded per item, never used as a folder name, because faculty change.',
        'Material type, language, keywords and a short description.'),
      h('p', { text: 'Each record is written into the file itself in Google Drive, so the archive remains self-describing even outside this website.' })),

    section('review', 'shield', 'Contribution & review',
      h('ol', { class: 'steps' },
        h('li', {}, h('b', { text: 'Submit' }), h('span', { text: 'Signed-in members upload files (or share links) with a short description. Files go to a private review folder - nothing is public yet.' })),
        h('li', {}, h('b', { text: 'Check' }), h('span', { text: 'A reviewer previews it, confirms it is genuine, relevant and shareable, corrects the details, and picks the folder. Exact duplicates are refused automatically by checksum.' })),
        h('li', {}, h('b', { text: 'Publish or decline' }), h('span', { text: 'Approved items are moved into the public collection and renamed consistently. Declined items are deleted and the contributor is told why.' }))),
      h('p', { class: 'muted small', text: 'Every decision is recorded with the reviewer and time, so the archive keeps a full provenance trail.' })),

    section('rights', 'book', 'Rights & fair use',
      h('p', { text: 'Contributors declare one of these when they submit:' }),
      ul(...Object.values(TAXONOMY.rights)),
      h('p', { text: 'Material is shared for non-commercial educational use within the academic community. Authors keep their copyright. Commercial e-books are only accepted when the rights holder allows sharing.' })),

    section('takedown', 'flag', 'Report a problem or request take-down',
      h('p', { text: 'Use “Report” on any file to flag broken files, wrong details, duplicates, copyright or privacy concerns. Rights holders and anyone named in a document can ask for removal the same way.' }),
      h('p', { text: 'Reported material that raises a copyright or privacy concern is withdrawn from public view while it is checked. Withdrawn files are kept privately, not deleted, unless deletion is requested.' })),

    section('privacy', 'lock', 'Privacy',
      ul('Sign-in uses Google. We store your name, email, affiliation and (for students) session and ID to credit contributions and keep the archive for members.',
        'Your email is visible only to archive staff. Public records show your name only if you choose to be credited.',
        'Never upload marks, attendance, phone numbers, ID cards or other personal data. Such files are declined or withdrawn.')),

    section('preservation', 'database', 'Preservation & storage',
      ul('Files live in Google Drive; their catalogue records live both in Drive and in the archive database.',
        'Each file’s SHA-256 checksum is recorded on arrival, which detects duplicates and lets the archive verify files later.',
        'Uploads pause automatically before the storage quota is exhausted. Large scans are compressed, and videos are linked rather than stored.',
        'The design allows the archive to move to a larger institutional Drive or additional accounts without changing links or records.'))));
}
