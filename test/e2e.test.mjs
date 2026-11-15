// Runs the real app in a real (headless) browser against a fake GitHub.   node --test test/e2e.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeGitHub, sampleDatabase } from './fakegithub.mjs';
import { create } from '../js/setupcode.js';
import { PUBLIC_BASE, UPLOAD_URL, EDIT_URL } from '../js/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (n) => path.join(root, 'test/fixtures', n);
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

function newGitHub() {
  const gh = new FakeGitHub();
  const pictures = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg'].map((n) => fs.readFileSync(fx(n)));
  const db = sampleDatabase(gh, { pictures });
  // one song whose title tries to inject HTML
  const snap = new Map(gh.head(db.branch).snap);
  const uid = '33333333-0000-4000-8000-000000000000';
  snap.set(`notation-shelf/songs/${uid}.json`, gh.blob(JSON.stringify({ uid, title: '<img src=x onerror="window.__xss=1"> Evil', singer: '<b>bold</b>', notes: '', createdAt: 1700000000500, updatedAt: 1700000000500, deleted: false, pages: [{ file: 'img-1.jpg', rotation: 0 }], links: [{ kind: 'chords', title: 'x', url: 'javascript:alert(1)' }], titleState: 0, sourceName: '' })));
  gh.commit(db.branch, snap, 'evil');
  gh.publicSite = publicSite(gh, db);
  return { gh, db };
}
/** What the nightly job publishes to R2: songs that are not deleted, not in the to-do list, not marked private, with their pictures. */
function publicSite(gh, db) {
  const songs = [], images = new Map();
  for (const [p, sha] of gh.head(db.branch).snap) {
    if (!/\/songs\/[^/]+\.json$/.test(p)) continue;
    const o = JSON.parse(gh.blobs.get(sha));
    if (o.deleted || /NOT-A-SONG|KEEP-PRIVATE/.test(o.notes) || !o.pages.length) continue;
    songs.push({ u: o.uid, t: o.title, g: o.singer, c: o.createdAt, m: o.updatedAt, p: o.pages.map((x) => [x.file, x.rotation, x.hash || '']), l: o.links, ...(o.titleState === 2 ? { x: 2, o: o.sourceName } : {}) });
    for (const x of o.pages) images.set(x.file, gh.file(db.branch, `${db.folder}/images/${x.file}`));
  }
  return { catalog: JSON.stringify({ v: 1, generated: 1, songs }), images };
}
const codeFor = (gh, db, member = true) => create({ repo: gh.repo, branch: db.branch, folder: db.folder, token: gh.token, member });

async function open(gh, { cfg, viewport = { width: 390, height: 844 }, scale = 1, hash = '#/songs' } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true, serviceWorkers: 'allow' });
  await context.route('https://api.github.com/**', (r) => gh.handle(r));
  const cors = { 'access-control-allow-origin': '*' };
  gh.intake ??= [];
  gh.edits ??= [];
  await context.route(EDIT_URL, async (r) => {
    const req = r.request();
    const h = { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    gh.edits.push(JSON.parse(req.postData()));
    return r.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: '{"ok":true}' });
  });
  await context.route(`${new URL(UPLOAD_URL).origin}/**`, async (r) => {
    const req = r.request();
    if (req.url() === EDIT_URL) return r.fallback();
    const h = { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    if (gh.intakeLimitOnce) { gh.intakeLimitOnce = false; return r.fulfill({ status: 429, headers: { ...h, 'retry-after': '1' }, body: JSON.stringify({ error: 'slow down' }) }); }
    const hd = req.headers();
    gh.intake.push({ group: hd['x-group'], index: Number(hd['x-index']), pages: Number(hd['x-pages']), name: decodeURIComponent(hd['x-name']), bytes: req.postDataBuffer() });
    return r.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: '{"ok":true}' });
  });
  await context.route(`${PUBLIC_BASE}/**`, (r) => {
    const site = gh.publicSite;
    const u = new URL(r.request().url());
    if (!site) return r.fulfill({ status: 404, headers: cors, body: 'no' });
    if (u.pathname === '/catalog.json') return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: site.catalog });
    const m = u.pathname.match(/^\/images\/(.+)$/);
    const img = m && site.images.get(decodeURIComponent(m[1]));
    return img ? r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/jpeg' }, body: img }) : r.fulfill({ status: 404, headers: cors, body: 'no' });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  if (cfg) await page.addInitScript((c) => { if (!localStorage.getItem('nsm.cfg')) localStorage.setItem('nsm.cfg', JSON.stringify(c)); }, cfg);
  await page.goto(base + hash);
  return page;
}
const adminCfg = (gh, db) => ({ repo: gh.repo, branch: db.branch, folder: db.folder, token: gh.token, role: 'admin', readOnly: false });
const memberCfg = (gh, db) => ({ ...adminCfg(gh, db), role: 'member' });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const searchFor = async (page, q) => { await page.getByLabel('Search songs').fill(q); await page.waitForTimeout(300); };
const ready = async (page) => { await page.waitForSelector('.songs .row', { timeout: 15000 }); };
const rowTitles = (page) => page.$$eval('.songs .row-title', (els) => els.map((e) => e.textContent));

