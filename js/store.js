// Everything kept on this device: the settings, the list of songs (IndexedDB), saved pictures (IndexedDB), favourites etc.

const DB_NAME = 'sinhala-music-notations';
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('songs', { keyPath: 'uid' });
      db.createObjectStore('meta');
      const im = db.createObjectStore('images', { keyPath: 'file' });
      im.createIndex('at', 'at');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const out = await fn(t);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out;
}

export const idb = {
  async allSongs() { return tx('songs', 'readonly', (t) => wrap(t.objectStore('songs').getAll())); },
  async putSongs(list) { if (list.length) await tx('songs', 'readwrite', (t) => { const s = t.objectStore('songs'); list.forEach((x) => s.put(x)); }); },
  async deleteSongs(uids) { if (uids.length) await tx('songs', 'readwrite', (t) => { const s = t.objectStore('songs'); uids.forEach((u) => s.delete(u)); }); },
  async clearSongs() { await tx('songs', 'readwrite', (t) => wrap(t.objectStore('songs').clear())); },
  async getMeta(k) { return tx('meta', 'readonly', (t) => wrap(t.objectStore('meta').get(k))); },
  async setMeta(k, v) { await tx('meta', 'readwrite', (t) => wrap(t.objectStore('meta').put(v, k))); },
  async getImage(file) { return tx('images', 'readonly', (t) => wrap(t.objectStore('images').get(file))); },
  async putImage(rec) { await tx('images', 'readwrite', (t) => wrap(t.objectStore('images').put(rec))); },
  async touchImage(rec) { rec.at = Date.now(); await idb.putImage(rec); },
  async deleteImages(files) { if (files.length) await tx('images', 'readwrite', (t) => { const s = t.objectStore('images'); files.forEach((f) => s.delete(f)); }); },
  async allImageInfo() {
    return tx('images', 'readonly', (t) => new Promise((res, rej) => {
      const out = [];
      const c = t.objectStore('images').openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); const v = cur.value; out.push({ file: v.file, size: v.size || v.blob?.size || 0, at: v.at || 0, pinned: !!v.pinned }); cur.continue(); };
      c.onerror = () => rej(c.error);
    }));
  },
  async clearAll() { const db = await open(); db.close(); dbp = null; await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); }); },
};

// ---- small settings: localStorage, always wrapped because private windows can refuse ----
const mem = new Map();
export const prefs = {
  get(k, dflt = null) {
    try { const v = localStorage.getItem('nsm.' + k); return v == null ? dflt : JSON.parse(v); } catch { return mem.has(k) ? mem.get(k) : dflt; }
  },
  set(k, v) {
    mem.set(k, v);
    try { localStorage.setItem('nsm.' + k, JSON.stringify(v)); } catch { /* keep in memory only */ }
  },
  remove(k) { mem.delete(k); try { localStorage.removeItem('nsm.' + k); } catch { /* ignore */ } },
};

// ---- saved pictures ----
const SOFT_CAP = 600 * 1024 * 1024; // the oldest pictures that are not kept on purpose are removed above this

export const pictures = {
  /** Returns a Blob, from this device if saved, else null. */
  async cached(file) {
    const r = await idb.getImage(file);
    if (!r) return null;
    if (Date.now() - (r.at || 0) > 3600_000) idb.touchImage(r).catch(() => {});
    return r.blob;
  },
  async save(file, blob, { pinned = false } = {}) {
    const old = await idb.getImage(file);
    await idb.putImage({ file, blob, size: blob.size, at: Date.now(), pinned: pinned || !!old?.pinned });
    this.trim().catch(() => {});
  },
  async pin(file, on = true) { const r = await idb.getImage(file); if (r) { r.pinned = on; await idb.putImage(r); } },
  async has(file) { return !!(await idb.getImage(file)); },
  async trim() {
    const all = await idb.allImageInfo();
    let total = all.reduce((a, b) => a + b.size, 0);
    if (total <= SOFT_CAP) return;
    const victims = [];
    for (const i of all.filter((x) => !x.pinned).sort((a, b) => a.at - b.at)) { if (total <= SOFT_CAP * 0.9) break; victims.push(i.file); total -= i.size; }
    await idb.deleteImages(victims);
  },
  async usage() {
    const all = await idb.allImageInfo();
    let device = null;
    try { const e = await navigator.storage?.estimate?.(); if (e) device = { used: e.usage || 0, quota: e.quota || 0 }; } catch { /* ignore */ }
    return { count: all.length, bytes: all.reduce((a, b) => a + b.size, 0), pinned: all.filter((x) => x.pinned).length, device };
  },
  async clear({ keepPinned = false } = {}) {
    const all = await idb.allImageInfo();
    await idb.deleteImages(all.filter((x) => !(keepPinned && x.pinned)).map((x) => x.file));
  },
};
