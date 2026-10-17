// End-to-end: the real site, the real Firebase SDK against the Auth + Firestore
// emulators, and the real Apps Script backend code (tests/unit/gas-harness.mjs)
// answering the web-app URL. Only Google Drive itself is simulated.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHarness } from '../unit/gas-harness.mjs';
import { CONFIG } from '../../public/js/config.js';

const PROJECT = 'demo-acce';
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const BACKEND = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';
const SHOTS = process.env.SHOTS || '';
const roots = Object.fromEntries(Object.entries(CONFIG.folders).map(([k, f]) => [k, f.id]));
const h = createHarness({ roots, remote: { firestore: FS, auth: AUTH }, projectId: PROJECT });

/* ---------- simulated Drive content ---------- */
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * 864e5).toISOString();
const put = (id, name, parent, extra = {}) => h.drive.set(id, { id, name, parents: [parent], mimeType: 'application/pdf', size: '524288', createdTime: iso(30), modifiedTime: iso(30), ...extra });
h.addFolder('y1', 'Year 1 Term 1', roots.bsc);
h.addFolder('th', 'ACCE-1101 Thermodynamics', 'y1');
h.addFolder('q23', '2023', roots.qbank);
put('f1', 'Thermodynamics lecture 1-6.pdf', 'th', { size: '3145728', createdTime: iso(2) });
put('f2', 'Heat transfer notes.docx', roots.bsc, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdTime: iso(5) });
put('f3', 'ACCE-3101 Term final 2023.pdf', 'q23', { properties: { acce_type: 'question', acce_course: 'ACCE-3101', acce_year: '2023', acce_title: 'Chemical Reaction Engineering term final' }, createdTime: iso(1) });
put('f4', 'Lab safety form.pdf', roots.misc, { createdTime: iso(9) });
for (let i = 0; i < 6; i++) put(`m${i}`, `MSc seminar ${i + 1}.pptx`, roots.msc, { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', createdTime: iso(40 + i) });

function driveApi(route) {
  const u = new URL(route.request().url());
  const one = /\/drive\/v3\/files\/([^/?]+)/.exec(u.pathname);
  const shape = (f) => ({ ...f, webViewLink: `https://drive.google.com/file/d/${f.id}/view`, webContentLink: `https://drive.google.com/uc?id=${f.id}&export=download` });
  if (one) {
    const f = h.drive.get(decodeURIComponent(one[1]));
    return f ? route.fulfill({ json: shape(f) }) : route.fulfill({ status: 404, json: { error: { message: 'not found' } } });
  }
  const parents = [...(u.searchParams.get('q') || '').matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
  const files = [...h.drive.values()].filter((f) => f.parents?.some((p) => parents.includes(p)))
    .sort((a, b) => (b.mimeType.includes('folder') - a.mimeType.includes('folder')) || a.name.localeCompare(b.name)).map(shape);
  return route.fulfill({ json: { files } });
}

async function wire(page, { backendInCode = true } = {}) {
  page.on('pageerror', (e) => { throw e; });
  await page.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({
    contentType: 'text/javascript', body: fs.readFileSync(path.resolve('node_modules/firebase', path.basename(new URL(r.request().url()).pathname)))
  }));
  await page.route('**/js/config.js', async (r) => {
    const src = fs.readFileSync('public/js/config.js', 'utf8')
      .replace("backendUrl: ''", backendInCode ? `backendUrl: '${BACKEND}'` : "backendUrl: ''")
      .replace('emulators: null', `emulators: { auth: '${AUTH}', firestore: { host: '${new URL(FS).hostname}', port: ${new URL(FS).port} } }`);
    await r.fulfill({ contentType: 'text/javascript', body: src });
  });
  await page.route('https://www.googleapis.com/drive/v3/**', driveApi);
  await page.route('https://drive.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;display:grid;place-items:center;height:100vh;font:16px sans-serif;background:#eee">Drive preview</body>' }));
  await page.route(BACKEND, (r) => {
    const out = h.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.content });
  });
}

async function signIn(page, claims) {
  await page.waitForFunction(() => window.__acceTest);
  await page.evaluate((c) => window.__acceTest.signIn(c), claims);
}
const noStrayNull = async (page) => expect(page.getByText(/^(null|undefined)$/)).toHaveCount(0);
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(450); if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  h.ctx.fsSet_('admins/' + encodeURIComponent('owner@gmail.com'), { email: 'owner@gmail.com', role: 'owner', notify: true });
  h.ctx.fsSet_('courses/ACCE-1101', { code: 'ACCE-1101', title: 'Chemical Engineering Thermodynamics', program: 'bsc', level: '1-1', active: true });
});