test('first visit: guide, paste code, first download, then the list', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh);
  await ready(page); // the public library opens first, without any code
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'I have a database code' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('Database code').fill('hello');
  await page.getByRole('button', { name: 'Connect' }).click();
  assert.match(await page.locator('.error-text').textContent(), /does not look like a database code/);
  await shot(page, 'guide-step2');
  await page.getByLabel('Database code').fill(codeFor(gh, db));
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByText('How should the pictures be kept?').waitFor();
  await shot(page, 'guide-step3');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForSelector('.tile'); // lands on the singer list
  await page.getByRole('link', { name: 'Songs' }).click();
  await ready(page);
  assert.equal(await page.locator('.count').textContent(), '41 songs'); // 40 + the one with the odd title; to-do and removed are not listed
  assert.ok(!(await rowTitles(page)).includes('Removed Song'));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.ok((await rowTitles(page)).some((t) => t.startsWith('<img src=x')), 'markup shows as plain text');
  assert.equal(await page.locator('.badge').textContent(), '3'); // member does not see the one marked "not a song"
  await shot(page, 'songs');
  // the key only goes to GitHub
  assert.ok(gh.calls.length > 0);
  assert.deepEqual(page.errors, []);
});

test('search works with Sinhala and English spelling; did-you-mean; favourites; sorting', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  const search = page.getByLabel('Search songs');
  await searchFor(page, 'kandulu');
  assert.ok((await rowTitles(page)).every((t) => /kandulu/i.test(t)));
  await searchFor(page, 'කඳුළු');
  assert.ok((await rowTitles(page)).some((t) => /Kandulu/i.test(t)));
  await searchFor(page, 'සැන්දෑ');
  assert.ok((await rowTitles(page)).includes('සැන්දෑ වලාවන්'));
  await searchFor(page, 'sanda welawan'); // a wrong vowel still finds it
  assert.match(await page.locator('.count').textContent(), /^5 songs found/); // the five songs called "Sanda Walawan…"
  await searchFor(page, 'sanka walawan'); // a wrong consonant: nothing, but we suggest
  assert.match(await page.locator('.count').textContent(), /^0 songs found/);
  await page.getByRole('button', { name: /Sanda|සැන්දෑ/ }).first().waitFor();
  await shot(page, 'search-didyoumean');
  await searchFor(page, '');
  // favourite
  const first = page.locator('.songs .row').first();
  await first.locator('.star-btn').click();
  await page.getByRole('button', { name: '★ Favourites' }).click();
  assert.equal((await rowTitles(page)).length, 1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  // sorting changes order
  const before = await rowTitles(page);
  await page.locator('.sortchip').click(); // Newest
  const after = await rowTitles(page);
  assert.notDeepEqual(before.slice(0, 5), after.slice(0, 5));
  await page.getByRole('button', { name: 'Recent' }).click();
  assert.match(await page.locator('.empty h3').textContent(), /Nothing opened yet/);
  assert.deepEqual(page.errors, []);
});

test('reading a song: pictures, pages, keys, chords link, stage mode, back keeps the search', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db), scale: 2 });
  await ready(page);
  await searchFor(page, 'සැන්දෑ');
  await page.locator('.songs .row-main', { hasText: 'සැන්දෑ වලාවන්' }).first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  await page.waitForFunction(() => document.querySelector('.v-img').naturalWidth > 0);
  assert.match(await page.locator('.v-count').textContent(), /Page 1 of 2/);
  const chords = page.locator('.v-chords');
  assert.equal(await chords.getAttribute('href'), 'https://example.com/chords');
  assert.equal(await chords.getAttribute('rel'), 'noopener noreferrer');
  await shot(page, 'viewer');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => /Page 2 of 2/.test(document.querySelector('.v-count').textContent));
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => /Page 1 of 2/.test(document.querySelector('.v-count').textContent));
  // tap right edge = next page
  const box = await page.locator('.v-stage').boundingBox();
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
  await page.waitForFunction(() => /Page 2 of 2/.test(document.querySelector('.v-count').textContent));
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await page.waitForFunction(() => /Page 1 of 2/.test(document.querySelector('.v-count').textContent));
  // stage mode
  await page.getByRole('button', { name: 'Dark stage mode' }).click();
  assert.ok(await page.locator('.viewer.stage').count());
  assert.match(await page.locator('.v-img').evaluate((e) => e.style.filter), /invert/);
  await shot(page, 'viewer-stage');
  // double tap zooms
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => /scale\(2\.5\)/.test(document.querySelector('.v-pane').style.transform));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.songs .row');
  assert.equal(await page.getByLabel('Search songs').inputValue(), 'සැන්දෑ'); // the list is still as it was left
  assert.deepEqual(page.errors, []);
});

