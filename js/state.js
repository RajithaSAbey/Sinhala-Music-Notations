// Shared app state and the small things kept per device (favourites, recently opened).
import { prefs } from './store.js';

export const S = {
  lib: null,
  cfg: null,
  /** The list the viewer steps through: { uids: [...], name } */
  ctx: null,
  syncing: false,
  lastError: '',
  /** Set by main.js: opens the 'I have a database code' steps. */
  signIn: null,
};

export const favs = {
  list() { return prefs.get('favs', []); },
  has(uid) { return this.list().includes(uid); },
  toggle(uid) {
    const l = this.list();
    const i = l.indexOf(uid);
    if (i >= 0) l.splice(i, 1); else l.push(uid);
    prefs.set('favs', l);
    return i < 0;
  },
};

export const recents = {
  /** uid -> last opened (ms) */
  map() { return prefs.get('opened', {}); },
  add(uid) {
    const m = this.map();
    m[uid] = Date.now();
    const keep = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 300);
    prefs.set('opened', Object.fromEntries(keep));
  },
  list(n = 50) { return Object.entries(this.map()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([u]) => u); },
};

export const canEditSongs = () => S.lib?.role === 'admin' || S.lib?.role === 'member';
export const isAdmin = () => S.lib?.role === 'admin';

export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
/**
 * Opens the reader. Turning pages only ever moves inside this song, unless the song is opened from an album (a set list):
 * then going past the last page continues with the next song of the album.
 */
export function openSong(uid, uids, name = '', { setList = false } = {}) {
  S.ctx = { uids: uids || [uid], name, setList };
  location.hash = `#/song/${uid}`;
}
