/* ============================================================
   Profile: update name / affiliation / student details.
   ============================================================ */
import { TAXONOMY } from '../taxonomy.js';
import { h, toast, fmtDate } from '../lib/dom.js';
import { fb } from '../services/firebase.js';
import { profileForm } from './gate.js';

export function render({ root }) {
  const p = fb.profile || {};
  root.append(h('section', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'Account' }), h('h1', { text: 'Your profile' })),
    h('div', { class: 'card glass' },
      h('dl', { class: 'meta-list' },
        h('dt', { text: 'Google account' }), h('dd', { text: fb.user.email }),
        h('dt', { text: 'Member since' }), h('dd', { text: fmtDate(p.createdAt) }),
        h('dt', { text: 'Visits' }), h('dd', { text: String(p.visits || 1) }),
        fb.role ? [h('dt', { text: 'Archive role' }), h('dd', { text: fb.role })] : null,
        h('dt', { text: 'Affiliation' }), h('dd', { text: TAXONOMY.affiliations[p.affiliation] || '-' })),
      h('hr'),
      profileForm({ submitLabel: 'Save changes', onSaved: () => toast('Profile saved', 'ok') }))));
}
