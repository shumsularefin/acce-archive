// Run with: npm run test:rules  (starts the Firestore emulator)
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, query, where, serverTimestamp, deleteDoc } from 'firebase/firestore';

let env;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-acce',
    firestore: { rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) }
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'admins/rev@gmail.com'), { email: 'rev@gmail.com', role: 'reviewer' });
    await setDoc(doc(db, 'admins/adm@gmail.com'), { email: 'adm@gmail.com', role: 'admin' });
    await setDoc(doc(db, 'admins/own@gmail.com'), { email: 'own@gmail.com', role: 'owner' });
    await setDoc(doc(db, 'submissions/s1'), { uid: 'alice', status: 'pending', email: 'alice@gmail.com' });
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob B', email: 'bob@gmail.com', affiliation: 'guest', createdAt: new Date() });
    await setDoc(doc(db, 'items/f1'), { title: 'Public thing', status: 'published' });
    await setDoc(doc(db, 'reports/r1'), { uid: 'alice', status: 'open', fileId: 'f1' });
  });
});

const as = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const profile = (email, extra = {}) => ({ displayName: 'Alice A', email, affiliation: 'student', session: '2020', studentId: '20ACE017', createdAt: serverTimestamp(), lastSeen: serverTimestamp(), visits: 1, ...extra });

test('users create a valid profile for themselves only', async () => {
  const alice = as('alice', 'alice@gmail.com');
  await assertFails(setDoc(doc(alice, 'users/bob'), profile('alice@gmail.com')));
  await assertFails(setDoc(doc(alice, 'users/alice'), profile('other@gmail.com')));
  await assertFails(setDoc(doc(alice, 'users/alice'), profile('alice@gmail.com', { studentId: 'NOPE' })));
  await assertFails(setDoc(doc(alice, 'users/alice'), profile('alice@gmail.com', { studentId: '' })), 'students need an ID');
  await assertFails(setDoc(doc(alice, 'users/alice'), profile('alice@gmail.com', { status: 'active' })));
  await assertFails(setDoc(doc(alice, 'users/alice'), profile('alice@gmail.com', { role: 'owner' })));
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice@gmail.com')));
  await assertSucceeds(setDoc(doc(as('carol', 'carol@gmail.com'), 'users/carol'), profile('carol@gmail.com', { affiliation: 'faculty', session: '', studentId: '' })));
});

test('users cannot unblock themselves; admins can only flip status', async () => {
  const bob = as('bob', 'bob@gmail.com');
  await assertSucceeds(updateDoc(doc(bob, 'users/bob'), { displayName: 'Bob Builder' }));
  await assertFails(updateDoc(doc(bob, 'users/bob'), { status: 'active' }));
  await assertFails(getDoc(doc(as('alice', 'alice@gmail.com'), 'users/bob')));
  await assertSucceeds(getDoc(doc(as('r', 'rev@gmail.com'), 'users/bob')));
  await assertFails(updateDoc(doc(as('r', 'rev@gmail.com'), 'users/bob'), { status: 'blocked' }), 'reviewers cannot block');
  await assertSucceeds(updateDoc(doc(as('a', 'adm@gmail.com'), 'users/bob'), { status: 'blocked' }));
  await assertFails(updateDoc(doc(as('a', 'adm@gmail.com'), 'users/bob'), { displayName: 'Hacked' }));
});

