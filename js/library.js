// The database as this device sees it: songs, albums, pictures, and keeping them in step with GitHub.
import { Repo } from './github.js';
import { idb, prefs, pictures } from './store.js';
import { Index, tokens, key, similarity, same } from './phonetic.js';
import { text, utf8, gitBlobSha, uuid, sleep, RateLimited, PermanentError } from './util.js';
import { PUBLIC_BASE, EDIT_URL } from './config.js';

export const NOT_A_SONG = 'NOT-A-SONG';
export const UNTITLED = 'Untitled';

export function parseSong(json, sha = '') {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  return {
    uid: String(o.uid), title: String(o.title ?? ''), singer: String(o.singer ?? ''), notes: String(o.notes ?? ''),
    createdAt: Number(o.createdAt) || 0, updatedAt: Number(o.updatedAt) || 0, deleted: !!o.deleted,
    pages: (Array.isArray(o.pages) ? o.pages : []).filter((p) => p && typeof p.file === 'string' && p.file && !p.file.includes('/'))
      .map((p) => ({ file: p.file, rotation: ((Number(p.rotation) || 0) % 360 + 360) % 360, hash: typeof p.hash === 'string' ? p.hash : '' })),
    links: (Array.isArray(o.links) ? o.links : []).filter((l) => l && /^https?:\/\//i.test(String(l.url)))
      .map((l) => ({ kind: String(l.kind || 'lyrics'), title: String(l.title || l.url), url: String(l.url) })),
    titleState: Number(o.titleState) === 2 ? 2 : 0, sourceName: String(o.sourceName ?? ''), sha,
  };
}

/** Exactly the shape the Android app writes (so both read each other's files). */
export function songJson(s) {
  return JSON.stringify({
    uid: s.uid, title: s.title, singer: s.singer, notes: s.notes, createdAt: s.createdAt, updatedAt: s.updatedAt, deleted: !!s.deleted,
    pages: s.pages.map((p) => ({ file: p.file, rotation: p.rotation || 0, ...(p.hash ? { hash: p.hash } : {}) })),
    links: s.links.map((l) => ({ kind: l.kind, title: l.title, url: l.url })),
    titleState: s.titleState === 2 ? 2 : 0, sourceName: s.sourceName || '',
  }, null, 2);
}

function prep(s) {
  s._t = new Index(s.title);
  s._g = new Index(s.singer);
  s._n = new Index(s.notes);
  s._k = key(s.title);
  s._sk = key(s.singer);
  return s;
}

export function newSong(title, { singer = '', pages = [], sourceName = '', titleState = 0 } = {}) {
  const now = Date.now();
  return prep({ uid: uuid(), title, singer, notes: '', createdAt: now, updatedAt: now, deleted: false, pages, links: [], titleState, sourceName, sha: '' });
}

export class Library extends EventTarget {
  constructor(cfg) {
    super();
    this.cfg = cfg; // { repo, branch, folder, token, role }
    this.isPublic = cfg.role === 'public';
    this.repo = this.isPublic ? null : new Repo(cfg);
    this.songs = new Map();
    this.albumList = [];
    this.meta = {};
    this.images = new Map(); // in-flight downloads
    this.fileToSong = new Map();
  }

  get role() { return this.cfg.role; }
  get isAdmin() { return this.cfg.role === 'admin'; }
  get canAdd() { return this.cfg.role === 'admin' || this.cfg.role === 'member'; }
  changed(what = 'songs') { this.dispatchEvent(new CustomEvent('change', { detail: what })); }

  // ---------- loading ----------
  async loadLocal() {
    const [rows, meta] = await Promise.all([idb.allSongs(), idb.getMeta('state')]);
    this.songs.clear();
    for (const r of rows) this.songs.set(r.uid, prep(r));
    this.meta = meta && meta.repo === this.cfg.repo && meta.branch === this.cfg.branch && meta.folder === this.cfg.folder ? meta : {};
    if (!this.meta.repo) { this.songs.clear(); if (rows.length) await idb.clearSongs(); }
    this.albumList = this.isAdmin ? (await idb.getMeta('albums')) || [] : prefs.get('albums.local', []);
    this.reindex();
  }

  reindex() {
    this.fileToSong.clear();
    this.hashes = new Map();
    for (const s of this.songs.values()) {
      if (s.deleted) continue;
      for (const p of s.pages) { this.fileToSong.set(p.file, s.uid); if (p.hash) this.hashes.set(p.hash, s.uid); }
    }
  }

  get isEmpty() { return this.live().length === 0; }
  live() { return [...this.songs.values()].filter((s) => !s.deleted); }
  todo() { return this.live().filter((s) => s.titleState === 2); }
  get(uid) { return this.songs.get(uid); }
  isNotSong(s) { return s.notes.includes(NOT_A_SONG); }

  async saveMeta() { await idb.setMeta('state', { ...this.meta, repo: this.cfg.repo, branch: this.cfg.branch, folder: this.cfg.folder }); }

  // ---------- getting changes from GitHub ----------
  /**
   * Brings this device up to date. onProgress({phase, done, total}).
   * Only changed songs are downloaded: GitHub tells us each song file's id, and we compare with what we have.
   */
  async sync(onProgress = () => {}) {
    if (this.isPublic) return this.syncPublic(onProgress);
    const repo = this.repo;
    onProgress({ phase: 'Checking the database…', done: 0, total: 0 });
    const head = await repo.head();
    const folder = await repo.subtree(head.tree, this.cfg.folder);
    if (!folder) throw new PermanentError('The database folder was not found. The database code may be out of date.');
    const songsEntry = folder.get('songs');
    const songTree = songsEntry ? await repo.tree(songsEntry.sha) : new Map();
    const privEntry = folder.get('private');
    const privTree = privEntry && this.isAdmin ? await repo.tree(privEntry.sha) : new Map();

    const remote = new Map(); // uid -> sha
    for (const [name, e] of songTree) if (e.type === 'blob' && name.endsWith('.json')) remote.set(name.slice(0, -5), e.sha);

    let preloaded = new Map();
    const needed = [...remote].filter(([uid, sha]) => this.songs.get(uid)?.sha !== sha);
    if (needed.length > 40 && this.songs.size < 20) {
      onProgress({ phase: 'Loading the search list…', done: 0, total: 0 });
      preloaded = await this.loadCatalog().catch((e) => { if (e instanceof RateLimited) throw e; return new Map(); });
    }

    const batch = [];
    let toFetch = [];
    for (const [uid, sha] of needed) {
      const c = preloaded.get(uid);
      if (c && c.sha === sha) batch.push(c); else toFetch.push([uid, sha]);
    }
    if (batch.length) { for (const s of batch) this.songs.set(s.uid, prep(s)); await idb.putSongs(batch); }

    let done = 0;
    const total = toFetch.length;
    const failed = [];
    let rate = null;
    const pending = [];
    const flush = async () => { const part = pending.splice(0); await idb.putSongs(part); };
    onProgress({ phase: total ? 'Getting songs…' : 'Up to date', done, total });
    let next = 0;
    const worker = async () => {
      while (next < toFetch.length && !rate) {
        const [uid, sha] = toFetch[next++];
        try {
          const bytes = await repo.blobBytes(sha);
          const s = prep(parseSong(text(bytes), sha));
          this.songs.set(uid, s); pending.push(s);
          if (pending.length >= 100) await flush();
        } catch (e) {
          if (e instanceof RateLimited) { rate = e; return; }
          failed.push(uid);
        }
        onProgress({ phase: 'Getting songs…', done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await flush();

    const gone = [...this.songs.keys()].filter((u) => !remote.has(u));
    if (gone.length) { gone.forEach((u) => this.songs.delete(u)); await idb.deleteSongs(gone); }
    this.reindex();
    this.changed('songs');
    if (rate) throw rate;

    if (this.isAdmin && privTree.get('albums.json')) {
      const sha = privTree.get('albums.json').sha;
      if (sha !== this.meta.albumsSha) {
        const bytes = await repo.blobBytes(sha);
        this.mergeAlbums(JSON.parse(text(bytes)).albums || []);
        await idb.setMeta('albums', this.albumList);
        this.meta.albumsSha = sha;
        this.changed('albums');
      }
    }
    if (!failed.length) { this.meta.commit = head.commit; this.meta.syncedAt = Date.now(); } else this.meta.syncedAt = Date.now();
    await this.saveMeta();
    return { total, failed: failed.length };
  }

  /** The public library: one search-list file for everything (no key, no limits). */
  async syncPublic(onProgress) {
    onProgress({ phase: 'Getting the song list…', done: 0, total: 0 });
    let res;
    try { res = await fetch(`${PUBLIC_BASE}/catalog.json`, { cache: 'no-cache' }); } catch { throw new Error('No connection. Check your internet and try again.'); }
    if (!res.ok) throw new PermanentError(res.status === 404 ? 'The public library is not published yet. Please try again later.' : `The public library could not be loaded (${res.status}).`);
    const cat = await res.json();
    if (cat.v !== 1 || !Array.isArray(cat.songs)) throw new PermanentError('The public library has an unexpected format.');
    const fresh = new Map();
    for (const c of cat.songs) {
      const s = parseSong({ uid: c.u, title: c.t, singer: c.g, notes: '', createdAt: c.c, updatedAt: c.m, deleted: false, pages: (c.p || []).map(([file, rotation, hash]) => ({ file, rotation, hash })), links: c.l || [], titleState: 0, sourceName: '' }, '');
      if (s.pages.length) fresh.set(s.uid, prep(s));
    }
    this.applyPublicEdits(fresh);
    this.songs = fresh;
    await idb.clearSongs(); await idb.putSongs([...fresh.values()]);
    this.reindex();
    this.meta.commit = String(cat.generated || 1); this.meta.syncedAt = Date.now();
    await this.saveMeta();
    this.changed('songs');
    return { total: fresh.size, failed: 0 };
  }

  /** Name/singer changes this visitor sent are shown at once on this device, until the public list catches up. */
  applyPublicEdits(map = this.songs) {
    const edits = prefs.get('pubEdits', {});
    let dirty = false;
    for (const [uid, e] of Object.entries(edits)) {
      const s = map.get(uid);
      if (!s || Date.now() - e.at > 4 * 86400_000 || (s.title === e.title && s.singer === e.singer && e.seen)) { delete edits[uid]; dirty = true; continue; }
      if (s.title === e.title && s.singer === e.singer) { e.seen = true; dirty = true; }
      s.title = e.title; s.singer = e.singer; prep(s);
    }
    if (dirty) prefs.set('pubEdits', edits);
  }

  /** Visitors: asks for a new name/singer. It is applied to the database within a few hours (and can be undone by the admin). */
  async suggestEdit(uid, title, singer) {
    let res;
    try { res = await fetch(EDIT_URL, { method: 'POST', body: JSON.stringify({ uid, title, singer }) }); } catch { throw new Error('No connection. Check your internet and try again.'); }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error; } catch { /* no details */ }
      throw new Error(res.status === 429 ? 'Too many changes at once. Please wait a minute and try again.' : msg || 'The change could not be sent. Please try again.');
    }
    const edits = prefs.get('pubEdits', {});
    edits[uid] = { title: title.trim(), singer: singer.trim(), at: Date.now() };
    prefs.set('pubEdits', edits);
    const s = this.songs.get(uid);
    if (s) { s.title = title.trim(); s.singer = singer.trim(); prep(s); await idb.putSongs([s]); this.changed('songs'); }
  }

  /** The search list the nightly job prepares (branch web-catalog): all songs in one download. uid -> song */
  async loadCatalog() {
    const bytes = await this.repo.fileBytes('catalog.json', { ref: 'web-catalog' });
    const out = new Map();
    if (!bytes) return out;
    const cat = JSON.parse(text(bytes));
    if (cat.v !== 1 || !Array.isArray(cat.songs)) return out;
    for (const c of cat.songs) {
      out.set(c.u, parseSong({
        uid: c.u, title: c.t, singer: c.g, notes: c.n, createdAt: c.c, updatedAt: c.m, deleted: !!c.d,
        pages: (c.p || []).map(([file, rotation, hash]) => ({ file, rotation, hash })), links: c.l || [], titleState: c.x, sourceName: c.o,
      }, c.s));
    }
    return out;
  }

  // ---------- pictures ----------
  /** A picture as a Blob: from this device if saved, else downloaded (and saved). */
  async image(file, { keep = false } = {}) {
    if (!file || /[\/\\\u0000-\u001f]/.test(file) || file.includes('..')) throw new Error('Bad picture name');
    const have = await pictures.cached(file);
    if (have) { if (keep) pictures.pin(file, true); return have; }
    if (this.images.has(file)) return this.images.get(file);
    const p = (async () => {
      let bytes;
      if (this.isPublic) {
        let r;
        try { r = await fetch(`${PUBLIC_BASE}/images/${encodeURIComponent(file)}`, { cache: 'force-cache' }); } catch { throw new Error('No connection. Check your internet and try again.'); }
        bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      } else bytes = await this.repo.fileBytes(this.repo.path(`images/${file}`), { cache: 'force-cache' });
      if (!bytes) throw new PermanentError('This picture is missing from the database.');
      const type = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
      const blob = new Blob([bytes], { type });
      await pictures.save(file, blob, { pinned: keep }).catch(() => {});
      return blob;
    })().finally(() => this.images.delete(file));
    this.images.set(file, p);
    return p;
  }

  // ---------- changing things ----------
  /**
   * Saves new/changed songs and new pictures in one commit.
   * songs: records; files: [{file, bytes}] new pictures. Updates this device on success.
   */
  async commitChanges(songs, files, message, onProgress) {
    const out = [];
    for (const f of files) out.push({ path: this.repo.path(`images/${f.file}`), bytes: f.bytes });
    const songBytes = songs.map((s) => ({ s, path: this.repo.path(`songs/${s.uid}.json`), bytes: utf8(songJson(s)) }));
    for (const b of songBytes) out.push({ path: b.path, bytes: b.bytes });
    await this.repo.commit(out, message, { onProgress });
    const saved = [];
    for (const b of songBytes) { b.s.sha = await gitBlobSha(b.bytes); prep(b.s); this.songs.set(b.s.uid, b.s); saved.push(b.s); }
    await idb.putSongs(saved);
    for (const f of files) pictures.save(f.file, new Blob([f.bytes], { type: 'image/jpeg' })).catch(() => {});
    this.reindex();
    this.changed('songs');
  }

  /** Changes one song on top of the newest copy on GitHub (so nobody's other change is lost). fn edits the record. */
  async updateSong(uid, fn, message = 'Update a song') {
    const path = this.repo.path(`songs/${uid}.json`);
    const f = await this.repo.fileWithSha(path).catch((e) => { if (e instanceof RateLimited) throw e; return null; });
    const base = f ? parseSong(text(f.bytes), f.sha) : plainCopy(this.songs.get(uid));
    if (!base) throw new Error('This song no longer exists.');
    fn(base);
    base.updatedAt = Math.max(Date.now(), base.updatedAt + 1);
    await this.commitChanges([base], [], message);
    return this.songs.get(uid);
  }

  /**
   * Gives an untitled song its name. If a song with (nearly) that name already exists, the pictures are added to it
   * and this song is retired. Returns { song, merged }.
   */
  async nameSong(uid, title, singer = '') {
    const target = this.findSame(title, uid);
    if (!target) {
      const song = await this.updateSong(uid, (r) => { r.title = title; if (singer) r.singer = singer; r.titleState = 0; }, 'Name a song');
      return { song, merged: false };
    }
    const [tf, mf] = await Promise.all([
      this.repo.fileWithSha(this.repo.path(`songs/${target.uid}.json`)),
      this.repo.fileWithSha(this.repo.path(`songs/${uid}.json`)),
    ]);
    const t = tf ? parseSong(text(tf.bytes), tf.sha) : plainCopy(target);
    const m = mf ? parseSong(text(mf.bytes), mf.sha) : plainCopy(this.songs.get(uid));
    const known = new Set(t.pages.flatMap((p) => [p.file, p.hash].filter(Boolean)));
    for (const p of m.pages) if (!known.has(p.file) && !(p.hash && known.has(p.hash))) t.pages.push(p);
    if (singer && !t.singer) t.singer = singer;
    const now = Date.now();
    t.updatedAt = Math.max(now, t.updatedAt + 1);
    m.pages = []; m.deleted = true; m.updatedAt = Math.max(now, m.updatedAt + 1);
    await this.commitChanges([t, m], [], 'Name a song');
    return { song: this.songs.get(t.uid), merged: true };
  }

  async setNotSong(uid, flag) {
    await this.updateSong(uid, (r) => {
      const rest = r.notes.replace(NOT_A_SONG, '').trim();
      r.notes = flag ? `${NOT_A_SONG} ${rest}`.trim() : rest;
    }, 'Mark a picture');
  }
  async deleteSong(uid) { await this.updateSong(uid, (r) => { r.deleted = true; }, 'Delete a song'); }

  // ---------- albums ----------
  albums() { return this.albumList.filter((a) => !a.deleted); }
  album(uid) { return this.albumList.find((a) => a.uid === uid); }
  mergeAlbums(remote) {
    const by = new Map(this.albumList.map((a) => [a.uid, a]));
    for (const r of remote) {
      const mine = by.get(r.uid);
      if (!mine || r.updatedAt > mine.updatedAt) by.set(r.uid, { uid: r.uid, name: r.name, updatedAt: r.updatedAt, deleted: !!r.deleted, songs: [...(r.songs || [])] });
    }
    this.albumList = [...by.values()];
  }
  async saveAlbums() {
    if (!this.isAdmin) { prefs.set('albums.local', this.albumList); this.changed('albums'); return; }
    await idb.setMeta('albums', this.albumList);
    this.changed('albums');
    try {
      const path = this.repo.path('private/albums.json');
      const f = await this.repo.fileWithSha(path);
      if (f) this.mergeAlbums(JSON.parse(text(f.bytes)).albums || []);
      const body = JSON.stringify({ albums: [...this.albumList].sort((a, b) => a.uid.localeCompare(b.uid)).map((a) => ({ uid: a.uid, name: a.name, updatedAt: a.updatedAt, deleted: a.deleted, songs: [...a.songs].sort() })) }, null, 2);
      await this.repo.commit([{ path, bytes: utf8(body) }], 'Update albums');
      this.meta.albumsSha = await gitBlobSha(utf8(body));
      await this.saveMeta();
    } catch (e) {
      if (e instanceof RateLimited) return; // saved on this device; the next change sends it
      throw e;
    }
  }
  /** Order inside an album (set list) is kept on this device, like a printed set list. */
  albumOrder(a) {
    const order = prefs.get('order.' + a.uid, []);
    const rank = new Map(order.map((u, i) => [u, i]));
    const songs = a.songs.map((u) => this.songs.get(u)).filter((s) => s && !s.deleted);
    return songs.sort((x, y) => (rank.has(x.uid) ? rank.get(x.uid) : 1e9) - (rank.has(y.uid) ? rank.get(y.uid) : 1e9) || x._k.localeCompare(y._k));
  }
  setAlbumOrder(a, uids) { prefs.set('order.' + a.uid, uids); }
  async createAlbum(name) {
    const a = { uid: uuid(), name: name.trim(), updatedAt: Date.now(), deleted: false, songs: [] };
    this.albumList.push(a); await this.saveAlbums(); return a;
  }
  async editAlbum(uid, fn) {
    const a = this.album(uid); if (!a) return;
    fn(a); a.updatedAt = Date.now(); await this.saveAlbums();
  }
  async addToAlbum(uid, songUids) { await this.editAlbum(uid, (a) => { for (const s of songUids) if (!a.songs.includes(s)) a.songs.push(s); }); }

  // ---------- search ----------
  search(query, { list = this.live(), limit = Infinity } = {}) {
    const toks = tokens(query);
    if (!toks.length) return list;
    const out = [];
    for (const s of list) {
      if (toks.every((t) => s._t.matches([t]) || s._g.matches([t]) || s._n.matches([t]))) { out.push(s); if (out.length >= limit) break; }
    }
    return out;
  }
  /** Titles that nearly match, for "Did you mean…?" */
  suggest(query, n = 4) {
    const q = key(query);
    if (q.length < 3) return [];
    return this.live().map((s) => [similarity(query, s.title), s]).filter(([sim]) => sim >= 0.5).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, s]) => s);
  }
  /** An existing song with (almost) this title, other than `exceptUid`. */
  findSame(title, exceptUid = '') {
    if (!title || title === UNTITLED) return null;
    let best = null, bestSim = 0;
    for (const s of this.songs.values()) {
      if (s.deleted || s.uid === exceptUid || s.titleState === 2 || !same(title, s.title)) continue;
      const sim = similarity(title, s.title);
      if (sim > bestSim) { best = s; bestSim = sim; }
    }
    return best;
  }
  singers() {
    const m = new Map();
    for (const s of this.live()) {
      const name = s.singer.trim();
      if (!name || s.titleState === 2) continue;
      const k = s._sk;
      const e = m.get(k) || { name, key: k, songs: [] };
      e.songs.push(s);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.songs.length - a.songs.length || a.key.localeCompare(b.key));
  }
}

/** A copy of a song without the search helpers. */
export function plainCopy(s) {
  if (!s) return null;
  const { _t, _g, _n, _k, _sk, ...rest } = s;
  return structuredClone(rest);
}

export const wait = sleep;
