import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createHarness, META } from './gas-harness.mjs';

const MIB = 1024 * 1024;
const bytes = (n, seed = 1) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };

test('validates and normalises metadata', () => {
  const { ctx } = createHarness();
  const m = JSON.parse(JSON.stringify(ctx.validateMeta_({ ...META, tags: ['Heat', 'heat', ' Mass '], examYear: '2023', session: '2021-22' })));
  assert.equal(m.courseCode, 'ACCE-3101');
  assert.deepEqual(m.tags, ['heat', 'mass']);
  assert.equal(m.examYear, 2023);
  assert.equal(m.credit, true);
  assert.throws(() => ctx.validateMeta_({ ...META, type: 'poster' }), /Unknown material type/);
  assert.throws(() => ctx.validateMeta_({ ...META, courseCode: 'thermo' }), /ACCE-3101/);
  assert.throws(() => ctx.validateMeta_({ ...META, title: 'x' }), /descriptive title/);
  assert.throws(() => ctx.validateMeta_({ ...META, rights: '' }), /rights/);
});

test('cleans file names and refuses unknown types', () => {
  const { ctx } = createHarness();
  assert.equal(ctx.cleanFileName_('../a/b:c*d.PDF').name, '.. a b c d.pdf');
  assert.throws(() => ctx.validateFile_({ name: 'x.exe', size: 10, sha256: 'a'.repeat(64) }, { maxFileMB: 50 }), /not accepted/);
  assert.throws(() => ctx.validateFile_({ name: 'x.pdf', size: 51 * MIB, sha256: 'a'.repeat(64) }, { maxFileMB: 50 }), /50 MB/);
  assert.equal(ctx.validateFile_({ name: 'x.pdf', size: 10, sha256: 'A'.repeat(64) }, { maxFileMB: 50 }).mime, 'application/pdf');
});

test('Firestore value encoding round-trips', () => {
  const { ctx } = createHarness();
  // build values inside the script's realm so instanceof Date behaves as in Apps Script
  const out = vm.runInContext(`(() => {
    const doc = { s: 'x', i: 3, d: 1.5, b: false, n: null, t: new Date('2025-01-02T03:04:05.000Z'), a: [1, 'two', { k: true }], m: { inner: { deep: 'yes' } } };
    const back = fromFields_(toFields_(doc));
    return JSON.stringify({ doc, back, ts: toFields_(doc).t, dotted: expandDotted_({ 'file.driveId': 'x', status: 'p' }) });
  })()`, ctx);
  const r = JSON.parse(out);
  assert.deepEqual(r.back, r.doc);
  assert.deepEqual(r.ts, { timestampValue: '2025-01-02T03:04:05.000Z' });
  assert.deepEqual(r.dotted, { file: { driveId: 'x' }, status: 'p' });
});

test('rejects unauthenticated, unverified and unknown requests', () => {
  const h = createHarness();
  assert.equal(h.post({ action: 'nope' }).error.code, 'bad_request');
  assert.equal(h.post({ action: 'init', idToken: 'forged' }).error.code, 'unauthenticated');
  const t = h.addUser('u2', 'u2@gmail.com', { verified: false });
  assert.equal(h.post({ action: 'init', idToken: t }).error.code, 'unverified');
  assert.equal(h.post({ action: 'config' }).ok, true);
  const bad = h.ctx.doPost({ postData: { contents: '{not json' } });
  assert.equal(JSON.parse(bad.content).error.code, 'bad_request');
});

test('a contributor needs a profile and cannot review', () => {
  const h = createHarness();
  const noProfile = h.addUser('np', 'np@gmail.com', { profile: false });
  assert.throws(() => h.upload(noProfile, bytes(100), META), /profile/);
  const t = h.addUser('u1', 'u1@gmail.com');
  assert.throws(() => h.call({ action: 'review', idToken: t, submissionId: 'abcdefgh12', decision: 'approve' }), (e) => e.code === 'forbidden');
  assert.throws(() => h.call({ action: 'setAdmin', idToken: t, email: 'x@y.z', role: 'owner' }), (e) => e.code === 'forbidden');
});

test('chunked upload lands in Pending with an intact checksum', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const buf = bytes(5 * MIB + 777);              // two chunks
  const r = h.upload(t, buf, META);
  assert.equal(r.done, true);
  const sub = h.db.get(`submissions/${r.submissionId}`);
  assert.equal(sub.status, 'pending');
  assert.equal(sub.meta.courseCode, 'ACCE-3101');
  const file = h.drive.get(sub.file.driveId);
  assert.deepEqual(file.parents, ['pending']);
  assert.equal(file.sha256Checksum, r.sha256);
  assert.equal(h.db.get(`fingerprints/${r.sha256}`).status, 'pending');
  assert.equal(h.mail.length, 1, 'owner is notified');
  assert.match(h.mail[0].subject, /New submission/);
});

