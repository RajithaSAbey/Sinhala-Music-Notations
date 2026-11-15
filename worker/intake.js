// Cloudflare Worker: takes pictures from the public web app and puts them in a PRIVATE bucket (the "intake").
// It can only add; it cannot read, list-to-the-public, change or delete anything in the library.
// A scheduled job in the REST repository later turns what arrives here into songs waiting in the To-do tab.

const ALLOWED_ORIGINS = ['https://rajithasabey.github.io'];
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_BYTES = 2000;
const GROUP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, x-group, x-index, x-pages, x-name', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400', vary: 'Origin' } : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (url.pathname === '/' && req.method === 'GET') return new Response('Sinhala Music Notations: intake is running.', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname !== '/upload' || req.method !== 'POST') return json(404, { error: 'not found' }, cors);
    if (!allowed) return json(403, { error: 'This address may not send pictures.' }, cors);
    if (env.ACCEPTING === 'no') return json(503, { error: 'Uploads are paused for now. Please try again later.' }, cors);

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: 'Too many pictures at once. Waiting a minute, then continuing.' }, { ...cors, 'retry-after': '30' });
    }

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