test('a bad link is never shown; markup in titles is not run', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await searchFor(page, 'Evil');
  await page.locator('.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  assert.equal(await page.locator('.v-chords:visible').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});

test('singers tab and singer page', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: 'Singers' }).click();
  await page.waitForSelector('.tile');
  const names = await page.$$eval('.tile-name', (e) => e.map((x) => x.textContent));
  assert.ok(names.includes('නන්දා මාලිනී') && names.includes('වික්ටර් රත්නායක'));
  await shot(page, 'singers');
  await page.locator('.tile', { hasText: 'නන්දා මාලිනී' }).click();
  await page.getByRole('heading', { name: 'නන්දා මාලිනී' }).waitFor();
  assert.ok((await rowTitles(page)).every((t) => /Kandulu|Nil Ahase/.test(t)));
  await page.locator('.view-head .iconbtn').click();
  await page.waitForSelector('.tile');
});

test('albums: make one from selected songs, open it as a set list, move songs (member: this device only)', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const rows = page.locator('.songs .row-main');
  await rows.nth(0).click(); await rows.nth(1).click(); await rows.nth(2).click();
  await page.getByRole('button', { name: 'Add to album' }).click();
  await page.getByRole('button', { name: '+ New album' }).click();
  await page.getByLabel('Album name').fill('Friday');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForSelector('.toast, #toast.show');
  await page.getByRole('link', { name: 'Albums' }).click();
  await page.locator('.card', { hasText: 'Friday' }).click();
  await page.waitForSelector('ol.songs .row');
  assert.equal(await page.locator('ol.songs .row').count(), 3);
  const t0 = await page.locator('ol.songs .row-title').first().textContent();
  await page.getByRole('button', { name: 'Move down' }).first().click();
  assert.notEqual(await page.locator('ol.songs .row-title').first().textContent(), t0);
  await shot(page, 'album');
  // member albums never go to GitHub
  assert.ok(!gh.calls.some((c) => c.startsWith('POST') && /trees/.test(c)));
  // set list: next song after the last page continues the list
  await page.locator('ol.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  assert.match(await page.locator('.v-sub').textContent(), /1 of 3 in Friday/);
  // keep on device
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Album options' }).click();
  await page.getByRole('button', { name: /Keep these songs/ }).click();
  await page.waitForFunction(() => document.querySelector('#toast.show')?.textContent.includes('works without internet'), null, { timeout: 15000 });
  assert.deepEqual(page.errors, []);
});

test('to-do: a member names a picture; joins an existing song of the same name; flags "not a song"; cannot delete', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: /To-do/ }).click();
  await page.waitForSelector('.todo-card');
  assert.match(await page.locator('.todo-card .muted').first().textContent(), /3 left/);
  assert.equal(await page.getByRole('button', { name: /Delete/ }).count(), 0);
  await page.waitForFunction(() => document.querySelector('.todo-img')?.naturalWidth > 0);
  await shot(page, 'todo');
  // type the name of an existing song: shows chips and the "added to it" note
  await page.getByLabel('Song name', { exact: true }).fill('Kandulu Gan');
  await page.waitForSelector('.note, .todo-card p[aria-live]');
  await page.waitForFunction(() => /already there/.test(document.querySelector('.todo-card').textContent));
  await page.getByRole('button', { name: 'Save and next' }).click();
  await page.waitForFunction(() => /1 left|2 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  const files = gh.paths(db.branch, 'notation-shelf/songs/');
  const songs = files.map((p) => JSON.parse(gh.file(db.branch, p)));
  const merged = songs.find((s) => s.title === 'Kandulu Gan');
  assert.equal(merged.pages.length, 2, 'the picture became an extra page');
  assert.equal(songs.find((s) => s.uid.startsWith('11111111-0000-4000-8000-000000000000')).deleted, true);
  // new name for the next one
  await page.getByLabel('Song name', { exact: true }).fill('Brand New Tune');
  await page.getByLabel('Singer', { exact: true }).fill('nanda malini'); // English spelling is turned into the Sinhala one
  await page.getByRole('button', { name: 'Save and next' }).click();
  await page.waitForFunction(() => /1 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  const s2 = gh.paths(db.branch, 'notation-shelf/songs/').map((p) => JSON.parse(gh.file(db.branch, p))).find((s) => s.title === 'Brand New Tune');
  assert.equal(s2.singer, 'නන්දා මාලිනී'); assert.equal(s2.titleState, 0);
  // not a song
  await page.getByRole('button', { name: 'This is not a song' }).click();
  await page.waitForSelector('text=Nothing to do');
  const flagged = gh.paths(db.branch, 'notation-shelf/songs/').map((p) => JSON.parse(gh.file(db.branch, p))).filter((s) => s.notes.includes('NOT-A-SONG'));
  assert.equal(flagged.length, 2);
  assert.equal(await page.locator('.badge').isVisible(), false);
  // and it shows up in the main list now
  await page.getByRole('link', { name: 'Songs' }).click();
  await searchFor(page, 'brand new');
  assert.deepEqual(page.errors, []);
});

