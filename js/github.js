// Talks to GitHub's API. The key never leaves the browser except to api.github.com.
import { RateLimited, PermanentError, b64encode, b64decode, sleep } from './util.js';

export class NetworkError extends Error {}

const API = 'https://api.github.com';

export class Repo {
  /** cfg: { repo: 'owner/name', branch, folder, token } */
  constructor(cfg) {
    this.cfg = cfg;
    this.prefix = cfg.folder ? `${cfg.folder}/` : '';
  }
  get repo() { return this.cfg.repo; }
  path(p) { return `${this.prefix}${p}`; }

  async req(method, url, { body, accept = 'application/vnd.github+json', cache, tries = 3, signal } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < tries; attempt++) {
      let res;
      try {
        res = await fetch(url.startsWith('http') ? url : API + url, {
          method, signal,
          cache: cache || (method === 'GET' ? 'no-cache' : 'no-store'),
          headers: {
            Authorization: `Bearer ${this.cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        lastErr = new NetworkError('No connection. Check your internet and try again.');
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (res.status >= 200 && res.status < 300) return res;
      if (res.status >= 500) { lastErr = new NetworkError(`GitHub is busy (${res.status}). Please try again in a moment.`); await sleep(800 * (attempt + 1)); continue; }
      throw await this.explain(res);
    }
    throw lastErr;
  }

  async explain(res) {
    let msg = '';
    try { msg = (await res.clone().json()).message || ''; } catch { /* not JSON */ }
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.status === 429 || (res.status === 403 && (retryAfter || remaining === '0' || /rate limit|abuse|secondary/i.test(msg)))) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const at = retryAfter ? Date.now() + retryAfter * 1000 : reset ? reset * 1000 : Date.now() + 60_000;
      return new RateLimited(at);
    }
    if (res.status === 401) return new PermanentError('GitHub did not accept this database code. Ask the admin for a new one.');
    if (res.status === 403) return new PermanentError('This database code is not allowed to do that. Ask the admin for a new one.');
    if (res.status === 404) return new PermanentError('Not found. The database may have moved, or the database code is out of date.');
    const e = new PermanentError(msg || `GitHub said no (${res.status}).`);
    e.status = res.status;
    return e;
  }

  async json(method, url, opts) { return (await this.req(method, url, opts)).json(); }

  /** For the "Save and test" step. */
  async info() {
    const o = await this.json('GET', `/repos/${this.repo}`);
    return { isPrivate: !!o.private, canPush: !!o.permissions?.push };
  }

  /** The commit and root tree the branch points to now. */
  async head(branch = this.cfg.branch) {
    const ref = await this.json('GET', `/repos/${this.repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, '/')}`, { cache: 'no-store' });
    const commit = ref.object.sha;
    const c = await this.json('GET', `/repos/${this.repo}/git/commits/${commit}`, { cache: 'no-store' });
    return { commit, tree: c.tree.sha };
  }

  /** One folder level: name -> { sha, type }. */
  async tree(sha) {
    const o = await this.json('GET', `/repos/${this.repo}/git/trees/${sha}`, { cache: 'no-store' });
    const m = new Map();
    for (const e of o.tree || []) m.set(e.path, { sha: e.sha, type: e.type });
    if (o.truncated) m.truncated = true;
    return m;
  }

  /** Walks down from the root tree: subtree('abc', 'notation-shelf/songs') -> entries, or null when missing. */
  async subtree(rootSha, path) {
    let cur = rootSha;
    for (const seg of path.split('/').filter(Boolean)) {
      const t = await this.tree(cur);
      const e = t.get(seg);
      if (!e || e.type !== 'tree') return null;
      cur = e.sha;
    }
    return this.tree(cur);
  }

  async blobBytes(sha) {
    const r = await this.req('GET', `/repos/${this.repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json', cache: 'force-cache' });
    return new Uint8Array(await r.arrayBuffer());
  }

  /** A file of the database as bytes, or null when it does not exist. Optionally from another branch. */
  async fileBytes(path, { ref = this.cfg.branch, cache } = {}) {
    try {
      const r = await this.req('GET', `/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.raw+json', cache });
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (e instanceof PermanentError && e.message.startsWith('Not found')) return null;
      throw e;
    }
  }

  /** A small file with the id GitHub knows it by. */
  async fileWithSha(path, ref = this.cfg.branch) {
    try {
      const o = await this.json('GET', `/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { cache: 'no-store' });
      if (o.content === undefined || o.encoding !== 'base64') {
        return { sha: o.sha, bytes: await this.blobBytes(o.sha) };
      }
      return { sha: o.sha, bytes: b64decode(o.content) };
    } catch (e) {
      if (e instanceof PermanentError && e.message.startsWith('Not found')) return null;
      throw e;
    }
  }

  /**
   * Saves several files in ONE commit: pictures/files -> tree -> commit -> move the branch.
   * files: [{ path, bytes: Uint8Array }]. Returns { path: blobSha }.
   * Calls onProgress(done, total) as files are sent. Retries if somebody else committed meanwhile.
   */
  async commit(files, message, { onProgress, concurrency = 4 } = {}) {
    if (!files.length) return {};
    const shas = new Array(files.length);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const r = await this.json('POST', `/repos/${this.repo}/git/blobs`, { body: { content: b64encode(files[i].bytes), encoding: 'base64' }, tries: 4 });
        shas[i] = r.sha;
        onProgress?.(++done, files.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
    const branchPath = encodeURIComponent(this.cfg.branch).replace(/%2F/g, '/');
    for (let attempt = 0; attempt < 4; attempt++) {
      const { commit, tree } = await this.head();
      const t = await this.json('POST', `/repos/${this.repo}/git/trees`, {
        body: { base_tree: tree, tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: shas[i] })) },
      });
      const c = await this.json('POST', `/repos/${this.repo}/git/commits`, { body: { message, tree: t.sha, parents: [commit] } });
      try {
        await this.req('PATCH', `/repos/${this.repo}/git/refs/heads/${branchPath}`, { body: { sha: c.sha, force: false }, tries: 1 });
        return Object.fromEntries(files.map((f, i) => [f.path, shas[i]]));
      } catch (e) {
        if (e instanceof PermanentError && (e.status === 422 || e.status === 409)) { await sleep(300 * (attempt + 1)); continue; } // someone committed first
        throw e;
      }
    }
    throw new NetworkError('The database is busy right now (someone else is saving). Please try again.');
  }
}

export function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