test('identical files are refused before any bytes are sent', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const buf = bytes(1000);
  h.upload(t, buf, META);
  const before = h.fetchLog.length;
  assert.throws(() => h.upload(t, buf, META, 'renamed.pdf'), (e) => e.code === 'duplicate');
  assert.ok(!h.fetchLog.slice(before).some((l) => l.includes('upload')), 'no upload session opened');
});

test('a lost chunk response is recovered by re-syncing with Drive', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const buf = bytes(5 * MIB + 10, 7);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const init = h.call({ action: 'init', idToken: t, meta: META, file: { name: 'a.pdf', size: buf.length, sha256 } });
  const first = buf.subarray(0, init.chunkBytes).toString('base64');
  assert.equal(h.call({ action: 'chunk', idToken: t, uploadId: init.uploadId, offset: 0, data: first }).next, init.chunkBytes);
  h.cache.set(`up:${init.uploadId}`, JSON.stringify({ ...JSON.parse(h.cache.get(`up:${init.uploadId}`)), received: 0 })); // simulate lost state
  const resync = h.call({ action: 'chunk', idToken: t, uploadId: init.uploadId, offset: init.chunkBytes, data: 'AA==' });
  assert.equal(resync.next, init.chunkBytes);
  const done = h.call({ action: 'chunk', idToken: t, uploadId: init.uploadId, offset: init.chunkBytes, data: buf.subarray(init.chunkBytes).toString('base64') });
  assert.equal(done.done, true);
  // a retry of the final chunk after success is answered as done, not as an error
  assert.equal(h.call({ action: 'chunk', idToken: t, uploadId: init.uploadId, offset: init.chunkBytes, data: 'AA==' }).done, true);
  // someone else cannot touch the session
  const other = h.addUser('u9', 'u9@gmail.com');
  assert.throws(() => h.call({ action: 'chunk', idToken: other, uploadId: init.uploadId, offset: 0, data: 'AA==' }), (e) => e.code === 'expired');
});

test('a checksum mismatch discards the file', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  h.corruptNext = true;
  assert.throws(() => h.upload(t, bytes(2000), META), (e) => e.code === 'integrity');
  assert.equal([...h.drive.values()].filter((f) => f.parents?.includes('pending')).length, 0);
});

test('reviewer approves into a public folder; record travels with the file', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const rev = h.addUser('rv', 'rev@gmail.com', { role: 'reviewer' });
  h.addFolder('y3', 'Year 3', 'root-bsc');
  const { submissionId } = h.upload(t, bytes(3000), META);

  assert.throws(() => h.call({ action: 'review', idToken: rev, submissionId, decision: 'approve', folderId: 'private', meta: META }), /inside the public archive/);

  const out = h.call({ action: 'review', idToken: rev, submissionId, decision: 'approve', folderId: 'y3', newFolderName: 'ACCE-3101 Thermodynamics', fileName: 'ACCE-3101 - Thermo notes.pdf', meta: { ...META, examYear: 2024 } });
  assert.equal(out.status, 'approved');
  assert.equal(out.published.folderPath, 'BSc archive / Year 3 / ACCE-3101 Thermodynamics');
  const f = h.drive.get(out.published.fileId);
  assert.equal(f.name, 'ACCE-3101 - Thermo notes.pdf');
  assert.equal(h.drive.get(f.parents[0]).parents[0], 'y3');
  assert.equal(f.properties.acce_course, 'ACCE-3101');
  assert.match(f.description, /Contributed by: User u1/);
  const item = h.db.get(`items/${f.id}`);
  assert.equal(item.collection, 'bsc');
  assert.equal(h.db.get(`fingerprints/${item.sha256}`).status, 'published');
  assert.equal(h.db.get('courses/ACCE-3101').destinations.bsc.folderId, f.parents[0]);
  const sub = h.db.get(`submissions/${submissionId}`);
  assert.equal(sub.reviewer.email, 'rev@gmail.com');
  assert.deepEqual(sub.history.map((x) => x.action), ['submitted', 'approved']);
  assert.ok(h.mail.some((m) => m.to === 'u1@gmail.com' && /Published/.test(m.subject)));
  assert.throws(() => h.call({ action: 'review', idToken: rev, submissionId, decision: 'reject', note: 'again' }), (e) => e.code === 'state');
});

test('declining requires a reason and frees the space', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const rev = h.addUser('rv', 'rev@gmail.com', { role: 'reviewer' });
  const { submissionId, sha256 } = h.upload(t, bytes(4000), META);
  const driveId = h.db.get(`submissions/${submissionId}`).file.driveId;
  assert.throws(() => h.call({ action: 'review', idToken: rev, submissionId, decision: 'reject', note: '' }), /why/);
  h.call({ action: 'review', idToken: rev, submissionId, decision: 'reject', note: 'Wrong course, please resubmit.' });
  assert.equal(h.drive.has(driveId), false);
  assert.equal(h.db.has(`fingerprints/${sha256}`), false, 'the same file can be resubmitted');
  assert.equal(h.db.get(`submissions/${submissionId}`).status, 'rejected');
});

