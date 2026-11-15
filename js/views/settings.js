// Settings, feedback to the admin, and help.
import { h, ago, plural } from '../util.js';
import { S, isAdmin, go } from '../state.js';
import { prefs, pictures, idb } from '../store.js';
import { create } from '../setupcode.js';
import { icon, iconButton, toast, dialog, confirmBox, busy, friendly, fmtBytes } from '../ui.js';

const VERSION = '1.0';

export function settingsView(root, { syncNow, disconnect }) {
  const lib = S.lib;
  const usage = h('p', { class: 'muted' }, 'Counting…');
  const el = h('section', { class: 'settings' }, h('div', { class: 'view-head' }, h('h1', {}, 'Settings')));
  root.append(el);
  const role = lib.isPublic ? 'Public library: you can read every song and send new pictures. Naming pictures and everything else needs a helper code from the admin.' : { admin: 'Admin: you can do everything', member: 'Helper: you can add songs and name pictures', reader: 'Reader: you can look at songs (adding is switched off)' }[lib.role];
  const group = (title, ...kids) => h('div', { class: 'group' }, h('h3', {}, title), ...kids);
  const row = (label, hint, action) => h('div', { class: 'srow' }, h('div', {}, h('strong', {}, label), hint ? h('div', { class: 'muted small' }, hint) : null), action);
  const btn = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);

  el.append(...[
    group(lib.isPublic ? 'The public library' : 'Your database', h('p', {}, role), h('p', { class: 'muted' }, `${plural(lib.live().length, 'song')} · last checked ${ago(lib.meta.syncedAt)}`), btn('Check for new songs now', syncNow, 'primary'), lib.isPublic ? btn('I have a database code', () => S.signIn()) : null),
    group('Pictures on this device', usage,
      btn('Save every picture for use without internet', saveAll),
      btn('Remove the saved pictures', async () => { if (await confirmBox('Remove saved pictures?', 'They are only removed from this device. You can load them again whenever you open a song.', { yes: 'Remove' })) { await pictures.clear(); await showUsage(); toast('Removed'); } })),
    isAdmin() ? group('Share with helpers', h('p', { class: 'muted' }, 'Helpers can add songs and name pictures, but cannot delete anything. Send them this code, and tell them to keep it private.'), btn('Copy the helper code', copyHelper)) : null,
    group('Help and feedback', lib.isPublic ? null : btn('Send a message to the admin', () => go('#/feedback')), btn('How to use this app and add it to your home screen', () => go('#/help'))),
    lib.isPublic ? null : group('This device', btn('Disconnect from the database', async () => {
      if (await confirmBox('Disconnect?', 'This forgets the database code and removes the songs and pictures saved on this device. The database itself is not touched. You will need the code again to reconnect.', { yes: 'Disconnect', danger: true })) disconnect();
    }, 'danger')),
    h('p', { class: 'muted small center' }, `Sinhala Music Notations ${VERSION}`)].filter(Boolean));

  async function showUsage() {
    const u = await pictures.usage();
    usage.textContent = `${plural(u.count, 'picture')} saved on this device (${fmtBytes(u.bytes)})${u.pinned ? `, ${u.pinned} kept on purpose` : ''}.${u.device?.quota ? ` This browser allows about ${fmtBytes(u.device.quota)}.` : ''}`;
  }
  async function saveAll() {
    const files = lib.live().flatMap((s) => s.pages.map((p) => p.file));
    if (!(await confirmBox('Save every picture?', `There are ${files.length.toLocaleString()} pictures. This can take a long time and use a lot of space. You can stop at any time.`, { yes: 'Start' }))) return;
    await downloadAll(lib, files);
    showUsage();
  }
  async function copyHelper() {
    const c = S.cfg;
    const code = create({ repo: c.repo, branch: c.branch, folder: c.folder, token: c.token, member: true });
    try { await navigator.clipboard.writeText(code); toast('Copied. Paste it into a message to your helper.'); } catch {
      await dialog({ title: 'Helper code', body: [h('p', {}, 'Copy this code:'), h('textarea', { class: 'field code', rows: '5', readonly: true, onfocus: (e) => e.target.select() }, code)] });
    }
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  showUsage();
  return () => el.remove();
}

