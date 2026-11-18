// Albums and set lists: your own lists of songs, in your own order. Optionally kept on this device for use without internet.
import { h, plural } from '../util.js';
import { S, go, openSong, isAdmin } from '../state.js';
import { icon, iconButton, dialog, askText, confirmBox, toast, empty, busy, friendly } from '../ui.js';
import { pictures } from '../store.js';

export async function pickAlbum() {
  const lib = S.lib;
  return dialog({
    title: 'Add to which album?',
    body: (done) => [h('div', { class: 'stack' },
      lib.albums().map((a) => h('button', { class: 'btn block', type: 'button', onclick: () => done(a) }, `${a.name} · ${plural(a.songs.length, 'song')}`)),
      h('button', { class: 'btn block primary', type: 'button', onclick: async () => { const name = await askText('New album', { label: 'Album name', placeholder: 'For example: Sunday set list', yes: 'Create' }); if (name) done(await lib.createAlbum(name)); } }, '+ New album'))],
    actions: [{ label: 'Cancel', value: null }],
  });
}

export function albumsTab(root) {
  const lib = S.lib;
  const list = h('div', { class: 'cards' });
  const el = h('section', {}, h('div', { class: 'view-head' }, h('h1', {}, 'Albums'),
    h('button', { class: 'btn primary', type: 'button', onclick: async () => { const n = await askText('New album', { label: 'Album name', placeholder: 'For example: Sunday set list', yes: 'Create' }); if (n) { const a = await lib.createAlbum(n); go(`#/album/${a.uid}`); } } }, '+ New')),
    h('p', { class: 'muted small' }, isAdmin() ? 'Your albums are shared between your devices.' : 'Albums are kept on this device only.'), list);
  root.append(el);
  const draw = () => {
    const as = lib.albums().sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...(as.length ? as.map((a) => h('button', { class: 'card', type: 'button', onclick: () => go(`#/album/${a.uid}`) }, icon('album', 26), h('span', { class: 'card-main' }, h('strong', {}, a.name), h('span', { class: 'muted small' }, plural(lib.albumOrder(a).length, 'song'))), icon('next', 18))) : [empty('No albums yet', 'Make an album for a set list, a class, or a favourite singer. Then add songs from the Songs tab with “Select”.')]));
  };
  draw();
  lib.addEventListener('change', draw);
  return () => { lib.removeEventListener('change', draw); el.remove(); };
}

export function albumPage(root, uid) {
  const lib = S.lib;
  const a = lib.album(uid);
  if (!a || a.deleted) { go('#/albums'); return () => {}; }
  const list = h('ol', { class: 'songs ordered' });
  const info = h('p', { class: 'muted small' });
  const el = h('section', {}, h('div', { class: 'view-head' }, iconButton('back', 'Back', () => history.back()), h('h1', {}, a.name),
    iconButton('more', 'Album options', () => options())), info, list);
  root.append(el);

  const draw = () => {
    const songs = lib.albumOrder(lib.album(uid));
    info.textContent = `${plural(songs.length, 'song')} · tap a song to start; Next goes to the following song in this list.`;
    list.replaceChildren(...(songs.length ? songs.map((s, i) => h('li', { class: 'row' },
      h('button', { class: 'row-main', type: 'button', onclick: () => openSong(s.uid, songs.map((x) => x.uid), a.name, { setList: true }) }, h('span', { class: 'row-title' }, `${i + 1}. ${s.title}`), h('span', { class: 'row-sub muted' }, s.singer || ' ')),
      upBtn(songs, i),
      downBtn(songs, i),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Take out of this album', onclick: async () => { await lib.editAlbum(uid, (x) => { x.songs = x.songs.filter((u) => u !== s.uid); }); } }, icon('x', 18)))) : [empty('This album is empty', 'Go to Songs, tap “Select”, choose songs and press “Add to album”.')]));
  };
  const upBtn = (songs, i) => h('button', { class: 'iconbtn rot', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(songs, i, -1) }, icon('down', 18));
  const downBtn = (songs, i) => h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Move down', disabled: i === songs.length - 1, onclick: () => move(songs, i, 1) }, icon('down', 18));
  function move(songs, i, d) {
    const uids = songs.map((s) => s.uid);
    [uids[i], uids[i + d]] = [uids[i + d], uids[i]];
    lib.setAlbumOrder(a, uids);
    draw();
  }
  async function options() {
    const act = await dialog({
      title: a.name,
      body: (done) => [h('div', { class: 'stack' },
        h('button', { class: 'btn block', type: 'button', onclick: () => done('keep') }, 'Keep these songs on this device (use without internet)'),
        h('button', { class: 'btn block', type: 'button', onclick: () => done('rename') }, 'Rename the album'),
        h('button', { class: 'btn block danger', type: 'button', onclick: () => done('delete') }, 'Delete the album (songs stay in the database)'))],
      actions: [{ label: 'Close', value: null }],
    });
    if (act === 'rename') { const n = await askText('Rename the album', { value: a.name, label: 'Album name' }); if (n) { await lib.editAlbum(uid, (x) => { x.name = n; }); el.querySelector('h1').textContent = n; } }
    if (act === 'delete' && await confirmBox('Delete this album?', 'The songs themselves stay in the database.', { yes: 'Delete album', danger: true })) { await lib.editAlbum(uid, (x) => { x.deleted = true; }); history.back(); }
    if (act === 'keep') await keep();
  }
  async function keep() {
    const files = lib.albumOrder(lib.album(uid)).flatMap((s) => s.pages.map((p) => p.file));
    let stop = false;
    const b = busy('Saving pictures on this device', { cancel: () => { stop = true; } });
    let n = 0, failed = 0;
    try {
      for (const f of files) {
        if (stop) break;
        try { await lib.image(f, { keep: true }); } catch (e) { if (e?.resetAt) { b.close(); toast(friendly(e), { error: true }); return; } failed++; }
        b.set('Downloading the pictures…', ++n, files.length);
      }
    } finally { b.close(); }
    toast(failed ? `Saved ${n - failed} pictures; ${failed} could not be saved.` : stop ? 'Stopped. Pictures saved so far stay on this device.' : 'Done. This album works without internet now.', { ms: 4500 });
    void pictures;
  }
  draw();
  lib.addEventListener('change', draw);
  return () => { lib.removeEventListener('change', draw); el.remove(); };
}