test('only the contributor can withdraw, and only while pending', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const other = h.addUser('u2', 'u2@gmail.com');
  const { submissionId } = h.upload(t, bytes(500), META);
  assert.throws(() => h.call({ action: 'withdraw', idToken: other, submissionId }), (e) => e.code === 'forbidden');
  h.call({ action: 'withdraw', idToken: t, submissionId });
  assert.equal(h.db.get(`submissions/${submissionId}`).status, 'withdrawn');
  assert.throws(() => h.call({ action: 'withdraw', idToken: t, submissionId }), (e) => e.code === 'state');
});

test('link submissions use no storage and publish as catalogue items', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  const owner = h.addUser('own', 'owner@gmail.com');   // owner via OWNER_EMAILS
  assert.throws(() => h.call({ action: 'init', idToken: t, kind: 'link', link: 'http://insecure.example', meta: META }), /https/);
  const { submissionId } = h.call({ action: 'init', idToken: t, kind: 'link', link: 'https://nptel.ac.in/courses/103', meta: { ...META, type: 'media' } });
  const out = h.call({ action: 'review', idToken: owner, submissionId, decision: 'approve', folderId: 'root-bsc', meta: { ...META, type: 'media' } });
  assert.equal(h.db.get(`items/${out.published.itemId}`).url, 'https://nptel.ac.in/courses/103');
});

test('limits: closed submissions, quota reserve, open-submission cap', () => {
  const h = createHarness();
  const t = h.addUser('u1', 'u1@gmail.com');
  h.db.set('config/settings', { uploadsOpen: false });
  assert.throws(() => h.upload(t, bytes(10), META), (e) => e.code === 'closed');
  h.cache.clear();
  h.db.set('config/settings', { uploadsOpen: true, maxPendingPerUser: 1 });
  h.upload(t, bytes(10, 1), META);
  assert.throws(() => h.upload(t, bytes(10, 2), META), (e) => e.code === 'limit');
  h.cache.clear();
  h.db.set('config/settings', { maxPendingPerUser: 50 });
  h.quota.usage = String(15 * 1024 ** 3 - 100 * MIB);       // below the 1 GB reserve
  assert.throws(() => h.upload(t, bytes(10, 3), META), (e) => e.code === 'storage');
});

test('owners manage roles; takedown moves files out of public view', () => {
  const h = createHarness();
  const owner = h.addUser('own', 'owner@gmail.com');
  h.call({ action: 'setAdmin', idToken: owner, email: 'New.Admin@Gmail.com', role: 'admin' });
  assert.equal(h.db.get('admins/new.admin@gmail.com').role, 'admin');
  const admin = h.addUser('na', 'new.admin@gmail.com');
  h.drive.set('pub1', { id: 'pub1', name: 'old.pdf', mimeType: 'application/pdf', parents: ['root-q'], sha256Checksum: 'b'.repeat(64) });
  assert.throws(() => h.call({ action: 'takedown', idToken: admin, fileId: 'pub1', reason: '' }), /why/);
  h.call({ action: 'takedown', idToken: admin, fileId: 'pub1', reason: 'Copyright request from publisher' });
  assert.deepEqual(h.drive.get('pub1').parents, ['withdrawn']);
  assert.throws(() => h.call({ action: 'takedown', idToken: admin, fileId: 'pub1', reason: 'again please' }), /not part of the public archive/);
  assert.throws(() => h.call({ action: 'takedown', idToken: admin, fileId: 'link-../../users/u1', reason: 'path traversal attempt' }), (e) => e.code === 'bad_request');
  assert.throws(() => h.call({ action: 'setAdmin', idToken: owner, email: 'a/b@gmail.com', role: 'admin' }), /valid email/);
  h.call({ action: 'setAdmin', idToken: owner, email: 'new.admin@gmail.com', role: null });
  assert.equal(h.db.has('admins/new.admin@gmail.com'), false);
});

test('maintenance indexes legacy checksums and removes orphans', () => {
  const h = createHarness();
  const owner = h.addUser('own', 'owner@gmail.com');
  h.addFolder('sub', 'Sub', 'root-misc');
  h.drive.set('legacy', { id: 'legacy', name: 'form.pdf', mimeType: 'application/pdf', parents: ['sub'], size: '10', sha256Checksum: 'c'.repeat(64) });
  h.drive.set('orphan', { id: 'orphan', name: 'x.pdf', mimeType: 'application/pdf', parents: ['pending'], size: '99', createdTime: '2020-01-01T00:00:00Z', appProperties: { submissionId: 'gone' } });
  const fp = h.call({ action: 'maintenance', idToken: owner, task: 'fingerprints' });
  assert.equal(fp.fingerprints, 1);
  assert.equal(h.db.get(`fingerprints/${'c'.repeat(64)}`).source, 'legacy');
  const c = h.call({ action: 'maintenance', idToken: owner, task: 'cleanup' });
  assert.equal(c.orphansDeleted, 1);
  assert.equal(h.drive.has('orphan'), false);
});
