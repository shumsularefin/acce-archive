/* ============================================================
   Google sign-in for contributors and staff: the #/signin page, the
   panel shown in place of protected pages, and the shared button.
   Students never need this; they enter with their ID.
   ============================================================ */
import { CONFIG } from '../config.js';
import { h, icon, initials } from '../lib/dom.js';
import { fb, initFirebase, signIn, signOut, isStaff } from '../services/firebase.js';

const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

const safePath = (p) => (p && /^\/[\w/-]*$/.test(p) && !p.startsWith('/signin') ? p : null);

/**
 * Start Google sign-in. `next` is where to land once it completes; it is kept in
 * sessionStorage so it survives the full-page redirect used when popups are blocked.
 * Resolves true when the popup signed someone in.
 */
export async function startSignIn(next, errorEl) {
  const show = (msg) => { if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; } };
  if (errorEl) errorEl.hidden = true;
  if (!(await initFirebase())) {
    show(`Google sign-in is unavailable right now${fb.error ? ` (${fb.error})` : ''}. Students can still enter with their ID.`);
    return false;
  }
  try { next ? sessionStorage.setItem('acce.next', next) : sessionStorage.removeItem('acce.next'); } catch {}
  try {
    const result = await signIn();
    if (result === false) { try { sessionStorage.removeItem('acce.next'); } catch {} }   // popup closed: stay put
    return result === true;
  } catch (e) {
    try { sessionStorage.removeItem('acce.next'); } catch {}
    show(e.message);
    return false;
  }
}

/** "Continue with Google" button with its own busy state and error line. */
export function googleButton({ next, label = 'Continue with Google', errorEl } = {}) {
  const btn = h('button', { class: 'btn btn-google', type: 'button' });
  btn.innerHTML = GOOGLE_G;                       // static, trusted markup
  const text = h('span', { text: label });
  btn.append(text);
  btn.onclick = async () => {
    btn.disabled = true;
    text.textContent = 'Opening Google…';
    await startSignIn(next, errorEl);
    btn.disabled = false;
    text.textContent = label;
  };
  return btn;
}

const errorLine = () => h('p', { class: 'form-error', role: 'alert', hidden: !fb.error, text: fb.error || '' });

/** Shown in place of a page that needs an account (contributor), the dashboard (staff), or a signed-in non-member (not-staff). */
export function signInPanel({ kind = 'contributor', next } = {}) {
  const err = errorLine();
  if (kind === 'not-staff') {
    return h('div', { class: 'card glass guard' },
      h('div', { class: 'empty-ic' }, icon('lock')),
      h('h2', { text: 'No dashboard access yet' }),
      h('p', { class: 'muted' }, h('b', { text: fb.user?.email || 'This account' }), ' is not on the archive team. Ask the owner to add this address in Dashboard → People, then come back here.'),
      h('p', { class: 'fine', text: `Owner: ${CONFIG.rootOwners[0]}` }),
      err,
      h('div', { class: 'row-center' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { await signOut(); startSignIn(next, err); } }, icon('refresh'), 'Use another account'),
        h('a', { class: 'btn btn-ghost', href: '#/', text: 'Back to the archive' })));
  }
  const staff = kind === 'staff';
  return h('div', { class: 'card glass guard' },
    h('div', { class: 'empty-ic' }, icon(staff ? 'shield' : 'upload')),
    h('h2', { text: staff ? 'Staff & editor sign-in' : 'Sign in to upload' }),
    h('p', { class: 'muted', text: staff
      ? 'The dashboard is for the archive owner, editors and reviewers. Sign in with the Google account the owner added to the team.'
      : 'Uploading and tracking your submissions needs a Google account, so reviewers know who sent what. Your email is only visible to the archive team.' }),
    err,
    googleButton({ next, errorEl: err, label: staff ? 'Sign in with Google' : 'Continue with Google' }),
    h('p', { class: 'fine', text: staff ? 'Not on the team yet? Ask the owner to add your Gmail address.' : 'Just browsing or downloading? No account is needed.' }));
}

export function render({ root, query, navigate }) {
  const next = safePath(query.get('next'));

  if (fb.user) {
    if (next && (next !== '/admin' || isStaff())) { navigate('#' + next); return; }
    if (next === '/admin') { root.append(h('section', { class: 'page narrow center-page' }, signInPanel({ kind: 'not-staff', next }))); return; }
    const name = fb.profile?.displayName || fb.user.displayName || fb.user.email;
    root.append(h('section', { class: 'page narrow' },
      h('div', { class: 'page-head' }, h('span', { class: 'eyebrow', text: 'Account' }), h('h1', { text: 'You are signed in' })),
      h('div', { class: 'card glass signin-card' },
        h('div', { class: 'signin-who' },
          fb.user.photoURL ? h('img', { src: fb.user.photoURL, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar-txt', text: initials(name) }),
          h('div', {}, h('strong', { text: name }), h('span', { text: fb.user.email })),
          fb.role ? h('span', { class: 'pill pill-ok', style: { marginLeft: 'auto' } }, icon('shield'), fb.role) : null),
        h('div', { class: 'row-between' },
          h('div', { class: 'chip-row' },
            isStaff() ? h('a', { class: 'btn btn-primary', href: '#/admin' }, icon('shield'), 'Open the dashboard') : null,
            h('a', { class: isStaff() ? 'btn' : 'btn btn-primary', href: '#/submit' }, icon('upload'), 'Upload material'),
            h('a', { class: 'btn', href: '#/my' }, icon('inbox'), 'My uploads')),
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => signOut() }, icon('logout'), 'Sign out')))));
    return;
  }

  const errA = errorLine(), errB = h('p', { class: 'form-error', role: 'alert', hidden: true });
  root.append(h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('span', { class: 'eyebrow', text: 'Sign in' }),
      h('h1', { text: 'Sign in with your Google account' }),
      h('p', { class: 'muted', text: 'Students do not need an account to browse or download - only to upload, or to work on the archive.' })),
    h('div', { class: 'signin' },
      h('div', { class: 'card glass signin-card' },
        h('span', { class: 'pill pill-info', style: { alignSelf: 'flex-start' } }, icon('upload'), 'Students & contributors'),
        h('h2', { text: 'Share notes, slides and papers' }),
        h('ul', { class: 'signin-perks' },
          h('li', {}, icon('check'), 'Upload files or share links in a minute'),
          h('li', {}, icon('check'), 'Follow each submission from review to published'),
          h('li', {}, icon('check'), 'Get credited by name when it goes live')),
        errA,
        googleButton({ next: next || '/submit', errorEl: errA })),
      h('div', { class: 'card glass signin-card signin-staff' },
        h('span', { class: 'pill pill-ok', style: { alignSelf: 'flex-start' } }, icon('shield'), 'Owner, editors & reviewers'),
        h('h2', { text: 'Open the dashboard' }),
        h('ol', { class: 'step-list' },
          h('li', { text: 'Sign in with the Gmail address the owner added to the team.' }),
          h('li', { text: 'The dashboard opens straight away: review queue, catalogue, team and settings.' }),
          h('li', { text: 'Later, reach it any time from Dashboard in the top bar or your account menu.' })),
        errB,
        googleButton({ next: '/admin', errorEl: errB, label: 'Sign in to the dashboard' })))));
}
