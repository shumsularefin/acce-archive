/* ============================================================
   ACCE Archive - application shell
   Hash router, header/navigation, sign-in gate, theme, quick search.
   ============================================================ */
import { CONFIG } from './config.js';
import { $, h, icon, store, toast, initials, fill } from './lib/dom.js';
import { fb, initFirebase, onSession, signOut, isStaff, getSettings, fs, saveProfile } from './services/firebase.js';
import { student, logVisit } from './services/student.js';
import { openQuickSearch } from './views/quicksearch.js';

const ROUTES = [
  { re: /^\/?$/, view: () => import('./views/home.js'), nav: 'home' },
  { re: /^\/library(?:\/(\w+))?((?:\/[^/]+)*)\/?$/, view: () => import('./views/library.js'), nav: 'home' },
  { re: /^\/browse\/(\w+)((?:\/[\w-]+)*)\/?$/, view: () => import('./views/browse.js'), nav: 'home' },
  { re: /^\/file\/([\w-]+)\/?$/, view: () => import('./views/file.js'), nav: 'home' },
  { re: /^\/search\/?$/, view: () => import('./views/search.js'), nav: 'search' },
  { re: /^\/submit\/?$/, view: () => import('./views/submit.js'), nav: 'submit', auth: true },
  { re: /^\/my\/?$/, view: () => import('./views/my.js'), nav: 'my', auth: true },
  { re: /^\/profile\/?$/, view: () => import('./views/profile.js'), nav: 'my', auth: true },
  { re: /^\/admin(?:\/(\w+))?(?:\/([\w-]+))?\/?$/, view: () => import('./views/admin.js'), nav: 'admin', staff: true },
  { re: /^\/about\/?$/, view: () => import('./views/about.js'), nav: 'about' }
];

const NAV = [
  { key: 'home', href: '#/', label: 'Browse', ic: 'layers' },
  { key: 'search', href: '#/search', label: 'Search', ic: 'search' },
  { key: 'submit', href: '#/submit', label: 'Contribute', ic: 'upload' },
  { key: 'my', href: '#/my', label: 'My uploads', ic: 'inbox', auth: true },
  { key: 'admin', href: '#/admin', label: 'Dashboard', ic: 'shield', staff: true }
];

const app = $('#app'), gate = $('#gate'), view = $('#view');
let cleanup = null, routeToken = 0, mode = null, pendingBadge = 0;
let closeAccountMenu = () => {};
document.addEventListener('click', (e) => closeAccountMenu(e));

/* ---------- routing ---------- */
export function parseHash() {
  let raw = location.hash.replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch {}
  raw ||= '/';
  const [pathAndQuery, anchor = ''] = raw.split('#');
  const [path, qs = ''] = pathAndQuery.split('?');
  return { path: path || '/', query: new URLSearchParams(qs), anchor };
}

export const navigate = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

async function render() {
  if (mode !== 'app') return;
  const token = ++routeToken;
  const { path, query, anchor } = parseHash();
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) return navigate('#/');
  const params = path.match(route.re).slice(1);

  try { cleanup?.(); } catch {}
  cleanup = null;
  drawNav(route.nav);

  if (route.auth && !fb.user) return guard('Sign in to continue', 'Contributing and tracking your uploads needs a Google account, so reviewers know who to credit.');
  if (route.staff && !isStaff()) return guard('Staff only', 'The dashboard is for archive reviewers and administrators.', !!fb.user);

  const mod = await route.view();
  if (token !== routeToken) return;
  const swap = async () => {
    fill(view);
    view.scrollTop = 0;
    const out = await mod.render({ root: view, params, query, anchor, navigate });
    if (token === routeToken) cleanup = typeof out === 'function' ? out : null;
    else if (typeof out === 'function') out();
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else await swap();
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }));
  else window.scrollTo({ top: 0 });
}

function guard(title, text, signedIn = false) {
  fill(view, h('section', { class: 'page narrow center-page' },
    h('div', { class: 'card glass guard' },
      h('div', { class: 'empty-ic' }, icon(signedIn ? 'lock' : 'user')),
      h('h2', { text: title }), h('p', { class: 'muted', text }),
      signedIn ? h('a', { class: 'btn btn-ghost', href: '#/', text: 'Back to the archive' })
        : fb.ready ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => import('./views/gate.js').then((g) => g.startSignIn()) }, icon('user'), 'Sign in with Google')
          : h('p', { class: 'muted small', text: 'Sign-in is unavailable right now.' }))));
}

/* ---------- header ---------- */
function drawNav(active) {
  const visible = NAV.filter((n) => (!n.auth || fb.user) && (!n.staff || isStaff()));
  const link = (n, cls) => h('a', { class: `${cls} ${n.key === active ? 'active' : ''}`, href: n.href, 'aria-current': n.key === active ? 'page' : null },
    icon(n.ic), h('span', { text: n.label }),
    n.key === 'admin' && pendingBadge ? h('b', { class: 'badge-dot', text: pendingBadge > 99 ? '99+' : pendingBadge }) : null);
  fill($('#main-nav'), ...visible.map((n) => link(n, 'nav-link')));
  fill($('#tabbar'), ...visible.map((n) => link(n, 'tab-link')));
}