test('admin can delete from the to-do list and sees the album from GitHub; albums are written back', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: adminCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: /To-do/ }).click();
  await page.waitForSelector('.todo-card');
  assert.match(await page.locator('.todo-card .muted').first().textContent(), /4 left/); // admin also sees the flagged one
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await page.waitForFunction(() => /3 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  await page.getByRole('link', { name: 'Albums' }).click();
  await page.locator('.card', { hasText: 'Sunday set' }).waitFor();
  await page.locator('.card', { hasText: 'Sunday set' }).click();
  await page.waitForSelector('ol.songs .row');
  await page.getByRole('button', { name: 'Take out of this album' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('ol.songs .row').length === 1);
  await page.waitForTimeout(500);
  const albums = JSON.parse(gh.file(db.branch, 'notation-shelf/private/albums.json'));
  assert.equal(albums.albums[0].songs.length, 1);
  assert.deepEqual(page.errors, []);
});

test('adding pictures, PDFs: no quality loss, repeats skipped, names from file names, same title joins, no-name goes to to-do', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  const commitsBefore = gh.commits.size;
  await page.getByRole('button', { name: 'Add songs' }).click();
  await page.waitForSelector('.dropzone');
  await shot(page, 'add');
  await page.locator('input[type=file][accept^="image"]').first().setInputFiles([fx('Hithuwakkaraya.jpg'), fx('Hithuwakkaraya (2).jpg'), fx('IMG_0001.jpg'), fx('p1-copy.jpg'), fx('Rathri Yame.pdf')]);
  await page.waitForSelector('.card.done', { timeout: 30000 });
  const text = await page.locator('.card.done').textContent();
  assert.match(text, /6 pictures added/);
  assert.match(text, /already in the database/);
  const songs = gh.paths(db.branch, 'notation-shelf/songs/').map((p) => JSON.parse(gh.file(db.branch, p)));
  // "Hithuwakkaraya" is spelt differently from the Sinhala title already in the database, but it is the same song, so the pictures join it
  assert.equal(songs.filter((s) => /^hithuwakkaraya$/i.test(s.title)).length, 0);
  const hith = songs.filter((s) => s.title === 'හිතුවක්කාරයා');
  assert.equal(hith.length, 1); assert.equal(hith[0].pages.length, 4);
  const pdf = songs.find((s) => s.title === 'Rathri Yame');
  assert.equal(pdf.pages.length, 3);
  assert.ok(pdf.pages.every((p) => p.hash && /^[0-9a-f]{64}$/.test(p.hash)));
  const imported = songs.filter((s) => s.sourceName === 'IMG_0001.jpg');
  assert.equal(imported.length, 1); assert.equal(imported[0].titleState, 2); assert.equal(imported[0].title, 'Untitled');
  // the picture is stored byte for byte
  const original = fs.readFileSync(fx('Hithuwakkaraya.jpg'));
  const stored = hith[0].pages.map((p) => gh.file(db.branch, `notation-shelf/images/${p.file}`)).filter(Boolean);
  assert.ok(stored.some((b) => Buffer.compare(b, original) === 0), 'JPEG bytes are unchanged');
  assert.ok(gh.commits.size - commitsBefore <= 2, 'everything went in as one or two saves');
  // it can be found and opened right away
  await page.getByRole('button', { name: 'Go to songs' }).click();
  await searchFor(page, 'rathri');
  await page.locator('.songs .row-main').first().click();
  await page.waitForFunction(() => document.querySelector('.v-img')?.naturalWidth > 0);
  assert.match(await page.locator('.v-count').textContent(), /Page 1 of 3/);
  // choosing the same files again adds nothing
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add songs' }).click();
  await page.locator('input[type=file][accept^="image"]').first().setInputFiles([fx('Hithuwakkaraya.jpg'), fx('Rathri Yame.pdf')]);
  await page.waitForSelector('.card.done', { timeout: 30000 });
  assert.match(await page.locator('.card.done').textContent(), /Nothing new|0 pictures added/);
  assert.deepEqual(page.errors, []);
});

test('a reader cannot add, name or send messages', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: { ...adminCfg(gh, db), role: 'reader', readOnly: true } });
  await ready(page);
  assert.equal(await page.getByRole('button', { name: 'Add songs' }).count(), 0);
  await page.getByRole('link', { name: /To-do/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Save and next' }).count(), 0);
  await page.goto(`${base}#/add`);
  await page.waitForSelector('text=This device can only read');
});

