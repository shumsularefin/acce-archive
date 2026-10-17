/* ============================================================
   Firebase: Google sign-in, profiles, and Firestore access.
   The SDK is loaded lazily from Google's CDN. If Firebase is not
   configured or unreachable, ready() resolves to false and the
   archive keeps working as a browse-only site.
   ============================================================ */
import { CONFIG } from '../config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

export const fb = {
  ready: false,
  auth: null,
  db: null,
  user: null,        // Firebase user
  profile: null,     // users/{uid} document data
  role: null,        // 'reviewer' | 'admin' | 'owner' | null
  error: null
};

let A, F;            // auth + firestore module namespaces
export const fs = () => F;

const listeners = new Set();
export function onSession(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const emit = () => listeners.forEach((cb) => { try { cb(fb); } catch (e) { console.error(e); } });

async function loadConfig() {
  if (CONFIG.firebase) return CONFIG.firebase;
  const res = await fetch('/__/firebase/init.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Firebase web app is not registered for this site');
  return res.json();
}

let initPromise;
export function initFirebase() {
  initPromise ||= (async () => {
    try {
      const config = await loadConfig();
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)
      ]);
      A = authMod; F = fsMod;
      const app = appMod.initializeApp(config);
      fb.auth = A.getAuth(app);
      fb.db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
      if (CONFIG.emulators) useEmulators(CONFIG.emulators);
      fb.ready = true;
      await new Promise((resolve) => {
        let first = true;
        A.onAuthStateChanged(fb.auth, async (user) => {
          fb.user = user;
          fb.profile = null;
          fb.role = null;
          if (user) await loadSession(user);
          emit();
          if (first) { first = false; resolve(); }
        });
      });
      A.getRedirectResult(fb.auth).catch((e) => { fb.error = friendlyAuthError(e); emit(); });
    } catch (e) {
      console.warn('Firebase unavailable:', e);
      fb.error = e.message;
    }
    return fb.ready;
  })();
  return initPromise;
}

/** Local development / tests only: talk to the Firebase emulators. */
function useEmulators({ auth, firestore }) {
  A.connectAuthEmulator(fb.auth, auth, { disableWarnings: true });
  F.connectFirestoreEmulator(fb.db, firestore.host, firestore.port);
  window.__acceTest = { signIn: (claims) => A.signInWithCredential(fb.auth, A.GoogleAuthProvider.credential(JSON.stringify(claims))) };
}

async function loadSession(user) {
  const email = (user.email || '').toLowerCase();
  const [p, a] = await Promise.allSettled([
    F.getDoc(F.doc(fb.db, 'users', user.uid)),
    email && user.emailVerified ? F.getDoc(F.doc(fb.db, 'admins', email)) : Promise.resolve(null)
  ]);
  if (p.status === 'fulfilled' && p.value.exists()) fb.profile = p.value.data();
  if (a.status === 'fulfilled' && a.value?.exists?.()) fb.role = a.value.data().role || null;
  if (fb.profile) touchVisit(user.uid);
}

function touchVisit(uid) {
  const key = `acce.visit.${uid}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch {}
  F.updateDoc(F.doc(fb.db, 'users', uid), { lastSeen: F.serverTimestamp(), visits: F.increment(1) }).catch(() => {});
}

/* ---------- auth ---------- */
export async function signIn() {
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await A.signInWithPopup(fb.auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      return A.signInWithRedirect(fb.auth, provider);
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    throw new Error(friendlyAuthError(e));
  }
}

export const signOut = () => A.signOut(fb.auth);
export const idToken = () => fb.user ? fb.user.getIdToken() : Promise.reject(new Error('Please sign in first.'));

function friendlyAuthError(e) {
  const map = {
    'auth/unauthorized-domain': 'This web address is not authorised for sign-in yet (Firebase > Authentication > Settings > Authorised domains).',
    'auth/operation-not-allowed': 'Google sign-in is not enabled for this project yet.',
    'auth/network-request-failed': 'Network problem - check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled.'
  };
  return map[e?.code] || e?.message || 'Sign-in failed.';
}

/* ---------- profile ---------- */
export async function saveProfile(data) {
  const ref = F.doc(fb.db, 'users', fb.user.uid);
  const base = {
    displayName: data.displayName,
    email: fb.user.email,
    photoURL: fb.user.photoURL || '',
    affiliation: data.affiliation,
    session: data.session || '',
    studentId: data.studentId || ''
  };
  if (fb.profile) {
    await F.updateDoc(ref, base);
  } else {
    await F.setDoc(ref, { ...base, createdAt: F.serverTimestamp(), lastSeen: F.serverTimestamp(), visits: 1 });
  }
  const snap = await F.getDoc(ref);
  fb.profile = snap.data();
  emit();
}

export const isStaff = () => !!fb.role;
export const isAdmin = () => fb.role === 'admin' || fb.role === 'owner';
export const isOwner = () => fb.role === 'owner';

/* ---------- small Firestore conveniences ---------- */
export function docs(snap) { return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }

export async function getSettings() {
  try { const s = await F.getDoc(F.doc(fb.db, 'config', 'settings')); return s.exists() ? s.data() : {}; } catch { return {}; }
}

export async function linkItemsIn(folderId) {
  if (!fb.ready) return [];
  try {
    const q = F.query(F.collection(fb.db, 'items'), F.where('kind', '==', 'link'), F.where('folderId', '==', folderId));
    return docs(await F.getDocs(q)).filter((d) => d.status === 'published');
  } catch { return []; }
}

export async function allLinkItems() {
  if (!fb.ready) return [];
  try {
    const q = F.query(F.collection(fb.db, 'items'), F.where('kind', '==', 'link'), F.limit(500));
    return docs(await F.getDocs(q)).filter((d) => d.status === 'published');
  } catch { return []; }
}

export async function courses() {
  if (!fb.ready) return [];
  try { return docs(await F.getDocs(F.collection(fb.db, 'courses'))); } catch { return []; }
}

export async function report(file, reason, details) {
  await F.addDoc(F.collection(fb.db, 'reports'), {
    uid: fb.user.uid, email: fb.user.email, fileId: file.id, fileName: file.name || '',
    reason, details, status: 'open', createdAt: F.serverTimestamp()
  });
}
