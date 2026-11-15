// Starts the app: first-visit guide, the first download, the tabs, and keeping the database up to date.
import { h, ago, plural } from './util.js';
import { S, go, isAdmin } from './state.js';
import { Library } from './library.js';
import { prefs, idb } from './store.js';
import { icon, toast, dialog, busy, friendly } from './ui.js';
import { guide } from './views/guide.js';
import { songsTab, singersTab, singerPage } from './views/songs.js';
import { albumsTab, albumPage } from './views/albums.js';
import { todoTab } from './views/todo.js';
import { addView } from './views/add.js';
import { editor } from './views/editor.js';
import { viewer } from './views/viewer.js';
import { settingsView, feedbackView, helpView, downloadAll } from './views/settings.js';

const app = document.getElementById('app');
let main, chip, nav, overlayRoot;
let baseRoute = '', baseDispose = null, viewerDispose = null;
let pausedUntil = 0;

const TABS = [['songs', 'Songs', 'music'], ['singers', 'Singers', 'users'], ['albums', 'Albums', 'album'], ['todo', 'To-do', 'todo'], ['settings', 'Settings', 'settings']];

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const cfg = prefs.get('cfg');
  if (!cfg) { showGuide(); return; }
  await start(cfg, { first: false });
}

function showGuide() {
  guide(app, async (cfg, keepAll) => { await start(cfg, { first: true, keepAll }); });
}

async function start(cfg, { first, keepAll }) {
  S.cfg = cfg;
  const lib = new Library(cfg);
  S.lib = lib;
  await lib.loadLocal();
  buildShell();
  window.addEventListener('hashchange', route);
  lib.addEventListener('change', updateBadge);
  if (!lib.meta.commit || lib.songs.size === 0) {
    const ok = await firstDownload();
    if (!ok) return;
    if (first ? keepAll : prefs.get('keepAll', false)) await downloadAll(lib, lib.live().flatMap((s) => s.pages.map((p) => p.file)));
  } else backgroundSync();
  route();
  scheduleSync();
}

function buildShell() {
  chip = h('button', { class: 'syncchip', type: 'button', onclick: () => doSync({ silent: false }) });
  main = h('main', { id: 'main', tabindex: '-1' });
  nav = h('nav', { class: 'tabs', 'aria-label': 'Main' }, TABS.map(([id, label, ic]) => h('a', { href: `#/${id}`, 'data-tab': id, class: 'tab' }, icon(ic, 24), h('span', {}, label), id === 'todo' ? h('b', { class: 'badge', hidden: true }) : null)));
  overlayRoot = h('div', { id: 'overlay-root' });
  app.replaceChildren(h('div', { class: 'shell' }, h('header', { class: 'topbar' }, h('div', { class: 'brand' }, icon('music', 22), h('span', {}, 'Sinhala Music Notations')), chip), main, nav), overlayRoot);
  updateChip();
}

async function firstDownload() {
  const lib = S.lib;
  for (;;) {
    const b = busy('Getting your songs', {});
    b.set('Connecting…', 0, 0);
    try {
      await lib.sync(({ phase, done, total }) => b.set(phase, done, total));
      b.close();
      if (lib.isEmpty) {
        const again = await dialog({ title: 'The database looks empty', body: [h('p', {}, 'No songs were found. The database code may be wrong or out of date.')], dismissible: false,
          actions: [{ label: 'Use another code', value: 'other' }, { label: 'Try again', primary: true, value: 'again' }] });
        if (again === 'other') { disconnect(); return false; }
        continue;
      }
      return true;
    } catch (e) {
      b.close();
      const r = await dialog({ title: 'Could not get the songs', body: [h('p', {}, friendly(e))], dismissible: false,
        actions: [{ label: 'Use another code', value: 'other' }, { label: 'Try again', primary: true, value: 'again' }] });
      if (r === 'other') { disconnect(); return false; }
    }
  }
}

export async function disconnect() {
  prefs.remove('cfg');
  await idb.clearAll();
  location.hash = '';
  location.reload();
}