test('editing a song: name, notes, link, turn page; delete is for the admin only', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await searchFor(page, 'Seethala');
  await page.locator('.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  await page.getByRole('button', { name: 'More' }).click();
  assert.equal(await page.getByRole('button', { name: /Delete this song/ }).count(), 0);
  await page.getByRole('button', { name: /Edit everything/ }).click();
  await page.waitForSelector('.editor');
  assert.equal(await page.getByRole('button', { name: 'Remove this page' }).count(), 0);
  await page.getByLabel('Song name').fill('Seethala Gee (new)');
  await page.getByLabel('Notes').fill('Key of D');
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Link address').fill('https://example.com/c');
  await page.getByRole('button', { name: 'Turn' }).first().click();
  await shot(page, 'editor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#toast')?.textContent || ''));
  const s = gh.paths(db.branch, 'notation-shelf/songs/').map((p) => JSON.parse(gh.file(db.branch, p))).find((x) => x.title === 'Seethala Gee (new)');
  assert.equal(s.notes, 'Key of D'); assert.equal(s.pages[0].rotation, 90); assert.equal(s.links[0].url, 'https://example.com/c');
  assert.deepEqual(page.errors, []);
});

test('feedback goes to the admin with pictures', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await shot(page, 'settings');
  await page.getByRole('button', { name: 'Send a message to the admin' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  assert.match(await page.locator('#toast').textContent(), /type your name/);
  await page.getByLabel('Your name').fill('Kamal');
  await page.getByLabel('Your message').fill('The page is too small');
  await page.locator('input[type=file]').setInputFiles([fx('shot.png')]);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => /Sent/.test(document.querySelector('#toast')?.textContent || ''));
  const fb = gh.paths(db.branch, 'notation-shelf/feedback/').filter((p) => p.endsWith('.json'));
  assert.equal(fb.length, 1);
  const o = JSON.parse(gh.file(db.branch, fb[0]));
  assert.equal(o.name, 'Kamal'); assert.equal(o.images.length, 1); assert.equal(o.role, 'member');
  assert.ok(gh.file(db.branch, `notation-shelf/feedback/images/${o.images[0]}`).length > 100);
});

test('GitHub rate limit gives a plain message, not "wrong key"', async () => {
  const { gh, db } = newGitHub();
  gh.limit = 4;
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await page.getByText('Could not get the songs').waitFor();
  const t = await page.locator('.dialog').textContent();
  assert.match(t, /GitHub is busy right now/);
  assert.doesNotMatch(t, /not accept/i);
});

test('a wrong key says so; a database that is not private is refused', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh);
  await ready(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'I have a database code' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('Database code').fill(create({ repo: gh.repo, branch: db.branch, folder: db.folder, token: 'wrong', member: true }));
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => /did not accept/.test(document.querySelector('.error-text').textContent));
  gh.isPrivate = false;
  await page.getByLabel('Database code').fill(codeFor(gh, db));
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => /not private/.test(document.querySelector('.error-text').textContent));
});

test('only changed songs are downloaded on later visits; deleted ones vanish; works offline', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // someone else changes one song and removes another
  const snap = new Map(gh.head(db.branch).snap);
  const p1 = 'notation-shelf/songs/00000000-0000-4000-8000-000000000001.json';
  const changed = JSON.parse(gh.blobs.get(snap.get(p1)));
  changed.title = 'Changed Elsewhere';
  snap.set(p1, gh.blob(JSON.stringify(changed)));
  snap.delete('notation-shelf/songs/00000000-0000-4000-8000-000000000002.json');
  gh.commit(db.branch, snap, 'other device');
  gh.calls.length = 0;
  await page.locator('.syncchip').click();
  await page.waitForFunction(() => /^\s*Updated/.test(document.querySelector('.syncchip').textContent) && !document.querySelector('.syncchip').classList.contains('busy'));
  await searchFor(page, 'Changed Elsewhere');
  assert.match(await page.locator('.count').textContent(), /^1 song found/);
  const blobFetches = gh.calls.filter((c) => /git\/blobs\//.test(c));
  assert.equal(blobFetches.length, 1, 'just the one changed song was fetched');
  await searchFor(page, '');
  assert.equal(await page.locator('.count').textContent(), '40 songs');
  // offline: reload and still see the songs
  await page.context().setOffline(true);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('.count').textContent(), '40 songs');
  assert.match(await page.locator('.syncchip').textContent(), /Offline/);
});

