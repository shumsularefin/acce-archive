/* ============================================================
   Student access - the archive's default way in, as on the original
   site: name + session + student ID, checked in the browser, kept on
   this device, and logged once per visit to Firestore visitors/{ID}.
   No Google account needed; Google sign-in is only for contributors
   and staff. Uses the original "acce.user" key so returning students
   go straight in.
   ============================================================ */
import { CONFIG } from '../config.js';
import { store } from '../lib/dom.js';
import { fb, fs } from './firebase.js';

const KEY = 'acce.user';

export function validateStudent(name, session, sid) {
  if (String(name || '').trim().length < 3) return 'That name is too short to be a full name.';
  if (!session) return 'No session selected.';
  const m = CONFIG.idPattern.exec(sid || '');
  if (!m) return 'That student ID is not in the departmental format.';
  if (m[1] !== String(session).slice(2)) return 'That student ID does not belong to the selected session.';
  if (m[2] === '00') return 'That serial number is not valid.';
  return null;
}

export const student = {
  /** The saved student on this device, or null. */
  get() {
    const s = store.get(KEY);
    return s && !validateStudent(s.name, s.session, s.sid) ? s : null;
  },
  save(name, session, sid) {
    const prev = store.get(KEY);
    const s = { name: name.trim().replace(/\s+/g, ' '), session: String(session), sid, firstSeen: prev?.sid === sid ? prev.firstSeen : new Date().toISOString() };
    store.set(KEY, s);
    return s;
  },
  clear() { store.del(KEY); }
};

/** One visitor-log write per browser session (Firestore free tier: 20k writes/day). */
export async function logVisit(s) {
  if (!s || !fb.ready) return;
  const flag = `acce.logged.${s.sid}`;
  try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch {}
  const F = fs();
  try {
    await F.setDoc(F.doc(fb.db, 'visitors', s.sid), {
      name: s.name, session: s.session, studentId: s.sid,
      firstSeen: F.Timestamp.fromDate(new Date(s.firstSeen || Date.now())),
      lastSeen: F.serverTimestamp(), visits: F.increment(1),
      device: navigator.userAgent.slice(0, 180)
    }, { merge: true });
  } catch (e) { console.info('Visitor log skipped:', e.code || e.message); }
}