async function enterAsStudent(page, name = 'Alice Rahman', session = '2020', sid = '20ACE004') {
  await page.locator('#f-name').fill(name);
  await page.locator('#f-session').selectOption(session);
  await page.locator('#f-id').fill(sid);
  await page.getByRole('button', { name: 'Enter the archive' }).click();
}

test('student enters with name, session and ID (no Google), browses, searches and previews', async ({ page }) => {
  await wire(page);
  await page.goto('/');
  await expect(page.locator('#f-id')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();   // optional, for staff
  await shot(page, '01-gate');

  // the original validation rules
  await page.getByRole('button', { name: 'Enter the archive' }).click();
  await expect(page.locator('.gate-form form .form-error')).toContainText('too short');
  await page.locator('#f-name').fill('Alice Rahman');
  await page.getByRole('button', { name: 'Enter the archive' }).click();
  await expect(page.locator('.gate-form form .form-error')).toContainText('No session selected');
  await page.locator('#f-session').selectOption('2020');
  await page.locator('#f-id').fill('21ace004');
  await page.getByRole('button', { name: 'Enter the archive' }).click();
  await expect(page.locator('.gate-form form .form-error')).toContainText('does not belong to the selected session');
  await page.locator('#f-id').fill('20ACE000');
  await page.getByRole('button', { name: 'Enter the archive' }).click();
  await expect(page.locator('.gate-form form .form-error')).toContainText('serial number');
  await page.locator('#f-id').fill('20ace004');
  await page.getByRole('button', { name: 'Enter the archive' }).click();
  await expect(page.locator('.eyebrow', { hasText: 'Welcome back, Alice' })).toBeVisible();

  // logged once in Firestore visitors/{ID}; returning visits go straight in
  await expect.poll(() => h.ctx.fsGet_('visitors/20ACE004')?.name).toBe('Alice Rahman');
  await page.reload();
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page.locator('#f-id')).toHaveCount(0);
  // signing in stays one click away for students who later want to upload
  await expect(page.locator('.head-signin')).toBeVisible();
  await expect(page.locator('.site-head .crest img')).toBeVisible();

  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page.locator('.stats')).toContainText('files');
  await expect(page.locator('.recent-row').first()).toContainText('ACCE-3101 Term final 2023');
  await expect(page.locator('[data-count="msc"]')).toHaveText('6 files');
  await shot(page, '02-home');

  // browse with deep links and breadcrumbs (existing behaviour)
  await page.locator('.program-box[data-key="bsc"]').click();
  await expect(page.locator('.dir-table')).toContainText('Year 1 Term 1');
  await expect(page.locator('.dir-table tbody tr').first()).toHaveClass(/is-folder/);   // folders first
  await page.getByRole('link', { name: 'Year 1 Term 1' }).click();
  await page.getByRole('link', { name: 'ACCE-1101 Thermodynamics' }).click();
  await expect(page).toHaveURL(/#\/browse\/bsc\/y1\/th$/);
  await expect(page.locator('.crumbs')).toContainText('BSc archive');
  await expect(page.locator('.crumbs b')).toHaveText('ACCE-1101 Thermodynamics');
  await page.reload();
  await expect(page.locator('.crumbs b')).toHaveText('ACCE-1101 Thermodynamics');
  await page.locator('.file-link', { hasText: 'Thermodynamics lecture' }).click();
  await expect(page.locator('dialog.modal-preview')).toBeVisible();
  await expect(page.locator('.pv-side')).toContainText('3.0 MB');
  await noStrayNull(page);
  await shot(page, '03-preview');
  await page.keyboard.press('Escape');
  await page.locator('.layout-btn, [aria-label="Switch layout"]').click();
  await expect(page.locator('.file-grid .tile')).toHaveCount(1);
  await page.keyboard.press('Escape');      // Esc goes up a folder
  await expect(page).toHaveURL(/#\/browse\/bsc\/y1$/);

  // full search with facets
  await page.goto('/#/search?q=acce3101');
  await expect(page.locator('.result').first()).toContainText('Chemical Reaction Engineering term final');
  await page.locator('.search-page .hero-input').fill('seminar');
  await expect(page.locator('.results-head')).toContainText('6');
  await page.locator('.facet-opt', { hasText: 'Slides' }).click();
  await expect(page).toHaveURL(/k=slides/);
  await noStrayNull(page);
  await shot(page, '04-search');

  // quick search palette
  await page.goto('/#/');
  await expect(page.locator('.hero-title')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('/');
  await page.locator('.qs-input').fill('heat');
  await expect(page.locator('.qs-item').first()).toContainText('Heat transfer notes');
  await shot(page, '05-quicksearch');
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog.modal-preview')).toBeVisible();
});

test('student contributes a file; duplicate is refused', async ({ page }) => {
  await wire(page);
  await page.goto('/#/submit');
  await enterAsStudent(page);
  await expect(page.getByRole('heading', { name: 'Sign in to upload' })).toBeVisible();   // uploading needs Google
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  // signing in with Google fills the profile from the student details: no second form
  await signIn(page, { sub: 'alice', email: 'alice@gmail.com', email_verified: true, name: 'Alice R.' });
  await expect(page.getByRole('heading', { name: 'Add to the archive' })).toBeVisible();
  expect(h.ctx.fsQuery_('users', [['email', '==', 'alice@gmail.com']])[0]).toMatchObject({ displayName: 'Alice Rahman', studentId: '20ACE004', affiliation: 'student' });

  const pdf = Buffer.alloc(5 * 1024 * 1024 + 4321, 7);     // two chunks
  await page.locator('input[type=file]').setInputFiles({ name: 'mass_transfer_notes.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.locator('.toast-error')).toContainText('not accepted');
  await expect(page.locator('.q-item')).toHaveCount(1);
  await expect(page.locator('.q-item input')).toHaveValue('mass transfer notes');

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.locator('.form-error')).toContainText('Choose the material type');
  const form = page.locator('.metaform');
  await expect(form.locator('select').nth(0)).toHaveValue('bsc');          // most uploads are coursework
  await form.locator('select').nth(1).selectOption('lecture');
  await form.locator('input[list$="-courses"]').fill('acce 1101');
  await form.locator('input[list$="-courses"]').blur();
  await expect(form.locator('input[placeholder="Course title"]')).toHaveValue('Chemical Engineering Thermodynamics');
  await page.getByText(/More details/).click();
  await page.getByText('My own work').click();
  await page.locator('#s-declare').check();
  await shot(page, '06-submit');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('heading', { name: 'Sent for review' })).toBeVisible({ timeout: 30_000 });
  await shot(page, '07-submitted');

  const pending = [...h.drive.values()].filter((f) => f.parents?.includes('pending'));
  expect(pending).toHaveLength(1);
  expect(Number(pending[0].size)).toBe(pdf.length);

  await page.getByRole('link', { name: 'Track my uploads' }).click();
  await expect(page.locator('.sub-card')).toContainText('mass transfer notes');
  await expect(page.locator('.sub-card .pill')).toContainText('In review');

  // the same bytes again are refused before uploading
  await page.goto('/#/submit');
  await page.locator('input[type=file]').setInputFiles({ name: 'copy.pdf', mimeType: 'application/pdf', buffer: pdf });
  const form2 = page.locator('.metaform');
  await form2.locator('select').nth(1).selectOption('lecture');
  await page.locator('#s-declare').check();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.locator('.q-item.st-error')).toContainText('already waiting for review');
});

test('owner reviews and publishes; contributor sees it published', async ({ page }) => {
  await wire(page);
  await page.goto('/');
  await expect(page.locator('.gate-alt')).toContainText('Faculty, editors');
  await signIn(page, { sub: 'owner', email: 'owner@gmail.com', email_verified: true, name: 'Archive Owner' });
  // staff go straight in (no profile form) and find the dashboard in the top bar
  await expect(page.getByRole('link', { name: /Dashboard/ }).first()).toBeVisible();

  await page.goto('/#/admin');
  await expect(page.locator('.tile-stat').first()).toContainText('1');
  await expect(page.locator('.storage')).toContainText('13.3%');
  await noStrayNull(page);
  await shot(page, '08-dashboard');

  await page.goto('/#/admin/review');
  await expect(page).toHaveURL(/#\/admin\/review\/\w+/);
  await expect(page.locator('.review-card')).toContainText('mass transfer notes');
  await page.locator('.fp-item', { hasText: 'Year 1 Term 1' }).click();
  await expect(page.locator('.fp-crumbs .current')).toHaveText('Year 1 Term 1');
  await expect(page.locator('.review-card input.mono').last()).toHaveValue('ACCE-1101 - mass transfer notes.pdf');
  await noStrayNull(page);
  await shot(page, '09-review');
  await page.getByRole('button', { name: 'Approve & publish' }).click();
  await expect(page.locator('.toast-ok', { hasText: 'Published to BSc archive / Year 1 Term 1' })).toBeVisible();

  const published = [...h.drive.values()].find((f) => f.name === 'ACCE-1101 - mass transfer notes.pdf');
  expect(published.parents).toEqual(['y1']);
  expect(published.properties.acce_course).toBe('ACCE-1101');

  await page.goto('/#/browse/bsc/y1');
  await expect(page.locator('.dir-table')).toContainText('ACCE-1101 - mass transfer notes.pdf');

  await page.goto('/#/admin/settings');
  await expect(page.locator('.admin-panel')).toContainText('Submission settings');
  await page.goto('/#/admin/activity');
  await expect(page.locator('.timeline')).toContainText('approved');
});

test('contributor sees the decision; layout holds on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await wire(page);
  await page.goto('/#/my');
  await signIn(page, { sub: 'alice', email: 'alice@gmail.com', email_verified: true, name: 'Alice Rahman' });
  await expect(page.locator('.sub-card .pill', { hasText: 'Published' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await shot(page, '10-mobile-my');
  await page.goto('/#/');
  await expect(page.locator('.hero-title')).toBeVisible();
  await expect(page.locator('.recent-row').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '11-mobile-home');
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'No dashboard access yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another account' })).toBeVisible();
});

test('permanent owner builds the team, imports the catalogue and browses it virtually', async ({ page }) => {
  await wire(page);
  // the footer's "Staff & editor sign-in" link: signing in lands on the dashboard
  await page.goto('/#/signin?next=/admin');
  await expect(page.locator('.gate-alt')).toContainText('open the dashboard');
  await signIn(page, { sub: 'root', email: 'muhammadshamsularefin01@gmail.com', email_verified: true, name: 'Muhammad Shamsul Arefin' });
  await expect(page).toHaveURL(/#\/admin$/);
  await expect(page.locator('.admin-tabs')).toBeVisible();
  await expect(page.getByRole('link', { name: /Dashboard/ }).first()).toBeVisible();

  // team: permanent owner pinned, owners add admins/reviewers without the upload backend
  await page.goto('/#/admin/people');
  await expect(page.locator('.mini-row', { hasText: 'muhammadshamsularefin01@gmail.com' })).toContainText('Permanent owner');
  await page.getByLabel('Gmail address to add').fill('Helper.Admin@gmail.com');
  await page.getByLabel('Role', { exact: true }).selectOption('admin');
  await page.getByRole('button', { name: 'Add to team' }).click();
  await expect(page.locator('.mini-row', { hasText: 'helper.admin@gmail.com' })).toBeVisible();
  expect(h.ctx.fsGet_('admins/' + encodeURIComponent('helper.admin@gmail.com')).role).toBe('admin');
  await noStrayNull(page);
  await shot(page, '14-team');

  // catalogue: import the Drive folders; the approved submission keeps its curated record
  await page.goto('/#/admin/catalogue');
  await page.getByRole('button', { name: 'Import / sync from Drive' }).click();
  await expect(page.locator('.console')).toContainText('Done.', { timeout: 30_000 });
  await expect(page.locator('.console')).toContainText('10 new records');
  await expect(page.locator('input[type=checkbox]').first()).toBeChecked();
  await shot(page, '15-catalogue');

  // home now opens the virtual library
  await page.goto('/#/');
  await expect(page.locator('.program-box[data-key="bsc"]')).toHaveAttribute('href', '#/library/bsc');
  await expect(page.locator('[data-count="msc"]')).toHaveText('6 items');
  await page.locator('.program-box[data-key="bsc"]').click();
  await expect(page.locator('.lib-group', { hasText: 'Year 1 · Term 1' })).toBeVisible();
  await expect(page.locator('.lib-group', { hasText: 'General' })).toBeVisible();
  await page.locator('.lib-group', { hasText: 'Year 1 · Term 1' }).click();
  await page.locator('.lib-group', { hasText: 'ACCE-1101 · Chemical Engineering Thermodynamics' }).click();
  await expect(page).toHaveURL(/#\/library\/bsc\/1-1\/ACCE-1101$/);
  await expect(page.locator('.result')).toHaveCount(2);     // imported lecture + approved submission
  await noStrayNull(page);
  await shot(page, '16-library');

  // one file, two curricula, no duplicate
  await page.locator('.result', { hasText: 'Thermodynamics lecture 1-6' }).click();
  await expect(page.locator('.pv-side')).toContainText('Google Drive');
  await page.getByRole('button', { name: 'Edit record' }).click();
  await page.locator('dialog .metaform input[list$="-curricula"]').fill('Syllabus 2019, Syllabus 2023');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.locator('.toast-ok', { hasText: 'Record saved' })).toBeVisible();
  await expect(page.locator('.toast-error')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const curSel = page.getByLabel('Curriculum');
  await expect(curSel).toBeVisible();
  await curSel.selectOption('Syllabus 2023');
  await expect(page.locator('.result')).toHaveCount(1);
  await curSel.selectOption('Syllabus 2019');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toContainText('Syllabus 2019');

  // visitors read the published snapshot, not one document per record
  expect(h.ctx.fsGet_('catalogue/0').items.length).toBe(11);
  expect(h.ctx.fsGet_('config/catalog').snapshot.chunks).toBe(1);
  const visitor = await page.context().browser().newContext();
  const vp = await visitor.newPage();
  await wire(vp);
  await vp.goto('/');
  await enterAsStudent(vp, 'Karim Hasan', '2021', '21ACE010');
  await expect(vp.locator('.program-box[data-key="qbank"]')).toHaveAttribute('href', '#/library/qbank');
  await vp.locator('.program-box[data-key="qbank"]').click();
  await expect(vp.locator('.lib-group', { hasText: '2023' })).toBeVisible();
  const cached = await vp.evaluate(() => JSON.parse(localStorage.getItem('acce.catalog.v1')));
  expect(cached.snapVersion).toBeTruthy();
  expect(cached.courses.map((c) => c.id)).toContain('ACCE-1101');
  await visitor.close();

  // search runs on the catalogue; permalinks resolve through it
  await page.goto('/#/search?q=acce3101');
  await expect(page.locator('.result').first()).toContainText('Chemical Reaction Engineering term final');
  await page.goto('/#/file/f3');
  await expect(page).toHaveURL(/#\/library\/qbank\/2023\/ACCE-3101\/final\?item=f3/);
  await expect(page.locator('dialog.modal-preview')).toBeVisible();
});

test('without Firebase students still get in and browse (graceful fallback)', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.route('**/__/firebase/init.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('https://www.googleapis.com/drive/v3/**', driveApi);
  await page.goto('/');
  await enterAsStudent(page, 'Rahim Uddin', '2019', '19ACE021');
  await expect(page.locator('.hero-title')).toBeVisible();
  await page.locator('.program-box[data-key="qbank"]').click();
  await expect(page.locator('.dir-table')).toContainText('2023');
  await page.goto('/#/submit');
  await expect(page.getByRole('heading', { name: 'Sign in to upload' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.locator('.guard .form-error')).toContainText('unavailable');   // explained, not silent
});

test('owner switches uploads on from the dashboard (no code edit); new contributors give their details inline', async ({ page }) => {
  await wire(page, { backendInCode: false });
  h.ctx.fsSet_('config/settings', { ...(h.ctx.fsGet_('config/settings') || {}), backendUrl: '' });
  await page.goto('/#/signin?next=/admin/settings');
  await signIn(page, { sub: 'owner', email: 'owner@gmail.com', email_verified: true, name: 'Archive Owner' });
  await expect(page).toHaveURL(/#\/admin\/settings$/);
  await expect(page.locator('.page-head .pill-warn')).toContainText('Uploads not connected');
  const card = page.locator('.card', { hasText: 'Upload service' });
  await expect(card.locator('.pill')).toContainText('Not connected');
  await card.locator('input[type=url]').fill('https://example.com/not-a-script');
  await card.getByRole('button', { name: 'Test' }).click();
  await expect(card.locator('.form-error')).toContainText('not a web app URL');
  await card.locator('input[type=url]').fill(BACKEND);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast-ok', { hasText: 'Upload service connected' })).toBeVisible();
  await expect(card.locator('.pill')).toContainText('Connected');
  await expect.poll(() => h.ctx.fsGet_('config/settings').backendUrl).toBe(BACKEND);
  await shot(page, '17-upload-service');

  // a fresh page picks the URL up from Firestore; the owner has no profile yet, so it is asked here once
  await page.goto('/#/submit');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tell us who you are' })).toBeVisible();
  await page.locator('#p-name').fill('Archive Owner');
  await page.locator('[data-k="faculty"]').click();
  await page.getByRole('button', { name: 'Continue to upload' }).click();
  await expect(page.getByRole('heading', { name: 'Add to the archive' })).toBeVisible();
  // course and type are guessed from the file name
  await page.locator('input[type=file]').setInputFiles({ name: 'ACCE-1101 lecture slides week 3.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048, 3) });
  await expect(page.locator('.metaform input[list$="-courses"]')).toHaveValue('ACCE-1101');
  await expect(page.locator('.metaform select').nth(1)).toHaveValue('lecture');
  await expect(page.locator('.metaform input[placeholder="Course title"]')).toHaveValue('Chemical Engineering Thermodynamics');
});
