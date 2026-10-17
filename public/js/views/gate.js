/* ============================================================
   Entry screen: student details by default (as on the original site),
   with Google sign-in for contributors and staff. Also the profile
   form used by the upload and profile pages.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, fill } from '../lib/dom.js';
import { fb, saveProfile } from '../services/firebase.js';
import { student, validateStudent, logVisit } from '../services/student.js';
import { googleButton } from './signin.js';

export function renderGate(root) {
  fill(root, studentCard());
  root.querySelector('input')?.focus();
}

const sessionOptions = () => Array.from({ length: CONFIG.sessionTo - CONFIG.sessionFrom + 1 }, (_, i) => {
  const y = CONFIG.sessionTo - i;
  return h('option', { value: String(y), text: `${y}\u2013${String(y + 1).slice(2)}` });
});

/** The default way in: name + session + student ID, exactly as on the original site. */
function studentCard() {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', id: 'f-name', name: 'name', autocomplete: 'name', placeholder: 'e.g. Shumsul Arefin', maxlength: 80, required: true });
  const session = h('select', { class: 'input', id: 'f-session', name: 'session', required: true },
    h('option', { value: '', text: 'Select your session', disabled: true, selected: true }), sessionOptions());
  const sid = h('input', { class: 'input mono', id: 'f-id', name: 'sid', maxlength: 8, spellcheck: false, autocapitalize: 'characters', inputmode: 'text', placeholder: 'e.g. 20ACE001', required: true });
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const id = sid.value.trim().toUpperCase();
    const problem = validateStudent(name.value, session.value, id);
    sid.setAttribute('aria-invalid', problem ? 'true' : 'false');
    if (problem) { err.textContent = problem; err.hidden = false; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return; }
    const s = student.save(name.value, session.value, id);
    logVisit(s);
    window.dispatchEvent(new Event('acce:student'));
  } },
  h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Full name' }), name),
  h('div', { class: 'student-fields' },
    h('div', { class: 'field' }, h('label', { for: 'f-session', text: 'Session' }), session),
    h('div', { class: 'field' }, h('label', { for: 'f-id', text: 'Student ID' }), sid)),
  err,
  h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Enter the archive', icon('chevron')));

  const gErr = h('p', { class: 'form-error', role: 'alert', hidden: true });

  return h('div', { class: 'gate-split rise' },
    h('div', { class: 'gate-panel' },
      h('span', { class: 'crest' }, h('img', { src: 'assets/acce-crest-192.png', alt: 'ACCE, GSTU crest', width: 104, height: 104 })),
      h('div', {},
        h('h1', {}, 'ACCE Archive', h('span', { text: 'Applied Chemistry & Chemical Engineering \u00b7 GSTU' })),
      ),
      h('p', { text: 'Books, lecture notes, past questions, lab manuals and theses from every batch, free for students of the department.' }),
      h('ul', { class: 'gate-points' },
        h('li', {}, icon('layers'), 'Every course and every batch in one place'),
        h('li', {}, icon('search'), 'Search all collections in seconds'),
        h('li', {}, icon('download'), 'Preview and download straight from Google Drive'),
        h('li', {}, icon('upload'), 'Share your own notes, reviewed before publishing'))),
    h('div', { class: 'gate-form' },
      h('span', { class: 'eyebrow', text: 'Student access' }),
      h('h2', { text: 'Welcome to the archive' }),
      h('p', { class: 'gate-sub', text: 'Enter your details once on this device. No account or password needed.' }),
      form,
      h('div', { class: 'gate-alt' },
        h('span', { class: 'gate-or', text: /^#\/(admin|signin)/.test(location.hash)
          ? 'Owner, editors and reviewers: sign in with Google to open the dashboard.'
          : 'Faculty, editors, or uploading material?' }),
        gErr, googleButton({ errorEl: gErr }))));
}

/** Shared by the gate and the profile page. */
export function profileForm({ onSaved, submitLabel = 'Continue', initial = fb.profile } = {}) {
  const st = student.get();
  const p = initial || (st ? { displayName: st.name, affiliation: 'student', session: st.session, studentId: st.sid } : {});
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', id: 'p-name', autocomplete: 'name', required: true, maxlength: 80, value: p.displayName || fb.user?.displayName || '' });
  const sessionSel = h('select', { class: 'input', id: 'p-session' },
    h('option', { value: '', text: 'Select your session', disabled: true, selected: true }),
    sessionOptions());
  if (p.session) sessionSel.value = p.session;
  const sid = h('input', { class: 'input mono', id: 'p-sid', maxlength: 8, spellcheck: false, autocapitalize: 'characters', placeholder: 'e.g. 20ACE001', value: p.studentId || '' });
  const studentFields = h('div', { class: 'student-fields' },
    h('div', { class: 'field' }, h('label', { for: 'p-session', text: 'Session' }), sessionSel),
    h('div', { class: 'field' }, h('label', { for: 'p-sid', text: 'Student ID' }), sid));

  let affiliation = p.affiliation || 'student';
  const chips = h('div', { class: 'chip-row', role: 'radiogroup', 'aria-label': 'Affiliation' },
    Object.entries(TAXONOMY.affiliations).map(([k, label]) => h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(k === affiliation), dataset: { k }, text: label,
      onclick: (e) => {
        affiliation = k;
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.k === k)));
        studentFields.hidden = !['student', 'alumni'].includes(k);
      }
    })));
  studentFields.hidden = !['student', 'alumni'].includes(affiliation);

  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: submitLabel });
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'p-name', text: 'Full name' }), name),
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'You are a' }), chips),
    studentFields, err, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const data = { displayName: name.value.trim().replace(/\s+/g, ' '), affiliation, session: '', studentId: '' };
    const problem = validate(data, sessionSel.value, sid.value.trim().toUpperCase());
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    submit.disabled = true;
    try {
      await saveProfile(data);
      onSaved?.();
    } catch (x) {
      err.textContent = 'Could not save your profile: ' + (x.code === 'permission-denied' ? 'details were rejected, check the student ID.' : x.message);
      err.hidden = false;
    } finally { submit.disabled = false; }
  });
  return form;
}

function validate(data, session, studentId) {
  if (data.displayName.length < 3) return 'That name is too short to be a full name.';
  if (data.affiliation === 'student' || (data.affiliation === 'alumni' && (session || studentId))) {
    if (!session) return 'No session selected.';
    const m = CONFIG.idPattern.exec(studentId);
    if (!m) return 'That student ID is not in the departmental format.';
    if (m[1] !== String(session).slice(2)) return 'That student ID does not belong to the selected session.';
    if (m[2] === '00') return 'That serial number is not valid.';
    data.session = session;
    data.studentId = studentId;
  }
  return null;
}
