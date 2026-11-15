// The To-do tab: pictures that came in without a song name. Anyone can name them; only the admin can delete.
import { h, plural } from '../util.js';
import { S, openSong, isAdmin, canEditSongs, go } from '../state.js';
import { icon, toast, confirmBox, empty, friendly, chip } from '../ui.js';
import { similarity } from '../phonetic.js';
import { prefs } from '../store.js';

export function todoTab(root) {
  const lib = S.lib;
  let idx = 0;
  let pageNo = 0;
  let url = '';
  let busyNow = false;
  const el = h('section', { class: 'todo' });
  root.append(el);

  const queue = () => lib.todo().filter((s) => isAdmin() || !lib.isNotSong(s)).sort((a, b) => a.createdAt - b.createdAt);

  function draw() {
    const q = queue();
    const flagged = lib.todo().filter((s) => lib.isNotSong(s));
    el.replaceChildren();
    el.append(h('div', { class: 'view-head' }, h('h1', {}, 'To-do')));
    el.append(h('details', { class: 'howto', open: q.length > 0 && !prefs.get('todoHelpSeen', false) ? true : undefined },
      h('summary', {}, 'What is this, and what do I do?'),
      h('div', {},
        h('p', {}, h('strong', {}, 'Why? '), 'These pictures were added without a song name. Until someone names them, nobody can find them by searching.'),
        h('ol', {}, h('li', {}, 'Look at the picture. The song name is usually written at the top.'), h('li', {}, 'Type the name in the box. English or Sinhala letters are both fine.'), h('li', {}, 'Press “Save and next”. That is all.')),
        h('p', {}, 'If the picture is not a song (a photo, a blank page, or only words), press “This is not a song”. The admin will check it. If you are not sure, press “Skip”.'))));
    prefs.set('todoHelpSeen', true);
    if (!canEditSongs()) { el.append(empty('You can look, but not change', 'Ask the admin for a new database code if you want to help name these pictures.')); }
    if (!q.length) {
      el.append(empty('Nothing to do. Thank you!', flagged.length && !isAdmin() ? `${plural(flagged.length, 'picture')} you marked are waiting for the admin.` : 'Every picture has a name.'));
    } else {
      if (idx >= q.length) idx = 0;
      el.append(card(q[idx], q.length));
      el.append(h('h3', { class: 'section' }, `Waiting (${q.length})`));
      el.append(h('ul', { class: 'songs' }, q.slice(0, 200).map((s, i) => h('li', { class: `row${i === idx ? ' selected' : ''}` },
        h('button', { class: 'row-main', type: 'button', onclick: () => { idx = i; pageNo = 0; draw(); } },
          h('span', { class: 'row-title' }, s.sourceName || 'Picture'), h('span', { class: 'row-sub muted' }, `${plural(s.pages.length, 'page')}${lib.isNotSong(s) ? ' · marked as not a song' : ''}`))))));
    }
  }

  function card(s, total) {
    const img = h('img', { class: 'todo-img', alt: 'The picture that needs a name', draggable: 'false' });
    const note = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const hint = h('div', { class: 'chips', 'aria-label': 'Songs with a similar name' });
    const title = h('input', { type: 'text', class: 'field', placeholder: 'Song name (as written on the picture)', 'aria-label': 'Song name', autocomplete: 'off', enterkeyhint: 'done' });
    const singer = h('input', { type: 'text', class: 'field', placeholder: 'Singer (if you know; can be empty)', 'aria-label': 'Singer', autocomplete: 'off' });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: doSave }, 'Save and next');
    const pager = s.pages.length > 1 ? h('div', { class: 'pager' },
      h('button', { class: 'btn small', type: 'button', disabled: pageNo === 0, onclick: () => { pageNo--; draw(); } }, '‹ Earlier page'),
      h('span', { class: 'muted small' }, `Page ${pageNo + 1} of ${s.pages.length}`),
      h('button', { class: 'btn small', type: 'button', disabled: pageNo >= s.pages.length - 1, onclick: () => { pageNo++; draw(); } }, 'Next page ›')) : null;

    (async () => {
      try {
        const blob = await lib.image(s.pages[pageNo]?.file);
        const u = URL.createObjectURL(blob);
        if (url) URL.revokeObjectURL(url);
        url = u; img.src = u; img.style.transform = `rotate(${s.pages[pageNo].rotation || 0}deg)`;
      } catch (e) { note.textContent = friendly(e); }
    })();

    const suggest = () => {
      const v = title.value.trim();
      hint.replaceChildren();
      note.textContent = '';
      if (v.length < 3) return;
      const near = lib.live().filter((x) => x.titleState !== 2 && x.uid !== s.uid).map((x) => [similarity(v, x.title), x]).filter(([sim]) => sim >= 0.55).sort((a, b) => b[0] - a[0]).slice(0, 5);
      if (near.length) {
        hint.append(h('span', { class: 'muted small' }, 'Already in the database: '), ...near.map(([, x]) => chip(x.title, { onClick: () => { title.value = x.title; if (!singer.value) singer.value = x.singer; suggest(); } })));
        if (lib.findSame(v, s.uid)) note.textContent = 'A song with this name is already there. These pictures will be added to it as extra pages.';
      }
    };
    title.addEventListener('input', suggest);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });

    async function doSave() {
      const t = title.value.trim();
      if (t.length < 2) { toast('Please type the song name first.', { error: true }); title.focus(); return; }
      if (busyNow) return; busyNow = true; save.disabled = true; save.textContent = 'Saving…';
      try {
        const r = await lib.nameSong(s.uid, t, singer.value.trim());
        toast(r.merged ? 'Saved. Added to the song that was already there.' : 'Saved. Thank you!');
        pageNo = 0; draw();
      } catch (e) { toast(friendly(e), { error: true }); save.disabled = false; save.textContent = 'Save and next'; } finally { busyNow = false; }
    }
    const flag = lib.isNotSong(s);
    return h('div', { class: 'todo-card' },
      h('p', { class: 'muted small' }, `${total} left${s.sourceName ? ` · file name: ${s.sourceName}` : ''}`),
      h('button', { class: 'todo-view', type: 'button', 'aria-label': 'Open the picture full screen', onclick: () => openSong(s.uid, [s.uid], 'To-do') }, img),
      pager,
      h('label', { class: 'lbl' }, 'What is the name of this song?'), title, hint, note,
      h('label', { class: 'lbl' }, 'Singer (optional)'), singer,
      h('div', { class: 'row-actions' }, canEditSongs() ? save : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { idx++; pageNo = 0; draw(); } }, 'Skip'),
        canEditSongs() && !flag ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await lib.setNotSong(s.uid, true); toast('Marked. The admin will check it.'); pageNo = 0; draw(); } catch (e) { toast(friendly(e), { error: true }); } } }, 'This is not a song') : null,
        canEditSongs() && flag ? h('button', { class: 'btn', type: 'button', onclick: async () => { await lib.setNotSong(s.uid, false); draw(); } }, 'It is a song after all') : null,
        isAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox('Delete this picture?', 'It will be removed from the database for everyone.', { yes: 'Delete', danger: true })) { try { await lib.deleteSong(s.uid); toast('Deleted'); pageNo = 0; draw(); } catch (e) { toast(friendly(e), { error: true }); } } } }, icon('trash', 16), ' Delete') : null));
  }

  const onChange = () => { const a = document.activeElement; if (!busyNow && !(a && a.tagName === 'INPUT' && el.contains(a))) draw(); };
  lib.addEventListener('change', onChange);
  draw();
  void go;
  return () => { lib.removeEventListener('change', onChange); if (url) URL.revokeObjectURL(url); el.remove(); };
}