function drawAccount() {
  const box = $('#account');
  if (!fb.user) return drawStudentAccount(box);
  const name = fb.profile?.displayName || fb.user.displayName || fb.user.email;
  const avatar = fb.user.photoURL
    ? h('img', { src: fb.user.photoURL, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('span', { class: 'avatar-txt', text: initials(name) })) })
    : h('span', { class: 'avatar-txt', text: initials(name) });
  const menu = h('div', { class: 'menu glass', role: 'menu', hidden: true },
    h('div', { class: 'menu-head' }, h('strong', { text: name }), h('span', { text: fb.user.email }),
      fb.role ? h('span', { class: 'pill pill-ok', text: fb.role }) : null),
    h('a', { href: '#/profile', role: 'menuitem' }, icon('user'), 'Profile'),
    h('a', { href: '#/my', role: 'menuitem' }, icon('inbox'), 'My uploads'),
    isStaff() ? h('a', { href: '#/admin', role: 'menuitem' }, icon('shield'), 'Dashboard') : null,
    h('button', { type: 'button', role: 'menuitem', onclick: () => signOut().then(() => toast('Signed out', 'ok')) }, icon('logout'), 'Sign out'));
  const btn = h('button', { class: 'avatar', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Account menu' }, avatar);
  const toggle = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = (e) => { e.stopPropagation(); toggle(menu.hidden); };
  closeAccountMenu = (e) => { if (!menu.hidden && !menu.contains(e.target)) toggle(false); };
  menu.addEventListener('click', (e) => { if (e.target.closest('a,button')) toggle(false); });
  fill(box, btn, menu);
}

/** Header menu for a student who came in with their ID (no Google account). */
function drawStudentAccount(box) {
  const s = student.get();
  if (!s) { fill(box); return; }
  const menu = h('div', { class: 'menu glass', role: 'menu', hidden: true },
    h('div', { class: 'menu-head' }, h('strong', { text: s.name }), h('span', { text: `${s.sid} \u00b7 session ${s.session}\u2013${String(+s.session + 1).slice(2)}` })),
    fb.ready ? h('button', { type: 'button', role: 'menuitem', onclick: () => import('./views/gate.js').then((g) => g.startSignIn()) }, icon('upload'), 'Sign in with Google to contribute') : null,
    h('button', { type: 'button', role: 'menuitem', onclick: () => { student.clear(); decide(); } }, icon('logout'), 'Not you? Change student'));
  const btn = h('button', { class: 'avatar', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Account menu' }, h('span', { class: 'avatar-txt', text: initials(s.name) }));
  const toggle = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = (e) => { e.stopPropagation(); toggle(menu.hidden); };
  closeAccountMenu = (e) => { if (!menu.hidden && !menu.contains(e.target)) toggle(false); };
  menu.addEventListener('click', (e) => { if (e.target.closest('a,button')) toggle(false); });
  fill(box, btn, menu);
}

async function refreshStaffBadge() {
  pendingBadge = 0;
  if (!isStaff()) return;
  try {
    const F = fs();
    const snap = await F.getCountFromServer(F.query(F.collection(fb.db, 'submissions'), F.where('status', '==', 'pending')));
    pendingBadge = snap.data().count;
    drawNav(ROUTES.find((r) => r.re.test(parseHash().path))?.nav);
  } catch {}
}

async function showAnnouncement() {
  if (!fb.ready) return;
  const s = await getSettings();
  const bar = $('#announce');
  if (s.announcement) { fill(bar, icon('info'), h('span', { text: s.announcement })); bar.hidden = false; }
  else bar.hidden = true;
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('meta[name=theme-color]').content = t === 'light' ? '#eaf3ee' : '#06231b';
  $('#theme-btn use').setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun');
  $('#theme-btn').title = t === 'light' ? 'Switch to dark view' : 'Switch to light view';
}
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  store.set('acce.theme', next);
});

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (mode !== 'app' || document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    const local = e.key === '/' && view.querySelector('[data-slash-target]');
    local ? local.focus() : openQuickSearch();
  }
});
$('#search-trigger').addEventListener('click', () => openQuickSearch());

/* ---------- boot ---------- */
let identity = null;
function setMode(next) {
  $('#boot')?.remove();
  if (next === 'app') {
    const who = `${fb.user?.uid || student.get()?.sid || 'anon'}|${fb.role || ''}|${fb.ready}`;
    if (mode === 'app' && who === identity) return;          // nothing changed: keep the current view
    identity = who;
    gate.hidden = true; fill(gate);
    app.hidden = false;
    const changed = mode !== 'app';
    mode = 'app';
    drawAccount();
    if (changed || fb.ready) showAnnouncement();
    refreshStaffBadge();
    render();
  } else {
    if (mode === next) return;                               // don't wipe a half-filled form
    mode = next;
    app.hidden = true;
    gate.hidden = false;
    import('./views/gate.js').then((g) => g.renderGate(gate, next));
  }
}

/**
 * Who gets in:
 *  - students: name + session + ID on this device (the default, no Google needed)
 *  - Google accounts (contributors, staff): once they have a profile
 * A student who later signs in with Google gets their profile filled from their student details.
 */
let autoProfiling = false;
function decide() {
  const s = student.get();
  if (fb.user) {
    if (fb.profile) return setMode('app');
    if (s && !autoProfiling) {
      autoProfiling = true;
      saveProfile({ displayName: s.name, affiliation: 'student', session: s.session, studentId: s.sid })
        .catch(() => setMode('profile'))
        .finally(() => { autoProfiling = false; });
      return;
    }
    if (!autoProfiling) setMode('profile');
    return;
  }
  if (s) { logVisit(s); return setMode('app'); }
  setMode('student');
}

window.addEventListener('hashchange', render);
window.addEventListener('acce:student', () => decide());

(async function boot() {
  onSession(() => decide());
  // A returning student is let in at once, as on the original site; Firebase loads in the background.
  // Otherwise give Firebase a moment so signed-in staff don't see the student form flash past.
  if (!student.get()) await Promise.race([initFirebase(), new Promise((r) => setTimeout(r, 1500))]);
  decide();
  initFirebase().then((ready) => { if (!ready && fb.error) console.info('Running without Firebase:', fb.error); });
})();
