// A tiny in-memory stand-in for the parts of GitHub's API the app uses, so the whole app can be tested without touching GitHub.
import { createHash } from 'node:crypto';

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const blobSha = (buf) => sha1(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]));

export class FakeGitHub {
  constructor({ repo = 'owner/db', token = 'tok', canPush = true, isPrivate = true } = {}) {
    this.repo = repo; this.token = token; this.canPush = canPush; this.isPrivate = isPrivate;
    this.blobs = new Map(); // sha -> Buffer
    this.commits = new Map(); // sha -> { snap: Map(path->blobSha), parents, tree }
    this.branches = new Map(); // name -> commit sha
    this.dirs = new Map(); // tree sha -> [{path,type,sha}]
    this.pending = new Map(); // tree sha -> snapshot
    this.calls = [];
    this.limit = null; // when set to a number, requests beyond it get a rate-limit response
    this.failBlobsOnce = false;
  }

  blob(buf) { buf = Buffer.from(buf); const s = blobSha(buf); this.blobs.set(s, buf); return s; }

  /** Registers a snapshot's folder trees and returns the root tree sha. */
  registerTree(snap) {
    const root = { files: new Map(), dirs: new Map() };
    for (const [path, sha] of snap) {
      const parts = path.split('/');
      let cur = root;
      for (const d of parts.slice(0, -1)) { if (!cur.dirs.has(d)) cur.dirs.set(d, { files: new Map(), dirs: new Map() }); cur = cur.dirs.get(d); }
      cur.files.set(parts.at(-1), sha);
    }
    const build = (n) => {
      const entries = [];
      for (const [name, sha] of n.files) entries.push({ path: name, type: 'blob', sha, mode: '100644' });
      for (const [name, d] of n.dirs) entries.push({ path: name, type: 'tree', sha: build(d), mode: '040000' });
      entries.sort((a, b) => a.path.localeCompare(b.path));
      const sha = sha1(Buffer.from(JSON.stringify(entries)));
      this.dirs.set(sha, entries);
      return sha;
    };
    return build(root);
  }

  commit(branch, snap, message = 'init') {
    const tree = this.registerTree(snap);
    const parents = this.branches.has(branch) ? [this.branches.get(branch)] : [];
    const sha = sha1(Buffer.from(JSON.stringify({ tree, parents, message, n: this.commits.size })));
    this.commits.set(sha, { snap: new Map(snap), parents, tree });
    this.branches.set(branch, sha);
    return sha;
  }
  head(branch) { return this.commits.get(this.branches.get(branch)); }
  file(branch, path) { const c = this.head(branch); const s = c?.snap.get(path); return s ? this.blobs.get(s) : null; }
  paths(branch, prefix = '') { return [...(this.head(branch)?.snap.keys() || [])].filter((p) => p.startsWith(prefix)); }

