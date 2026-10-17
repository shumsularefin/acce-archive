/* ============================================================
   Sign-in screen and first-time profile.
   ============================================================ */
import { CONFIG } from '../config.js';
import { TAXONOMY } from '../taxonomy.js';
import { h, icon, toast, fill } from '../lib/dom.js';
import { fb, signIn, signOut, saveProfile } from '../services/firebase.js';

const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

export async function startSignIn(errorEl) {
  try {
    await signIn();
  } catch (e) {
    if (errorEl) { errorEl.textContent = e.message; errorEl.hidden = false; }
    else toast(e.message, 'error', 7000);
  }
}

export function renderGate(root, step) {
  fill(root, step === 'profile' ? profileCard() : signInCard());
  root.querySelector('input,button')?.focus();
}

function signInCard() {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: !fb.error, text: fb.error || '' });
  const btn = h('button', { class: 'btn btn-google', type: 'button' });
  btn.innerHTML = GOOGLE_G;                       // static, trusted markup
  btn.append(h('span', { text: 'Continue with Google' }));
  btn.onclick = async () => { btn.disabled = true; err.hidden = true; await startSignIn(err); btn.disabled = false; };
  return h('div', { class: 'gate-card glass rise' },
    h('div', { class: 'watermark', 'aria-hidden': 'true' }),
    h('div', { class: 'gate-brand' },
      h('img', { src: 'assets/acce-logo.png', alt: '', width: 56, height: 56 }),
      h('div', {}, h('span', { class: 'eyebrow', text: 'GSTU · ACCE' }), h('h1', { text: 'The ACCE Archive' }))),
    h('p', { class: 'gate-sub', text: 'Books, lecture material, question banks and research from the department, kept in one place and growing with every batch.' }),
    h('ul', { class: 'gate-points' },
      h('li', {}, icon('search'), 'Search every collection at once'),
      h('li', {}, icon('upload'), 'Contribute material for review'),
      h('li', {}, icon('shield'), 'Every upload is checked before it goes public')),
    err, btn,
    h('p', { class: 'fine', text: 'We use your Google name and email only to sign you in and to credit your contributions. Nothing is posted to your account.' }));
}

/** Shared by the gate and the profile page. */
export function profileForm({ onSaved, submitLabel = 'Continue', initial = fb.profile } = {}) {
  const p = initial || {};
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', id: 'p-name', autocomplete: 'name', required: true, maxlength: 80, value: p.displayName || fb.user?.displayName || '' });
  const sessionSel = h('select', { class: 'input', id: 'p-session' },
    h('option', { value: '', text: 'Select your session', disabled: true, selected: true }),
    Array.from({ length: CONFIG.sessionTo - CONFIG.sessionFrom + 1 }, (_, i) => {
      const y = CONFIG.sessionTo - i;
      return h('option', { value: String(y), text: `${y}–${String(y + 1).slice(2)}` });
    }));
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

function profileCard() {
  return h('div', { class: 'gate-card glass rise' },
    h('div', { class: 'watermark', 'aria-hidden': 'true' }),
    h('span', { class: 'eyebrow', text: 'One last step' }),
    h('h1', { text: `Welcome, ${(fb.user?.displayName || '').split(' ')[0] || 'there'}` }),
    h('p', { class: 'gate-sub', text: 'Tell us who you are. This is asked once, and lets reviewers credit your contributions properly.' }),
    profileForm({ submitLabel: 'Enter the archive' }),
    h('button', { class: 'link-btn', type: 'button', text: `Not ${fb.user?.email}? Use another account`, onclick: () => signOut() }));
}
