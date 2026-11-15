import test from 'node:test';
import assert from 'node:assert/strict';
import { key, toLatin, Index, tokens, similarity, same, hasSinhala } from '../js/phonetic.js';
import { parse, create } from '../js/setupcode.js';
import { titleFromName } from '../js/upload.js';
import { parseSong, songJson } from '../js/library.js';
import { gitBlobSha } from '../js/util.js';

test('key matches the Android app', () => {
  const v = { 'සැන්දෑ වලාවන්': 'sanda walawan', 'මා ආදරණීය මගේ': 'ma adaraniya mage', 'සීතල ගී': 'sitala gi', 'හිතුවක්කාරයා': 'hituwakaraya', 'කඳුළු ගං': 'kandulu gan', 'Sanda Walawan': 'sanda walawan', 'Ma Adaraneeya Mage': 'ma adaraneya mage' };
  for (const [a, b] of Object.entries(v)) assert.equal(key(a), b, a);
});

test('Sinhala and English spellings find each other', () => {
  const ix = new Index('සැන්දෑ වලාවන්');
  assert.ok(ix.matches(tokens('sanda')));
  assert.ok(ix.matches(tokens('walawan')));
  assert.ok(ix.matches(tokens('සැන්දෑ')));
  assert.ok(!ix.matches(tokens('kandulu')));
  assert.ok(new Index('Kandulu Gan').matches(tokens('කඳුළු')));
  assert.ok(new Index('Sanda Walawan').matches(tokens('sndwlwn'))); // consonant skeleton
});

test('same song detection', () => {
  assert.ok(same('Ma Adaraneeya Mage', 'මා ආදරණීය මගේ'));
  assert.ok(same('Hithuwakkaraya', 'Hithuwakaraya'));
  assert.ok(!same('Sanda Walawan', 'Kandulu Gan'));
  assert.ok(!same('abc', 'abc')); // too short to trust
  assert.ok(similarity('Sanda', 'Sanda') === 1);
  assert.ok(hasSinhala('සඳ') && !hasSinhala('sanda'));
  assert.equal(toLatin('ං'), 'n');
});

test('database code round trip (same format as the Android app)', () => {
  const code = create({ repo: 'o/r', branch: 'b', folder: 'notation-shelf', token: 'ghp_x', member: true });
  assert.match(code, /^NSHELF1\.[A-Za-z0-9_-]+$/);
  const c = parse(`Here is your code:\n${code}\nthanks`);
  assert.deepEqual({ r: c.repo, b: c.branch, f: c.folder, t: c.token, role: c.role }, { r: 'o/r', b: 'b', f: 'notation-shelf', t: 'ghp_x', role: 'member' });
  const old = parse(create({ repo: 'o/r', branch: 'b', folder: '', token: 't', member: false }));
  assert.equal(old.role, 'admin'); assert.equal(old.readOnly, true);
  assert.equal(parse('nonsense'), null);
  assert.equal(parse('NSHELF1.!!!'), null);
});

test('titles from file names', () => {
  assert.equal(titleFromName('Ma adaraneeya mage (2).jpg'), 'Ma adaraneeya mage');
  assert.equal(titleFromName('Sanda_Walawan.JPG'), 'Sanda Walawan');
  assert.equal(titleFromName('මා ආදරණීය.jpeg'), 'මා ආදරණීය');
  for (const junk of ['IMG_0001.jpg', 'IMG-20240101-WA0003.jpg', '20240101_123456.jpg', 'Screenshot 2024.png', '123.jpg', 'a.jpg', 'DSC_0345.jpg', 'WhatsApp Image 2024-01-01 at 10.00.00 AM.jpeg']) assert.equal(titleFromName(junk), '', junk);
});

test('song file keeps the Android shape', () => {
  const rec = parseSong('{"uid":"u","title":"T","singer":"","notes":"","createdAt":1,"updatedAt":2,"deleted":false,"pages":[{"file":"a.jpg","rotation":0},{"file":"b.jpg","rotation":90,"hash":"h"}],"links":[{"kind":"chords","title":"x","url":"https://e.com"},{"kind":"bad","url":"javascript:1"}],"titleState":2,"sourceName":"s"}');
  assert.equal(rec.links.length, 1);
  assert.equal(rec.titleState, 2);
  const o = JSON.parse(songJson(rec));
  assert.deepEqual(Object.keys(o), ['uid', 'title', 'singer', 'notes', 'createdAt', 'updatedAt', 'deleted', 'pages', 'links', 'titleState', 'sourceName']);
  assert.deepEqual(o.pages[0], { file: 'a.jpg', rotation: 0 });
  assert.deepEqual(o.pages[1], { file: 'b.jpg', rotation: 90, hash: 'h' });
  // path traversal in file names is dropped
  assert.equal(parseSong({ uid: 'x', pages: [{ file: '../../x.jpg' }] }).pages.length, 0);
});

test('git blob id is computed like git', async () => {
  assert.equal(await gitBlobSha(new TextEncoder().encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
