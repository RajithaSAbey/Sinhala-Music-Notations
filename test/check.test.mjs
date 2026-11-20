// The public review page: check a few bars, send them to the (fake) Worker.   node --test test/check.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

test('review page: check bars, correct one, send; nothing else is contacted', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  const sent = []; const other = [];
  await page.route('https://intake.sinhala-music.workers.dev/**', (r) => {
    const rq = r.request();
    if (rq.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    sent.push(JSON.parse(rq.postData()));
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"ok":true}' });
  });
  page.on('request', (rq) => { const u = new URL(rq.url()); if (!u.href.startsWith(base) && !u.host.endsWith('workers.dev')) other.push(rq.url()); });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}check/`);
  await page.waitForSelector('#card:not([hidden])');
  const total = Number((await page.textContent('#count')).split(' of ')[1]);
  assert.ok(total >= 40);
  assert.ok(await page.locator('#img').evaluate((i) => i.complete && i.naturalWidth > 0 || new Promise((res) => { i.onload = () => res(true); })), 'the bar picture shows');
  await page.click('#ok');                                   // bar 1 looks right
  await page.fill('#in', 'ම ග ස —');                          // bar 2 corrected
  await page.fill('#note', 'last note is long');
  await page.click('#fix');
  await page.fill('#in', 'ස');
  await page.click('#skip');
  assert.match(await page.textContent('#prog'), /^3 of/);
  await page.fill('#who', 'Kamal');
  await page.click('#send');
  await page.waitForFunction(() => /Sent 3 bars/.test(document.querySelector('#sent').textContent));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].who, 'Kamal'); assert.equal(sent[0].sheet, 'song1');
  assert.deepEqual(sent[0].answers.map((a) => [a.status, a.fix]), [['ok', ''], ['fix', 'ම ග ස —'], ['skip', '']]);
  assert.equal(sent[0].answers[1].note, 'last note is long');
  // English letters typed in the box become Sinhala letters
  await page.fill('#in', 'D r M'); await page.click('#fix');
  await page.click('#chips .chip >> nth=3');
  assert.deepEqual(other, [], 'only this site and the Worker were contacted');
  assert.deepEqual(errors, []);
});

test('sending with nothing checked is refused politely', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}check/`);
  await page.waitForSelector('#card:not([hidden])');
  await page.click('#send');
  assert.match(await page.textContent('#sent'), /Check at least one bar/);
});

test('tap notes, then put a bracket or a bar under them', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
  await page.route('https://intake.sinhala-music.workers.dev/**', (r) => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(`${base}check/`);
  await page.waitForSelector('#card:not([hidden])');
  await page.fill('#in', 'ම ග ස ධ');
  assert.equal(await page.locator('#brk').isDisabled(), true);
  await page.locator('#cells .cell').nth(1).click();   // ග
  await page.locator('#cells .cell').nth(2).click();   // ස
  assert.match(await page.textContent('#selhint'), /2 notes selected/);
  await page.click('#brk');
  assert.equal(await page.inputValue('#in'), 'ම ( ග ස ) ධ');
  assert.equal(await page.locator('#cells .slur .cell').count(), 2);
  await page.locator('#cells .cell').nth(3).click();   // ධ
  await page.click('#bar');
  assert.equal(await page.inputValue('#in'), 'ම ( ග ස ) ධ_');
  assert.equal(await page.locator('#cells .cell.u').count(), 1);
  await page.click('#bar');                             // again = off
  assert.equal(await page.inputValue('#in'), 'ම ( ග ස ) ධ');
  await page.locator('#cells .cell').nth(1).click();
  await page.click('#clr');
  assert.equal(await page.inputValue('#in'), 'ම ග ස ධ');
  // a bracket over notes that already sit in one: replaced, not nested
  await page.fill('#in', 'ම ( ග ස ) ධ');
  await page.locator('#cells .cell').nth(0).click(); await page.locator('#cells .cell').nth(3).click();
  await page.click('#brk');
  assert.equal(await page.inputValue('#in'), '( ම ග ස ධ )');
});
