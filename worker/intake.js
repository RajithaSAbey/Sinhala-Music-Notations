// Cloudflare Worker: takes pictures from the public web app and puts them in a PRIVATE bucket (the "intake").
// It can only add; it cannot read, list-to-the-public, change or delete anything in the library.
// A scheduled job in the REST repository later turns what arrives here into songs waiting in the To-do tab,
// and applies name/singer changes (never deletes).

const ALLOWED_ORIGINS = ['https://rajithasabey.github.io'];
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_BYTES = 2000;
const GROUP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const SPAM = /https?:|www\.|\.(com|net|org|lk|info|xyz)\b|@/i;

/** A new name and/or singer for a song. It is only a request: the import job checks and applies it later. */
async function edit(req, env, cors, ip) {
  let body;
  try { body = JSON.parse(await req.text()); } catch { return json(400, { error: 'Bad request.' }, cors); }
  const uid = String(body?.uid ?? '');
  const title = clean(body?.title, 200), singer = clean(body?.singer, 200);
  if (!GROUP.test(uid)) return json(400, { error: 'Bad request.' }, cors);
  const notSong = body?.notSong === true;
  if (!notSong && !title) return json(400, { error: 'The song needs a name.' }, cors);
  if (SPAM.test(title) || SPAM.test(singer)) return json(400, { error: 'Web addresses are not allowed in a name.' }, cors);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${env.SALT || 'salt'}`)));
  const who = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `edits/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
  await env.INTAKE.put(key, JSON.stringify(notSong ? { uid, notSong: true, at: Date.now() } : { uid, title, singer, at: Date.now() }), { httpMetadata: { contentType: 'application/json' }, customMetadata: { who } });
  return json(200, { ok: true }, cors);
}

/** Corrections to a typeset notation sheet, sent by whoever has the review page open. Stored privately, never applied by themselves. */
async function fix(req, env, cors) {
  const text = await req.text();
  if (text.length > 40000) return json(413, { error: 'Too much text.' }, cors);
  let o;
  try { o = JSON.parse(text); } catch { return json(400, { error: 'Bad request.' }, cors); }
  const sheet = clean(o?.sheet, 40);
  if (!/^[a-z0-9-]{1,40}$/.test(sheet) || !Array.isArray(o?.answers) || o.answers.length > 200) return json(400, { error: 'Bad request.' }, cors);
  const answers = [];
  for (const a of o.answers) {
    const id = clean(a?.id, 12);
    const status = ['ok', 'fix', 'skip'].includes(a?.status) ? a.status : '';
    if (!/^R\d{1,2}\.B\d$/.test(id) || !status) continue;
    answers.push({ id, status, fix: status === 'fix' ? clean(a.fix, 120) : '', note: clean(a?.note, 200) });
  }
  if (!answers.length) return json(400, { error: 'Nothing to save.' }, cors);
  const key = `fixes/${sheet}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
  await env.INTAKE.put(key, JSON.stringify({ sheet, who: clean(o?.who, 60), at: Date.now(), answers }), { httpMetadata: { contentType: 'application/json' } });
  return json(200, { ok: true, saved: answers.length }, cors);
}

/** Only the owner (with the secret) can read or tidy the submissions. */
async function readFixes(req, env, url) {
  const auth = req.headers.get('authorization') || '';
  if (!env.READ_TOKEN || auth !== `Bearer ${env.READ_TOKEN}`) return json(401, { error: 'no' });
  const sheet = (url.searchParams.get('sheet') || '').replace(/[^a-z0-9-]/g, '');
  if (req.method === 'DELETE') {
    const key = url.searchParams.get('key') || '';
    if (!key.startsWith('fixes/')) return json(400, { error: 'bad key' });
    await env.INTAKE.delete(key);
    return json(200, { ok: true });
  }
  if (req.method !== 'GET') return json(405, { error: 'no' });
  const listed = await env.INTAKE.list({ prefix: `fixes/${sheet}`, limit: 500 });
  const out = [];
  for (const o of listed.objects || []) {
    const body = await env.INTAKE.get(o.key);
    if (body) { try { out.push({ key: o.key, ...(JSON.parse(await body.text())) }); } catch { /* skip a broken file */ } }
  }
  return json(200, { submissions: out });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, x-group, x-index, x-pages, x-name', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400', vary: 'Origin' } : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (url.pathname === '/' && req.method === 'GET') return new Response('Sinhala Music Notations: intake is running.', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/fixes') return readFixes(req, env, url);
    if ((url.pathname !== '/upload' && url.pathname !== '/edit' && url.pathname !== '/fix') || req.method !== 'POST') return json(404, { error: 'not found' }, cors);
    if (!allowed) return json(403, { error: 'This address may not send pictures.' }, cors);
    if (env.ACCEPTING === 'no') return json(503, { error: 'Uploads are paused for now. Please try again later.' }, cors);

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: 'Too many pictures at once. Waiting a minute, then continuing.' }, { ...cors, 'retry-after': '30' });
    }

    if (url.pathname === '/edit') return edit(req, env, cors, ip);
    if (url.pathname === '/fix') return fix(req, env, cors);

    const group = req.headers.get('x-group') || '';
    const index = Number(req.headers.get('x-index'));
    const pages = Number(req.headers.get('x-pages'));
    let name = '';
    try { name = decodeURIComponent(req.headers.get('x-name') || '').replace(/[\u0000-\u001f]/g, '').slice(0, 200); } catch { /* ignore a bad name */ }
    if (!GROUP.test(group) || !Number.isInteger(index) || index < 0 || index > 399 || !Number.isInteger(pages) || pages < 1 || pages > 400 || index >= pages) return json(400, { error: 'Bad request.' }, cors);

    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return json(413, { error: 'That picture is too large (15 MB at most).' }, cors);
    const body = await req.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return json(413, { error: 'That picture is too large (15 MB at most).' }, cors);
    const b = new Uint8Array(body);
    if (b.length < MIN_BYTES || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return json(415, { error: 'Only JPEG pictures are accepted.' }, cors);

    const key = `uploads/${group}/${String(index).padStart(3, '0')}.jpg`;
    if (!(await env.INTAKE.head(key))) {
      await env.INTAKE.put(key, body, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { name, pages: String(pages), at: String(Date.now()) } });
    }
    return json(200, { ok: true }, cors);
  },
};