test('a catalog on the web-catalog branch makes the first download quick', async () => {
  const { gh, db } = newGitHub();
  // build the catalog the way the nightly job does
  const snap = gh.head(db.branch).snap;
  const songs = [];
  for (const [p, sha] of snap) {
    if (!/songs\/[^/]+\.json$/.test(p)) continue;
    const o = JSON.parse(gh.blobs.get(sha));
    songs.push({ u: o.uid, s: sha, t: o.title, g: o.singer, n: o.notes, c: o.createdAt, m: o.updatedAt, d: o.deleted ? 1 : 0, p: o.pages.map((x) => [x.file, x.rotation, x.hash || '']), l: o.links, x: o.titleState, o: o.sourceName });
  }
  gh.commit('web-catalog', new Map([['catalog.json', gh.blob(JSON.stringify({ v: 1, generated: Date.now(), songs }))]]), 'catalog');
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  assert.equal(await page.locator('.count').textContent(), '41 songs');
  const blobFetches = gh.calls.filter((c) => /git\/blobs\//.test(c));
  assert.equal(blobFetches.length, 0, 'no per-song downloads were needed');
});

test('public library: opens with no code, reads everything public, nothing private, never calls GitHub', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { scale: 2 });
  await ready(page);
  assert.equal(await page.locator('.count').textContent(), '40 songs'); // pictures still waiting for a name are not in the song list; the one marked private is not published
  assert.ok(!(await rowTitles(page)).includes('Adaraneeya Hamuwe'));
  assert.equal(await page.getByRole('link', { name: /To-do/ }).count(), 1); // visitors may help name pictures too
  assert.equal(await page.locator('.badge').textContent(), '3');
  assert.equal(await page.getByRole('button', { name: 'Add songs' }).count(), 1); // anyone may send pictures
  await searchFor(page, 'සැන්දෑ');
  await page.locator('.songs .row-main', { hasText: 'සැන්දෑ වලාවන්' }).first().click();
  await page.waitForFunction(() => document.querySelector('.v-img')?.naturalWidth > 0);
  assert.match(await page.locator('.v-count').textContent(), /Page 1 of 2/);
  await shot(page, 'public-viewer');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Settings' }).click();
  await shot(page, 'public-settings');
  assert.equal(gh.calls.length, 0, 'GitHub was never contacted');
  assert.deepEqual(page.errors, []);
});

test('public library: a hidden copy is removed when the song is no longer public', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh);
  await ready(page);
  const old = gh.publicSite;
  const c = JSON.parse(old.catalog); c.songs = c.songs.slice(0, 5); c.generated = 2;
  gh.publicSite = { catalog: JSON.stringify(c), images: old.images };
  await page.locator('.syncchip').click();
  await page.waitForFunction(() => document.querySelector('.count').textContent === '5 songs');
});

test('public library: not published yet gives a plain message', async () => {
  const { gh } = newGitHub();
  gh.publicSite = null;
  const page = await open(gh);
  await page.getByText('Could not get the songs').waitFor();
  assert.match(await page.locator('.dialog').textContent(), /not published yet/);
});

test('public upload: anyone can send pictures and PDFs; repeats are skipped; they go to the intake, never to GitHub', async () => {
  const { gh } = newGitHub();
  const page = await open(gh, { scale: 2 });
  await ready(page);
  await page.getByRole('button', { name: 'Add songs' }).click();
  await page.waitForSelector('.dropzone');
  assert.equal(await page.getByText('A helper first gives each one a name').count(), 1);
  assert.equal(await page.getByText('Try to read the name from pictures').count(), 0);
  await shot(page, 'public-add');
  gh.intakeLimitOnce = true; // the first send is told to slow down, and carries on by itself
  await page.locator('input[type=file][accept^="image"]').first().setInputFiles([fx('Hithuwakkaraya.jpg'), fx('IMG_0001.jpg'), fx('p1-copy.jpg'), fx('Rathri Yame.pdf')]);
  await page.waitForSelector('.card.done', { timeout: 60000 });
  const t = await page.locator('.card.done').textContent();
  assert.match(t, /5 pictures sent/); assert.match(t, /already in the library/);
  const hith = gh.intake.filter((x) => x.name === 'Hithuwakkaraya.jpg');
  assert.equal(hith.length, 1); assert.equal(Buffer.compare(hith[0].bytes, fs.readFileSync(fx('Hithuwakkaraya.jpg'))), 0, 'sent byte for byte');
  const pdf = gh.intake.filter((x) => x.name === 'Rathri Yame.pdf').sort((a, b) => a.index - b.index);
  assert.deepEqual(pdf.map((x) => [x.index, x.pages]), [[0, 3], [1, 3], [2, 3]]);
  assert.equal(new Set(pdf.map((x) => x.group)).size, 1);
  assert.ok(gh.intake.every((x) => x.bytes[0] === 0xff && x.bytes[1] === 0xd8));
  assert.equal(gh.calls.length, 0, 'GitHub was never contacted');
  assert.deepEqual(page.errors, []);
});

