// Adding songs: pick or drop pictures, PDFs or whole folders.
import { h } from '../util.js';
import { S, canEditSongs, go } from '../state.js';
import { prefs } from '../store.js';
import { icon, iconButton, toast, friendly, empty } from '../ui.js';
import { addToDatabase, addAsVisitor, describe, expandDrop, isImage, isPdf } from '../upload.js';

export function addView(root) {
  const lib = S.lib;
  const el = h('section', { class: 'add' }, h('div', { class: 'view-head' }, iconButton('back', 'Back', () => history.back()), h('h1', {}, 'Add songs')));
  root.append(el);
  const visitor = lib.isPublic;
  if (!canEditSongs() && !visitor) {
    el.append(empty('This device can only read', 'Ask the admin for a new database code if you would like to add songs.'));
    return () => el.remove();
  }
  let running = false;
  const status = h('p', { class: 'busy-text', 'aria-live': 'polite' });
  const bar = h('div', { class: 'bar' }, h('div', { class: 'bar-fill' }));
  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  const progress = h('div', { class: 'progress', hidden: true }, status, bar, h('button', { class: 'btn', type: 'button', onclick: () => { signal.cancelled = true; } }, 'Stop after this one'));
  let signal = { cancelled: false };
  const readTitles = h('input', { type: 'checkbox', id: 'rt', checked: prefs.get('readTitles', false) ? true : undefined, onchange: () => prefs.set('readTitles', readTitles.checked) });

  const pick = h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.pdf', hidden: true, onchange: () => start([...pick.files]) });
  const folder = h('input', { type: 'file', multiple: true, webkitdirectory: true, hidden: true, onchange: () => start([...folder.files]) });
  const drop = h('div', { class: 'dropzone', tabindex: '0' },
    icon('upload', 40),
    h('p', {}, h('strong', {}, 'Drop pictures, PDFs or folders here')),
    h('p', { class: 'muted small' }, 'or'),
    h('div', { class: 'row-actions center' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => pick.click() }, 'Choose pictures or PDFs'),
      'webkitdirectory' in pick ? h('button', { class: 'btn', type: 'button', onclick: () => folder.click() }, 'Choose a folder') : null));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); start(await expandDrop(e.dataTransfer)); });

  el.append(
    visitor ? h('div', { class: 'howto' }, h('p', {}, h('strong', {}, 'Thank you for helping! ')), h('ul', {},
      h('li', {}, 'Choose pictures or PDFs of song notations. They are sent exactly as they are, with no loss of quality.'),
      h('li', {}, 'Pictures already in the library are skipped.'),
      h('li', {}, 'Your pictures do not appear straight away. A helper first gives each one a name and checks it. This can take a day or two.'),
      h('li', {}, 'Please send only notations you are happy to share.'))) :
    h('div', { class: 'howto' }, h('ul', {},
      h('li', {}, 'Pictures are saved exactly as they are, with no loss of quality.'),
      h('li', {}, 'A picture that is already in the database is skipped automatically.'),
      h('li', {}, 'The file name becomes the song name. Pictures with the same name go into one song as extra pages.'),
      h('li', {}, 'A PDF becomes one song, with every page as a picture.'),
      h('li', {}, 'Pictures with no useful name (like IMG_1234) wait in the To-do tab so someone can name them.'))),
    drop, pick, folder,
    visitor ? null : h('label', { class: 'check-line' }, readTitles, h('span', {}, ' Try to read the name from pictures that have no file name (slow, not always right)')),
    progress, result);

  async function start(files) {
    if (running) return;
    const usable = files.filter((f) => isImage(f) || isPdf(f));
    if (!usable.length) { toast('No pictures or PDFs were found there.', { error: true }); return; }
    running = true; signal = { cancelled: false }; result.replaceChildren(); progress.hidden = false; drop.hidden = true;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    try {
      const common = {
        onStatus: (t) => { status.textContent = t; },
        onProgress: (d, t) => { bar.firstChild.style.width = `${(d / Math.max(1, t)) * 100}%`; },
      };
      const r = visitor ? await addAsVisitor(lib, files, { ...common, signal }) : await addToDatabase(lib, files, { ...common, readTitles: readTitles.checked, signal });
      progress.hidden = true;
      result.replaceChildren(h('div', { class: 'card done' }, icon('check', 28), h('div', {}, h('strong', {}, r.stopped ? 'Stopped' : 'Done'), h('p', {}, visitor ? visitorSummary(r) : `${r.pictures} picture${r.pictures === 1 ? '' : 's'} added. ${describe(r)}`))),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { result.replaceChildren(); drop.hidden = false; } }, 'Add more'),
          !visitor && r.todo ? h('button', { class: 'btn', type: 'button', onclick: () => go('#/todo') }, 'Open To-do') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => go('#/songs') }, 'Go to songs')));
    } catch (e) {
      progress.hidden = true; drop.hidden = false;
      result.replaceChildren(h('div', { class: 'card error' }, h('p', {}, friendly(e)), h('p', { class: 'muted small' }, 'What was already saved stays in the database. Pictures that are already there are skipped, so you can safely choose the same files again.')));
    } finally { running = false; window.removeEventListener('beforeunload', warn); }
  }
  return () => { signal.cancelled = true; el.remove(); };
}

function visitorSummary(r) {
  const bits = [];
  if (r.pictures) bits.push(`${r.pictures} picture${r.pictures === 1 ? '' : 's'} sent. A helper will name and check ${r.pictures === 1 ? 'it' : 'them'} before ${r.pictures === 1 ? 'it appears' : 'they appear'} in the library.`);
  if (r.duplicates) bits.push(`${r.duplicates} skipped because ${r.duplicates === 1 ? 'it was' : 'they were'} already in the library.`);
  if (r.unreadable) bits.push(`${r.unreadable} could not be read.`);
  return bits.join(' ') || 'Nothing new to send.';
}