// ---------- keeping up to date ----------
async function doSync({ silent }) {
  const lib = S.lib;
  if (S.syncing) return;
  if (!navigator.onLine) { if (!silent) toast('You are offline. Showing what is saved on this device.'); updateChip(); return; }
  if (Date.now() < pausedUntil) { if (!silent) toast(friendly({ resetAt: pausedUntil }), { error: true }); return; }
  S.syncing = true; S.lastError = ''; updateChip('Updating…');
  try {
    const r = await lib.sync(({ phase, done, total }) => { if (total) updateChip(`Updating ${done}/${total}`); });
    if (!silent) toast(r.total ? `Got ${plural(r.total, 'new or changed song')}.` : 'Everything is up to date.');
  } catch (e) {
    if (e?.resetAt) pausedUntil = e.resetAt;
    S.lastError = friendly(e);
    if (!silent) toast(S.lastError, { error: true, ms: 6000 });
  } finally { S.syncing = false; updateChip(); updateBadge(); }
}
const backgroundSync = () => doSync({ silent: true });
function scheduleSync() {
  const every = () => { if (document.visibilityState === 'visible' && Date.now() - (S.lib.meta.syncedAt || 0) > 4 * 60_000) backgroundSync(); };
  setInterval(every, 60_000);
  document.addEventListener('visibilitychange', every);
  window.addEventListener('online', () => { backgroundSync(); });
  window.addEventListener('offline', () => updateChip());
  setInterval(() => updateChip(), 30_000);
}
function updateChip(text) {
  if (!chip) return;
  let label, cls = '';
  if (text) { label = text; cls = 'busy'; } else if (!navigator.onLine) { label = 'Offline'; cls = 'off'; } else if (S.lastError) { label = 'Tap to retry'; cls = 'err'; } else label = S.lib?.meta.syncedAt ? ago(S.lib.meta.syncedAt) : 'not yet';
  const long = !text && navigator.onLine && !S.lastError ? 'Updated ' : '';
  chip.className = `syncchip ${cls}`;
  chip.replaceChildren(icon(cls === 'off' ? 'wifi' : 'refresh', 15), ' ', long ? h('span', { class: 'long' }, long) : '', label);
  chip.title = S.lastError || 'Check for new songs';
}
function updateBadge() {
  const b = nav?.querySelector('.badge');
  if (!b) return;
  const n = S.lib.todo().filter((s) => isAdmin() || !S.lib.isNotSong(s)).length;
  b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
}

// ---------- routes ----------
function route() {
  const lib = S.lib;
  const hash = location.hash.replace(/^#\/?/, '') || 'songs';
  const [name, arg] = hash.split('/').map(decodeURIComponent);
  updateBadge();
  if (name === 'song') {
    if (!baseDispose) mountBase('songs');
    viewerDispose?.(); viewerDispose = null;
    nav.hidden = true; main.hidden = true;
    viewerDispose = viewer(overlayRoot, arg);
    return;
  }
  if (viewerDispose) { viewerDispose(); viewerDispose = null; }
  nav.hidden = false; main.hidden = false;
  if (hash !== baseRoute || !baseDispose) mountBase(hash, name, arg);
  void lib;
}

function mountBase(hash, name, arg) {
  if (!name) [name, arg] = hash.split('/').map(decodeURIComponent);
  baseDispose?.();
  main.replaceChildren();
  window.scrollTo(0, 0);
  const tab = { singer: 'singers', album: 'albums', add: 'songs', edit: 'songs', feedback: 'settings', help: 'settings' }[name] || name;
  nav.querySelectorAll('.tab').forEach((a) => { a.classList.toggle('active', a.dataset.tab === tab); a.toggleAttribute('aria-current', a.dataset.tab === tab); });
  const views = {
    songs: () => songsTab(main), singers: () => singersTab(main), singer: () => singerPage(main, arg), albums: () => albumsTab(main), album: () => albumPage(main, arg),
    todo: () => todoTab(main), add: () => addView(main), edit: () => editor(main, arg), settings: () => settingsView(main, { syncNow: () => doSync({ silent: false }), disconnect }),
    feedback: () => feedbackView(main), help: () => helpView(main),
  };
  baseDispose = (views[name] || views.songs)();
  baseRoute = hash;
  document.title = 'Sinhala Music Notations';
}

boot().catch((e) => { console.error(e); app.replaceChildren(h('div', { class: 'guide' }, h('div', { class: 'guide-card' }, h('h1', {}, 'Something went wrong'), h('p', {}, String(e?.message || e)), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload')))); });
void go;