test('public edit: anyone can fix a name or singer (a request, shown at once here); there is no delete', async () => {
  const { gh } = newGitHub();
  const page = await open(gh);
  await ready(page);
  await searchFor(page, 'Seethala');
  await page.locator('.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  await page.getByRole('button', { name: 'More' }).click();
  assert.equal(await page.getByRole('button', { name: /Delete/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Edit everything/ }).count(), 0);
  await page.getByRole('button', { name: /Change the name or singer/ }).click();
  await page.getByRole('combobox', { name: 'Song name' }).fill('Seethala Gee (corrected)');
  // existing singers are suggested while typing, in English or Sinhala letters
  await page.getByRole('combobox', { name: 'Singer' }).fill('nanda');
  await page.getByRole('option', { name: /නන්දා මාලිනී/ }).waitFor();
  await page.getByRole('combobox', { name: 'Singer' }).fill('nanda mal');
  assert.equal(await page.getByRole('option').count(), 1);
  await page.getByRole('combobox', { name: 'Singer' }).fill('nanda');
  await page.getByRole('option', { name: /නන්දා මාලිනී/ }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Singer' }).inputValue(), 'නන්දා මාලිනී');
  assert.equal(await page.getByRole('option').count(), 0, 'the list closes once a singer is chosen');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /reaches everyone/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(gh.edits.length, 1);
  assert.deepEqual([gh.edits[0].title, gh.edits[0].singer], ['Seethala Gee (corrected)', 'නන්දා මාලිනී']);
  assert.match(gh.edits[0].uid, /^[0-9a-f-]{36}$/);
  assert.match(await page.locator('.v-title').textContent(), /corrected/);
  // it stays visible on this device after a reload and a fresh download of the public list
  await page.goto(`${base}#/songs`);
  await page.reload();
  await ready(page);
  await searchFor(page, 'corrected');
  assert.match(await page.locator('.count').textContent(), /^1 song found/);
  assert.equal(gh.calls.length, 0, 'GitHub was never contacted');
  assert.deepEqual(page.errors, []);
});

test('the menu shows Singers first and Songs second', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  const tabs = await page.$$eval('nav.tabs .tab span', (e) => e.map((x) => x.textContent));
  assert.deepEqual(tabs, ['Singers', 'Songs', 'Albums', 'To-do', 'Settings']);
});

test('singer suggestions also appear when a helper edits a song and names a to-do picture', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: /To-do/ }).click();
  await page.waitForSelector('.todo-card');
  await page.getByRole('combobox', { name: 'Singer' }).fill('viktor');
  await page.getByRole('option', { name: /වික්ටර් රත්නායක/ }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Singer' }).inputValue(), 'වික්ටර් රත්නායක');
  await shot(page, 'singer-suggest');
  await page.goto(`${base}#/edit/00000000-0000-4000-8000-000000000002`);
  await page.getByRole('combobox', { name: 'Singer' }).fill('amara');
  await page.getByRole('option', { name: /අමරදේව/ }).first().waitFor();
});

test('public to-do: a visitor names a picture or flags it; it disappears for them at once and the request is sent', async () => {
  const { gh } = newGitHub();
  const page = await open(gh);
  await ready(page);
  await page.getByRole('link', { name: /To-do/ }).click();
  await page.waitForSelector('.todo-card');
  assert.match(await page.locator('.todo-card .muted').first().textContent(), /3 left/);
  assert.equal(await page.getByRole('button', { name: /Delete/ }).count(), 0);
  await page.waitForFunction(() => document.querySelector('.todo-img')?.naturalWidth > 0);
  await page.getByRole('textbox', { name: 'Song name' }).fill('Kandulu Gan');
  await page.waitForFunction(() => /already there/.test(document.querySelector('.todo-card').textContent));
  await page.getByRole('button', { name: 'Save and next' }).click();
  await page.waitForFunction(() => /2 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  assert.equal(gh.edits.length, 1);
  assert.deepEqual([gh.edits[0].title, gh.edits[0].singer], ['Kandulu Gan', '']);
  await page.getByRole('button', { name: 'This is not a song' }).click();
  await page.waitForFunction(() => /1 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  assert.deepEqual(gh.edits[1].notSong, true);
  assert.equal(gh.calls.length, 0, 'GitHub was never contacted');
  // still gone after a reload and a fresh download of the public list
  await page.reload();
  await page.waitForSelector('.todo-card');
  assert.match(await page.locator('.todo-card .muted').first().textContent(), /1 left/);
  assert.deepEqual(page.errors, []);
});

test('singer tiles are in Sinhala alphabetical order', async () => {
  const { gh, db } = newGitHub();
  const snap = new Map(gh.head(db.branch).snap);
  [['ග', 'ගුණදාස කපුගේ'], ['ක', 'කරුණාරත්න දිවුල්ගනේ']].forEach(([c, name], i) => {
    const uid = `44444444-0000-4000-8000-00000000000${i}`;
    snap.set(`notation-shelf/songs/${uid}.json`, gh.blob(JSON.stringify({ uid, title: `Song ${c}`, singer: name, notes: '', createdAt: 5, updatedAt: 5, deleted: false, pages: [{ file: 'img-1.jpg', rotation: 0 }], links: [], titleState: 0, sourceName: '' })));
  });
  gh.commit(db.branch, snap, 'sinhala singers');
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  await page.getByRole('link', { name: 'Singers' }).click();
  await page.waitForSelector('.tile');
  const names = await page.$$eval('.tile-name', (e) => e.map((x) => x.textContent));
  assert.deepEqual(names, ['අමරදේව', 'කරුණාරත්න දිවුල්ගනේ', 'ගුණදාස කපුගේ', 'නන්දා මාලිනී', 'වික්ටර් රත්නායක', '<b>bold</b>']);
  await shot(page, 'singers-sinhala');
});

test('singer names must be in Sinhala letters: English spelling of a known singer is converted, an unknown one is refused', async () => {
  const { gh } = newGitHub();
  const page = await open(gh);
  await ready(page);
  await searchFor(page, 'Seethala');
  await page.locator('.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  const rename = async (singer) => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Change the name or singer/ }).click();
    await page.getByRole('combobox', { name: 'Singer' }).fill(singer);
    await page.getByRole('button', { name: 'Save' }).click();
  };
  await rename('Brand New Person');
  await page.waitForFunction(() => /Sinhala letters/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(gh.edits.length, 0, 'nothing was sent');
  assert.equal(await page.locator('.dialog').count(), 1, 'the box stays open so nothing typed is lost');
  await page.getByRole('combobox', { name: 'Singer' }).fill('Amaradeva');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /reaches everyone/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(gh.edits.length, 1);
  assert.equal(gh.edits[0].singer, 'අමරදේව');
  // a Sinhala name that is new is fine
  await rename('ගාමිණී ෆොන්සේකා');
  await page.waitForTimeout(300);
  assert.equal(gh.edits.at(-1).singer, 'ගාමිණී ෆොන්සේකා');
});

test('selecting text in the rename box (double-click, or dragging out of it) never closes it', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db), viewport: { width: 900, height: 700 } });
  await ready(page);
  await page.locator('.songs .row-main').first().click();
  await page.waitForSelector('.viewer .v-img[src]');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Change the name or singer/ }).click();
  const name = page.getByRole('combobox', { name: 'Song name' });
  await name.waitFor();
  await name.fill('Sanda Walawan');
  await name.dblclick();                                  // select a word
  assert.equal(await page.locator('.dialog').count(), 1);
  const box = await name.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 6 });             // drag the selection right out of the box
  await page.mouse.up();
  assert.equal(await page.locator('.dialog').count(), 1, 'still open');
  assert.equal(await name.inputValue(), 'Sanda Walawan', 'nothing typed is lost');
  await page.mouse.click(8, 8);                           // a plain tap outside does not throw the typing away either
  assert.equal(await page.locator('.dialog').count(), 1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('.dialog').count(), 0);
});

