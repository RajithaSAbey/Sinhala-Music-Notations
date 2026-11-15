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
  return { gh, db };
}
const codeFor = (gh, db, member = true) => create({ repo: gh.repo, branch: db.branch, folder: db.folder, token: gh.token, member });

async function open(gh, { cfg, viewport = { width: 390, height: 844 }, scale = 1 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true, serviceWorkers: 'allow' });
  await context.route('https://api.github.com/**', (r) => gh.handle(r));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  if (cfg) await page.addInitScript((c) => { if (!localStorage.getItem('nsm.cfg')) localStorage.setItem('nsm.cfg', JSON.stringify(c)); }, cfg);
  await page.goto(base);
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
  assert.ok(names.includes('Nanda Malini') && names.includes('Victor Ratnayake'));
  await shot(page, 'singers');
  await page.locator('.tile', { hasText: 'Nanda Malini' }).click();
  await page.getByRole('heading', { name: 'Nanda Malini' }).waitFor();
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
  await page.getByLabel('Singer', { exact: true }).fill('Somebody');
  await page.getByRole('button', { name: 'Save and next' }).click();
  await page.waitForFunction(() => /1 left/.test(document.querySelector('.todo-card .muted')?.textContent || ''));
  const s2 = gh.paths(db.branch, 'notation-shelf/songs/').map((p) => JSON.parse(gh.file(db.branch, p))).find((s) => s.title === 'Brand New Tune');
  assert.equal(s2.singer, 'Somebody'); assert.equal(s2.titleState, 0);
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