  /** Playwright route handler for https://api.github.com/** */
  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset, retry-after' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
    const bytes = (buf) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: buf });
    this.calls.push(`${req.method()} ${url.pathname}${url.search}`);
    if (req.headers().authorization !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });
    if (this.limit !== null) { if (this.limit-- <= 0) return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }); }
    const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!m || m[1] !== this.repo) return json(404, { message: 'Not Found' });
    const rest = m[2] || '';
    const raw = (req.headers().accept || '').includes('raw');
    try {
      if (rest === '') return json(200, { private: this.isPrivate, permissions: { push: this.canPush } });
      let r;
      if ((r = rest.match(/^\/git\/ref\/heads\/(.+)$/))) { const b = decodeURIComponent(r[1]); return this.branches.has(b) ? json(200, { object: { sha: this.branches.get(b) } }) : json(404, { message: 'Not Found' }); }
      if ((r = rest.match(/^\/git\/commits\/(\w+)$/)) && req.method() === 'GET') { const c = this.commits.get(r[1]); return c ? json(200, { sha: r[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' }); }
      if ((r = rest.match(/^\/git\/trees\/(\w+)$/)) && req.method() === 'GET') { const t = this.dirs.get(r[1]); return t ? json(200, { sha: r[1], tree: t, truncated: false }) : json(404, { message: 'Not Found' }); }
      if ((r = rest.match(/^\/git\/blobs\/(\w+)$/)) && req.method() === 'GET') {
        const b = this.blobs.get(r[1]); if (!b) return json(404, { message: 'Not Found' });
        return raw ? bytes(b) : json(200, { sha: r[1], encoding: 'base64', content: b.toString('base64') });
      }
      if (rest === '/git/blobs' && req.method() === 'POST') {
        if (this.failBlobsOnce) { this.failBlobsOnce = false; return json(502, { message: 'Bad gateway' }); }
        const body = JSON.parse(req.postData()); return json(201, { sha: this.blob(Buffer.from(body.content, 'base64')) });
      }
      if (rest === '/git/trees' && req.method() === 'POST') {
        const body = JSON.parse(req.postData());
        const baseCommit = [...this.commits.values()].find((c) => c.tree === body.base_tree);
        const snap = new Map(baseCommit.snap);
        for (const e of body.tree) { if (!this.blobs.has(e.sha)) return json(422, { message: 'missing blob' }); snap.set(e.path, e.sha); }
        const sha = this.registerTree(snap); this.pending.set(sha, snap);
        return json(201, { sha });
      }
      if (rest === '/git/commits' && req.method() === 'POST') {
        const body = JSON.parse(req.postData());
        const snap = this.pending.get(body.tree);
        const sha = sha1(Buffer.from(JSON.stringify(body) + this.commits.size));
        this.commits.set(sha, { snap, parents: body.parents, tree: body.tree, message: body.message });
        return json(201, { sha });
      }
      if ((r = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method() === 'PATCH') {
        const b = decodeURIComponent(r[1]); const body = JSON.parse(req.postData());
        const c = this.commits.get(body.sha);
        if (!c || c.parents[0] !== this.branches.get(b)) return json(422, { message: 'Update is not a fast forward' });
        this.branches.set(b, body.sha); return json(200, { object: { sha: body.sha } });
      }
      if ((r = rest.match(/^\/contents\/(.+)$/)) && req.method() === 'GET') {
        const path = decodeURIComponent(r[1]); const ref = url.searchParams.get('ref');
        const c = this.head(ref); const sha = c?.snap.get(path);
        if (!sha) return json(404, { message: 'Not Found' });
        const b = this.blobs.get(sha);
        return raw ? bytes(b) : json(200, { sha, encoding: 'base64', content: b.toString('base64'), size: b.length, path });
      }
    } catch (e) { return json(500, { message: String(e) }); }
    return json(404, { message: `Unhandled ${req.method()} ${rest}` });
  }
}

/** A small database like the real one: 40 songs, some with several pages, a few waiting in the to-do list, an album file. */
export function sampleDatabase(gh, { folder = 'notation-shelf', branch = 'notation-library', pictures } = {}) {
  const snap = new Map();
  const imgShas = [];
  pictures.forEach((buf, i) => { const name = `img-${i + 1}.jpg`; snap.set(`${folder}/images/${name}`, gh.blob(buf)); imgShas.push({ name, hash: createHash('sha256').update(buf).digest('hex') }); });
  const titles = [
    ['සැන්දෑ වලාවන්', 'වික්ටර් රත්නායක'], ['Kandulu Gan', 'නන්දා මාලිනී'], ['මා ආදරණීය මගේ', 'අමරදේව'], ['Seethala Gee', 'සුනිල් එදිරිසිංහ'], ['Nil Ahase', 'නන්දා මාලිනී'],
    ['හිතුවක්කාරයා', 'වික්ටර් රත්නායක'], ['Sanda Eliyen', 'අමරදේව'], ['Adaraneeya Hamuwe', 'ඩබ්ලිව්. ඩී. අමරදේව'],
  ];
  for (let i = 0; i < 40; i++) {
    const [t, s] = titles[i % titles.length];
    const title = i < titles.length ? t : `${t} ${i}`;
    const uid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const pg = imgShas[i % imgShas.length];
    const pages = [{ file: pg.name, rotation: 0, ...(i % 3 ? { hash: pg.hash } : {}) }];
    if (i % 5 === 0) pages.push({ file: imgShas[(i + 1) % imgShas.length].name, rotation: 0 });
    const links = i === 0 ? [{ kind: 'chords', title: 'Chords', url: 'https://example.com/chords' }] : [];
    snap.set(`${folder}/songs/${uid}.json`, gh.blob(JSON.stringify({ uid, title, singer: i % 4 === 3 ? '' : s, notes: i === 7 ? 'KEEP-PRIVATE' : '', createdAt: 1700000000000 + i * 1000, updatedAt: 1700000000000 + i * 1000, deleted: false, pages, links, titleState: 0, sourceName: '' }, null, 2)));
  }
  for (let i = 0; i < 4; i++) {
    const uid = `11111111-0000-4000-8000-${String(i).padStart(12, '0')}`;
    snap.set(`${folder}/songs/${uid}.json`, gh.blob(JSON.stringify({ uid, title: 'Untitled', singer: '', notes: i === 3 ? 'NOT-A-SONG' : '', createdAt: 1700001000000 + i, updatedAt: 1700001000000 + i, deleted: false, pages: [{ file: imgShas[i].name, rotation: 0 }], links: [], titleState: 2, sourceName: `IMG_${100 + i}.jpg` }, null, 2)));
  }
  // a deleted one that must not show up
  snap.set(`${folder}/songs/22222222-0000-4000-8000-000000000000.json`, gh.blob(JSON.stringify({ uid: '22222222-0000-4000-8000-000000000000', title: 'Removed Song', singer: '', notes: '', createdAt: 1, updatedAt: 2, deleted: true, pages: [], links: [], titleState: 0, sourceName: '' })));
  snap.set(`${folder}/private/albums.json`, gh.blob(JSON.stringify({ albums: [{ uid: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Sunday set', updatedAt: 5, deleted: false, songs: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001'] }] })));
  snap.set(`${folder}/TODO.md`, gh.blob('# to-do'));
  gh.commit(branch, snap, 'Database');
  return { folder, branch, imgShas };
}