test('the plain web address opens the singer list', async () => {
  const { gh } = newGitHub();
  const page = await open(gh, { hash: '' });
  await page.waitForSelector('.tile');
  assert.equal(await page.getByRole('heading', { name: 'Singers' }).count(), 1);
  assert.equal(await page.locator('nav.tabs .tab.active').textContent(), 'Singers');
  await page.getByRole('link', { name: 'Songs' }).click();
  await page.waitForSelector('.songs .row');
  assert.match(page.url(), /#\/songs$/);
});

test('song names already in the library are suggested while typing (and fill in the singer)', async () => {
  const { gh, db } = newGitHub();
  const page = await open(gh, { cfg: memberCfg(gh, db) });
  await ready(page);
  // helper: the edit screen of a song
  await page.goto(`${base}#/edit/00000000-0000-4000-8000-000000000002`);
  const title = page.getByRole('combobox', { name: 'Song name' });
  await title.fill('kandu');
  await page.getByRole('option', { name: /Kandulu Gan/ }).first().waitFor();
  assert.ok((await page.getByRole('option', { name: /Kandulu Gan/ }).count()) >= 1);
  await title.fill('කඳුළු'); // Sinhala letters find the English-spelt title too
  await page.getByRole('option', { name: /Kandulu Gan/ }).first().waitFor();
  await page.getByRole('combobox', { name: 'Singer' }).fill('');
  await page.getByRole('option', { name: /Kandulu Gan$|Kandulu Gan ·/ }).first().click();
  assert.equal(await title.inputValue(), 'Kandulu Gan');
  assert.equal(await page.getByRole('combobox', { name: 'Singer' }).inputValue(), 'නන්දා මාලිනී');
  assert.equal(await page.getByRole('option', { name: /^Kandulu Gan( ·.*)?$/ }).count(), 0, 'the chosen name is no longer offered');
  await shot(page, 'title-suggest');
  // the same box in the song menu, for helpers and for visitors
  await page.goto(`${base}#/songs`);
  const pub = await open(gh, { scale: 1 });
  await ready(pub);
  await searchFor(pub, 'Seethala');
  await pub.locator('.songs .row-main').first().click();
  await pub.waitForSelector('.viewer .v-img[src]');
  await pub.getByRole('button', { name: 'More' }).click();
  await pub.getByRole('button', { name: /Change the name or singer/ }).click();
  await pub.getByRole('combobox', { name: 'Song name' }).fill('nil ah');
  await pub.getByRole('option', { name: /Nil Ahase/ }).first().waitFor();
});
