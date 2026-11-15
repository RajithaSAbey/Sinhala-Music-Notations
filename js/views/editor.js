// Everything about one song: name, singer, notes, pages (order, turn, add), links to chords or lyrics.
import { h, sha256, uuid, text } from '../util.js';
import { S, isAdmin, canEditSongs, go } from '../state.js';
import { icon, iconButton, toast, confirmBox, friendly, empty, singerField } from '../ui.js';
import { parseSong, plainCopy, UNTITLED } from '../library.js';
import { pictureBytes, isImage } from '../upload.js';

export function editor(root, uid) {
  const lib = S.lib;
  const song = lib.get(uid);
  if (!song || !canEditSongs()) { go('#/songs'); return () => {}; }
  const original = new Set(song.pages.map((p) => p.file));
  let pages = song.pages.map((p) => ({ ...p }));
  let links = song.links.map((l) => ({ ...l }));
  const added = new Map(); // file -> bytes
  const urls = new Map();

  const title = h('input', { type: 'text', class: 'field', value: song.title === UNTITLED ? '' : song.title, 'aria-label': 'Song name', autocomplete: 'off' });
  const singerBox = singerField(lib, { value: song.singer });
  const singer = singerBox.input;
  const notes = h('textarea', { class: 'field', rows: '3', 'aria-label': 'Notes' }, song.notes);
  const pageBox = h('div', { class: 'pages' });
  const linkBox = h('div', { class: 'links' });
  const save = h('button', { class: 'btn primary', type: 'button', onclick: doSave }, 'Save');
  const adder = h('input', { type: 'file', multiple: true, accept: 'image/*', hidden: true, onchange: addPages });

  const el = h('section', { class: 'editor' },
    h('div', { class: 'view-head' }, iconButton('back', 'Back', () => history.back()), h('h1', {}, 'Edit song')),
    h('label', { class: 'lbl' }, 'Song name'), title, h('label', { class: 'lbl' }, 'Singer'), singerBox.el, h('label', { class: 'lbl' }, 'Notes'), notes,
    h('h3', { class: 'section' }, 'Pages'), pageBox,
    h('div', { class: 'row-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => adder.click() }, icon('plus', 16), ' Add pictures'), adder),
    h('h3', { class: 'section' }, 'Links (chords or lyrics on the web)'), linkBox,
    h('div', { class: 'row-actions sticky' }, save, h('button', { class: 'btn', type: 'button', onclick: () => history.back() }, 'Cancel')));
  root.append(el);

  function drawPages() {
    pageBox.replaceChildren(...(pages.length ? pages.map((p, i) => {
      const img = h('img', { class: 'thumb', alt: `Page ${i + 1}`, style: { transform: `rotate(${p.rotation || 0}deg)${(p.rotation || 0) % 180 ? ' scale(0.76)' : ''}` } });
      load(p.file).then((u) => { img.src = u; }).catch(() => {});
      return h('div', { class: 'page-item' }, h('div', { class: 'thumb-box' }, img), h('div', { class: 'page-actions' },
        h('span', { class: 'muted small' }, `Page ${i + 1}`),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Turn', onclick: () => { p.rotation = ((p.rotation || 0) + 90) % 360; drawPages(); } }, icon('rotate', 18)),
        h('button', { class: 'iconbtn rot', type: 'button', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; drawPages(); } }, icon('down', 18)),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Move later', disabled: i === pages.length - 1, onclick: () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; drawPages(); } }, icon('down', 18)),
        isAdmin() ? h('button', { class: 'iconbtn danger', type: 'button', 'aria-label': 'Remove this page', onclick: async () => { if (await confirmBox('Remove this page?', 'It is removed from this song when you press Save.', { yes: 'Remove', danger: true })) { pages.splice(i, 1); drawPages(); } } }, icon('trash', 18)) : null));
    }) : [empty('No pages', 'Add pictures below.')]));
  }
  async function load(file) {
    if (urls.has(file)) return urls.get(file);
    const bytes = added.get(file);
    const blob = bytes ? new Blob([bytes], { type: 'image/jpeg' }) : await lib.image(file);
    const u = URL.createObjectURL(blob);
    urls.set(file, u);
    return u;
  }
  async function addPages() {
    for (const f of [...adder.files].filter(isImage)) {
      try {
        const bytes = await pictureBytes(f);
        const hash = await sha256(bytes);
        if (lib.hashes.has(hash) || pages.some((p) => p.hash === hash)) { toast(`${f.name} is already in the database.`); continue; }
        const file = `${uuid()}.jpg`;
        added.set(file, bytes);
        pages.push({ file, rotation: 0, hash });
      } catch { toast(`${f.name} could not be read.`, { error: true }); }
    }
    adder.value = '';
    drawPages();
  }
  function drawLinks() {
    linkBox.replaceChildren(...links.map((l, i) => {
      const kind = h('select', { class: 'field small', 'aria-label': 'Kind', onchange: () => { l.kind = kind.value; } }, ['chords', 'lyrics', 'other'].map((k) => h('option', { value: k, selected: l.kind.toLowerCase() === k ? true : undefined }, k[0].toUpperCase() + k.slice(1))));
      return h('div', { class: 'link-item' }, kind,
        h('input', { type: 'text', class: 'field', value: l.title, placeholder: 'Name', 'aria-label': 'Link name', oninput: (e) => { l.title = e.target.value; } }),
        h('input', { type: 'url', class: 'field', value: l.url, placeholder: 'https://…', 'aria-label': 'Link address', oninput: (e) => { l.url = e.target.value.trim(); } }),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove link', onclick: () => { links.splice(i, 1); drawLinks(); } }, icon('x', 18)));
    }), h('button', { class: 'btn', type: 'button', onclick: () => { links.push({ kind: 'chords', title: '', url: '' }); drawLinks(); } }, icon('plus', 16), ' Add a link'));
  }

  async function doSave() {
    const t = title.value.trim();
    if (!t) { toast('Please give the song a name.', { error: true }); title.focus(); return; }
    const bad = links.find((l) => l.url && !/^https?:\/\//i.test(l.url));
    if (bad) { toast('Links must start with https://', { error: true }); return; }
    save.disabled = true; save.textContent = 'Saving…';
    try {
      const f = await lib.repo.fileWithSha(lib.repo.path(`songs/${uid}.json`));
      const base = f ? parseSong(text(f.bytes), f.sha) : plainCopy(lib.get(uid));
      const remoteOnly = base.pages.filter((p) => !original.has(p.file));
      const keepFiles = new Set(pages.map((p) => p.file));
      base.title = t; base.singer = singer.value.trim(); base.notes = notes.value.trim();
      base.titleState = 0;
      base.links = links.filter((l) => l.url).map((l) => ({ kind: l.kind, title: l.title || l.url, url: l.url }));
      base.pages = [...pages.map((p) => ({ file: p.file, rotation: p.rotation || 0, hash: p.hash || '' })), ...remoteOnly.filter((p) => !keepFiles.has(p.file))];
      base.updatedAt = Math.max(Date.now(), base.updatedAt + 1);
      await lib.commitChanges([base], [...added].filter(([file]) => keepFiles.has(file)).map(([file, bytes]) => ({ file, bytes })), 'Edit a song');
      toast('Saved');
      history.back();
    } catch (e) { toast(friendly(e), { error: true }); save.disabled = false; save.textContent = 'Save'; }
  }

  drawPages(); drawLinks();
  return () => { urls.forEach((u) => URL.revokeObjectURL(u)); el.remove(); };
}
