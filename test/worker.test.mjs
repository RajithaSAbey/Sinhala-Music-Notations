import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/intake.js';

const ORIGIN = 'https://rajithasabey.github.io';
const jpeg = (n = 5000) => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const G = '123e4567-e89b-42d3-a456-426614174000';
function env({ limitOk = true } = {}) {
  const store = new Map();
  return { store, ACCEPTING: 'yes', LIMITER: { limit: async () => ({ success: limitOk }) }, INTAKE: { head: async (k) => store.get(k) || null, put: async (k, v, o) => { store.set(k, { v: typeof v === 'string' ? new TextEncoder().encode(v) : v, o }); } } };
}
const post = (e, { body = jpeg(), headers = {}, origin = ORIGIN } = {}) => worker.fetch(new Request('https://w/upload', { method: 'POST', body, headers: { origin, 'x-group': G, 'x-index': '0', 'x-pages': '2', 'x-name': encodeURIComponent('Sanda Walawan.jpg'), ...headers } }), e);

test('accepts a JPEG and stores it privately with its name', async () => {
  const e = env(); const r = await post(e);
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const o = e.store.get(`uploads/${G}/000.jpg`);
  assert.equal(o.o.customMetadata.name, 'Sanda Walawan.jpg'); assert.equal(o.o.customMetadata.pages, '2');
});
test('the same picture twice is stored once', async () => {
  const e = env(); await post(e); const first = e.store.get(`uploads/${G}/000.jpg`); await post(e, { body: jpeg(6000) });
  assert.equal(e.store.get(`uploads/${G}/000.jpg`), first);
});
test('refuses other web sites, non-JPEG, too small, too large, bad ids, and too many', async () => {
  assert.equal((await post(env(), { origin: 'https://evil.example' })).status, 403);
  const png = new Uint8Array(5000); png[0] = 0x89; assert.equal((await post(env(), { body: png })).status, 415);
  assert.equal((await post(env(), { body: jpeg(100) })).status, 415);
  assert.equal((await post(env(), { body: jpeg(16 * 1024 * 1024) })).status, 413);
  assert.equal((await post(env(), { headers: { 'x-group': '../../etc' } })).status, 400);
  assert.equal((await post(env(), { headers: { 'x-index': '5', 'x-pages': '2' } })).status, 400);
  assert.equal((await post(env({ limitOk: false }))).status, 429);
  const paused = env(); paused.ACCEPTING = 'no'; assert.equal((await post(paused)).status, 503);
});
const edit = (e, body, origin = ORIGIN) => worker.fetch(new Request('https://w/edit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { origin } }), e);
const U = '123e4567-e89b-42d3-a456-426614174000';
test('a name/singer change is queued, cleaned, and never touches the library directly', async () => {
  const e = env();
  const r = await edit(e, { uid: U, title: '  Sanda   Walawan \n', singer: 'Nanda\u0000 Malini' });
  assert.equal(r.status, 200);
  const [[k, v]] = [...e.store];
  assert.match(k, /^edits\/\d+-[0-9a-f]{8}\.json$/);
  const o = JSON.parse(new TextDecoder().decode(v.v));
  assert.deepEqual([o.uid, o.title, o.singer], [U, 'Sanda Walawan', 'Nanda Malini']);
  assert.match(v.o.customMetadata.who, /^[0-9a-f]{16}$/);
});
test('a visitor can flag a to-do picture as not a song', async () => {
  const e = env();
  assert.equal((await edit(e, { uid: U, notSong: true })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(new TextDecoder().decode([...e.store.values()][0].v))).sort(), ['at', 'notSong', 'uid']);
});
test('edit requests are checked', async () => {
  assert.equal((await edit(env(), { uid: U, title: '', singer: 'x' })).status, 400);
  assert.equal((await edit(env(), { uid: '../x', title: 'T' })).status, 400);
  assert.equal((await edit(env(), { uid: U, title: 'Buy now www.spam.com' })).status, 400);
  assert.equal((await edit(env(), { uid: U, title: 'T', singer: 'http://x' })).status, 400);
  assert.equal((await edit(env(), 'not json')).status, 400);
  assert.equal((await edit(env(), { uid: U, title: 'T' }, 'https://evil.example')).status, 403);
  assert.equal((await edit(env({ limitOk: false }), { uid: U, title: 'T' })).status, 429);
  const long = env(); await edit(long, { uid: U, title: 'x'.repeat(500) });
  assert.equal(JSON.parse(new TextDecoder().decode([...long.store.values()][0].v)).title.length, 200);
});
test('cannot read, list or delete through the worker', async () => {
  const e = env();
  for (const m of ['GET', 'DELETE', 'PUT']) assert.equal((await worker.fetch(new Request('https://w/upload', { method: m, headers: { origin: ORIGIN } }), e)).status, 404);
  assert.equal((await worker.fetch(new Request('https://w/uploads/x', { method: 'GET' }), e)).status, 404);
  const pre = await worker.fetch(new Request('https://w/upload', { method: 'OPTIONS', headers: { origin: ORIGIN } }), e);
  assert.equal(pre.status, 204);
});