/** Downloads pictures with a Stop button; pauses cleanly when GitHub asks to slow down. */
export async function downloadAll(lib, files) {
  let stop = false;
  const b = busy('Saving pictures on this device', { cancel: () => { stop = true; } });
  let n = 0, failed = 0;
  try {
    const todo = [];
    for (const f of files) if (!(await pictures.has(f))) todo.push(f); else n++;
    let next = 0;
    b.set('Downloading the pictures…', n, files.length);
    const worker = async () => {
      while (next < todo.length && !stop) {
        const f = todo[next++];
        try { await lib.image(f, { keep: true }); } catch (e) { if (e?.resetAt) { stop = true; toast(friendly(e), { error: true, ms: 7000 }); return; } failed++; }
        b.set(null, ++n, files.length);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally { b.close(); }
  toast(failed ? `${failed} pictures could not be saved.` : stop ? 'Stopped. What was saved stays on this device.' : 'Done. Every picture is saved on this device.', { ms: 5000 });
}

export function feedbackView(root) {
  const lib = S.lib;
  const el = h('section', { class: 'feedback' }, h('div', { class: 'view-head' }, iconButton('back', 'Back', () => history.back()), h('h1', {}, 'Message to the admin')));
  root.append(el);
  if (lib.role === 'reader') { el.append(h('p', {}, 'This device can only read. Ask the admin for a new database code to send messages.')); return () => el.remove(); }
  const name = h('input', { type: 'text', class: 'field', value: prefs.get('feedbackName', ''), placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'name' });
  const msg = h('textarea', { class: 'field', rows: '6', placeholder: 'Tell the admin what is wrong, or what would be better', 'aria-label': 'Your message' });
  const pics = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { files = [...pics.files].slice(0, 5); info.textContent = files.length ? `${files.length} picture${files.length === 1 ? '' : 's'} chosen` : ''; } });
  let files = [];
  const info = h('span', { class: 'muted small' });
  const send = h('button', { class: 'btn primary', type: 'button', onclick: doSend }, 'Send');
  el.append(h('label', { class: 'lbl' }, 'Your name (so the admin knows who wrote)'), name, h('label', { class: 'lbl' }, 'Your message'), msg,
    h('div', { class: 'row-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => pics.click() }, icon('plus', 16), ' Add pictures (up to 5)'), info, pics), send);

  async function doSend() {
    if (!name.value.trim()) { toast('Please type your name.', { error: true }); name.focus(); return; }
    if (!msg.value.trim()) { toast('Please type your message.', { error: true }); msg.focus(); return; }
    send.disabled = true; send.textContent = 'Sending…';
    try {
      const now = Date.now();
      const d = new Date(now);
      const p2 = (n) => String(n).padStart(2, '0');
      const id = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}-${Math.random().toString(16).slice(2, 6)}`;
      const out = [], names = [];
      for (const [i, f] of files.entries()) {
        const bytes = await smallJpeg(f);
        if (bytes) { const file = `${id}-${i + 1}.jpg`; names.push(file); out.push({ path: lib.repo.path(`feedback/images/${file}`), bytes }); }
      }
      const body = JSON.stringify({ id, name: name.value.trim(), message: msg.value.trim(), createdAt: now, appVersion: `web ${VERSION}`, role: lib.role === 'admin' ? 'admin' : 'member', images: names }, null, 2);
      out.push({ path: lib.repo.path(`feedback/${id}.json`), bytes: new TextEncoder().encode(body) });
      await lib.repo.commit(out, `Feedback from ${name.value.trim().slice(0, 40)}`);
      prefs.set('feedbackName', name.value.trim());
      toast('Sent. Thank you!');
      history.back();
    } catch (e) { toast(friendly(e), { error: true }); send.disabled = false; send.textContent = 'Send'; }
  }
  return () => el.remove();
}

async function smallJpeg(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return new Uint8Array(await blob.arrayBuffer());
  } catch { return null; }
}

export function helpView(root) {
  const sec = (t, ...k) => h('div', { class: 'group' }, h('h3', {}, t), ...k);
  const el = h('section', { class: 'help' }, h('div', { class: 'view-head' }, iconButton('back', 'Back', () => history.back()), h('h1', {}, 'Help')),
    sec('Put it on your home screen (iPhone or iPad)', h('ol', {}, h('li', {}, 'Open this page in Safari (not inside another app).'), h('li', {}, 'Tap the Share button (a square with an arrow).'), h('li', {}, 'Scroll down and tap “Add to Home Screen”.'), h('li', {}, 'Tap “Add”. The icon now opens the app like any other.'))),
    sec('Android or computer', h('p', {}, 'In Chrome, open the menu and choose “Install app” or “Add to Home screen”.')),
    sec('Finding a song', h('p', {}, 'Type part of the name or the singer, in Sinhala or English letters. “sanda” finds the same songs as “සඳ”.')),
    sec('Reading a song', h('ul', {}, h('li', {}, 'Tap the right or left edge of the screen, or swipe, to turn the page.'), h('li', {}, 'Double-tap the middle, or pinch, to zoom.'), h('li', {}, 'Tap the middle once to hide the buttons.'), h('li', {}, 'The moon button makes the page dark for the stage.'), h('li', {}, 'A keyboard or page-turner pedal also works (arrow keys or Page Up / Page Down).'))),
    sec('Adding songs', h('p', {}, 'Press the Add button on the Songs tab. Choose pictures, PDFs or whole folders. Pictures without a clear name wait in the To-do tab.')),
    sec('Using it without internet', h('p', {}, 'Pictures you have opened stay on this device. In an album, choose “Keep these songs on this device” to prepare a set list for a place with no signal.')));
  root.append(el);
  void idb;
  return () => el.remove();
}