test('submissions are private to their author and staff, and read-only', async () => {
  await assertSucceeds(getDoc(doc(as('alice', 'alice@gmail.com'), 'submissions/s1')));
  await assertFails(getDoc(doc(as('bob', 'bob@gmail.com'), 'submissions/s1')));
  await assertSucceeds(getDocs(query(collection(as('alice', 'alice@gmail.com'), 'submissions'), where('uid', '==', 'alice'))));
  await assertFails(getDocs(collection(as('bob', 'bob@gmail.com'), 'submissions')));
  await assertSucceeds(getDocs(collection(as('r', 'rev@gmail.com'), 'submissions')));
  await assertFails(updateDoc(doc(as('alice', 'alice@gmail.com'), 'submissions/s1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(as('o', 'own@gmail.com'), 'submissions/s1'), { status: 'approved' }), 'even owners go through the backend');
  await assertFails(setDoc(doc(as('alice', 'alice@gmail.com'), 'submissions/new'), { uid: 'alice', status: 'approved' }));
});

test('staff status needs a verified email', async () => {
  await assertFails(getDocs(collection(as('r', 'rev@gmail.com', false), 'submissions')));
  await assertFails(getDoc(doc(as('x', 'rev@gmail.com', false), 'admins/rev@gmail.com')));
  await assertSucceeds(getDoc(doc(as('x', 'rev@gmail.com'), 'admins/rev@gmail.com')));
  await assertFails(getDoc(doc(as('bob', 'bob@gmail.com'), 'admins/rev@gmail.com')));
  await assertFails(setDoc(doc(as('bob', 'bob@gmail.com'), 'admins/bob@gmail.com'), { role: 'owner' }));
  await assertFails(setDoc(doc(as('o', 'own@gmail.com'), 'admins/bob@gmail.com'), { role: 'owner' }), 'roles change only through the backend');
});

test('the public catalogue is readable by anyone and writable by no client', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'items/f1')));
  await assertSucceeds(getDoc(doc(anon(), 'config/settings')));
  await assertFails(setDoc(doc(as('o', 'own@gmail.com'), 'items/f2'), { title: 'x' }));
  await assertFails(getDocs(collection(as('alice', 'alice@gmail.com'), 'fingerprints')));
  await assertFails(getDocs(collection(as('alice', 'alice@gmail.com'), 'audit')));
  await assertSucceeds(getDocs(collection(as('r', 'rev@gmail.com'), 'audit')));
});

test('courses are curated by admins with a fixed shape', async () => {
  const course = { code: 'ACCE-3101', title: 'Thermodynamics', program: 'bsc', active: true };
  await assertFails(setDoc(doc(as('r', 'rev@gmail.com'), 'courses/ACCE-3101'), course));
  await assertFails(setDoc(doc(as('a', 'adm@gmail.com'), 'courses/bad code'), course));
  await assertFails(setDoc(doc(as('a', 'adm@gmail.com'), 'courses/ACCE-3101'), { ...course, evil: 1 }));
  await assertSucceeds(setDoc(doc(as('a', 'adm@gmail.com'), 'courses/ACCE-3101'), course));
  await assertSucceeds(getDoc(doc(anon(), 'courses/ACCE-3101')));
  await assertSucceeds(deleteDoc(doc(as('a', 'adm@gmail.com'), 'courses/ACCE-3101')));
});

test('settings are owner-only', async () => {
  await assertFails(setDoc(doc(as('a', 'adm@gmail.com'), 'config/settings'), { uploadsOpen: false }));
  await assertSucceeds(setDoc(doc(as('o', 'own@gmail.com'), 'config/settings'), { uploadsOpen: false }));
});

test('reports: signed-in users file them, staff resolve them', async () => {
  const alice = as('alice', 'alice@gmail.com');
  const good = { uid: 'alice', email: 'alice@gmail.com', fileId: 'f1', fileName: 'x.pdf', reason: 'broken', details: 'Page 3 missing', status: 'open', createdAt: serverTimestamp() };
  await assertFails(addDoc(collection(anon(), 'reports'), good));
  await assertFails(addDoc(collection(alice, 'reports'), { ...good, uid: 'bob' }));
  await assertFails(addDoc(collection(alice, 'reports'), { ...good, status: 'resolved' }));
  await assertFails(addDoc(collection(alice, 'reports'), { ...good, reason: 'spam' }));
  await assertSucceeds(addDoc(collection(alice, 'reports'), good));
  await assertFails(updateDoc(doc(alice, 'reports/r1'), { status: 'resolved' }));
  await assertFails(updateDoc(doc(as('r', 'rev@gmail.com'), 'reports/r1'), { fileId: 'other' }));
  await assertSucceeds(updateDoc(doc(as('r', 'rev@gmail.com'), 'reports/r1'), { status: 'resolved', resolution: 'fixed', resolvedBy: 'rev@gmail.com', resolvedAt: serverTimestamp() }));
});
