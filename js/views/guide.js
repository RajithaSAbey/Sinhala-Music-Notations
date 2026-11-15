// First visit: three short steps — get the code, paste it, choose how pictures are kept.
import { h } from '../util.js';
import { parse } from '../setupcode.js';
import { Repo } from '../github.js';
import { prefs } from '../store.js';
import { icon, friendly } from '../ui.js';

export function guide(root, onDone) {
  let step = 0;
  let cfg = null;
  const el = h('div', { class: 'guide' });
  root.replaceChildren(el);

  const dots = () => h('div', { class: 'dots', 'aria-label': `Step ${step + 1} of 3` }, [0, 1, 2].map((i) => h('span', { class: i === step ? 'on' : '' })));

  function s1() {
    return [h('div', { class: 'logo-big', 'aria-hidden': 'true' }, icon('music', 44)), h('h1', {}, 'Sinhala Music Notations'),
      h('p', { class: 'lead' }, 'Your shelf of song notations: find any song in seconds, read it full screen, and help keep the collection growing.'),
      h('ol', { class: 'big-steps' }, h('li', {}, h('strong', {}, '1. Get your database code. '), 'The admin sends you a long piece of text that starts with NSHELF1.'), h('li', {}, h('strong', {}, '2. Paste it here. '), 'You only do this once.'), h('li', {}, h('strong', {}, '3. Choose how to keep the pictures. '), 'Then you are ready.')),
      h('button', { class: 'btn primary big', type: 'button', onclick: () => { step = 1; draw(); } }, 'Start')];
  }

  function s2() {
    const box = h('textarea', { class: 'field code', rows: '5', placeholder: 'Paste the database code here (NSHELF1.…)', 'aria-label': 'Database code', autocapitalize: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const go = h('button', { class: 'btn primary big', type: 'button', onclick: connect }, 'Connect');
    const admin = adminForm(err, (c) => { cfg = c; check(go); });
    async function connect() {
      const c = parse(box.value);
      if (!c) { err.textContent = 'That does not look like a database code. It should start with NSHELF1. Please copy the whole thing and try again.'; return; }
      cfg = c; await check(go);
    }
    async function check(btn) {
      err.textContent = ''; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Checking…';
      try {
        const info = await new Repo(cfg).info();
        if (!info.isPrivate) { err.textContent = 'This database is not private, so anyone could see the music. Please ask the admin to make it private first.'; return; }
        if (cfg.role !== 'reader' && !info.canPush) { err.textContent = 'This code can only read the database, so it cannot be used to add songs.'; cfg.role = 'reader'; }
        step = 2; draw();
      } catch (e) { err.textContent = friendly(e); } finally { btn.disabled = false; btn.textContent = old; }
    }
    return [h('h1', {}, 'Paste your database code'), h('p', {}, 'Open the message from the admin, press and hold on the code, choose Copy, then come back here and paste it in the box.'), box, err, go,
      h('details', { class: 'admin-opt' }, h('summary', {}, 'I am the admin'), admin),
      h('button', { class: 'btn link', type: 'button', onclick: () => { step = 0; draw(); } }, '‹ Back')];
  }

  function s3() {
    let keepAll = false;
    const opt = (label, hint, val, checked) => h('label', { class: 'option' }, h('input', { type: 'radio', name: 'keep', checked: checked ? true : undefined, onchange: () => { keepAll = val; } }), h('span', {}, h('strong', {}, label), h('br'), h('span', { class: 'muted' }, hint)));
    return [h('h1', {}, 'How should the pictures be kept?'), h('p', {}, 'You can change this later in Settings.'),
      opt('Get each picture when I open it', 'Recommended. Fast to start and uses little space. Pictures you open stay on this device.', false, true),
      opt('Save every picture on this device', 'Everything works without internet, but the first download takes a long time and uses a lot of space.', true, false),
      h('p', { class: 'muted small' }, 'Your database code is stored only on this device, in this browser.'),
      h('button', { class: 'btn primary big', type: 'button', onclick: () => { prefs.set('cfg', cfg); prefs.set('keepAll', keepAll); onDone(cfg, keepAll); } }, 'Finish'),
      h('button', { class: 'btn link', type: 'button', onclick: () => { step = 1; draw(); } }, '‹ Back')];
  }

  function draw() { el.replaceChildren(h('div', { class: 'guide-card' }, dots(), ...[s1, s2, s3][step]())); el.scrollTop = 0; }
  draw();
}

function adminForm(err, onCfg) {
  const f = (ph, val = '') => h('input', { type: 'text', class: 'field', placeholder: ph, 'aria-label': ph, value: val, autocapitalize: 'off', spellcheck: 'false' });
  const repo = f('Repository (owner/name)'), branch = f('Branch', 'notation-library'), folder = f('Folder', 'notation-shelf');
  const token = h('input', { type: 'password', class: 'field', placeholder: 'GitHub key (token)', 'aria-label': 'GitHub key', autocomplete: 'off' });
  return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Use the same repository, branch, folder and key as in your Android app.'), repo, branch, folder, token,
    h('button', { class: 'btn', type: 'button', onclick: () => {
      if (!repo.value.includes('/') || !token.value.trim()) { err.textContent = 'Please fill in the repository (owner/name) and the key.'; return; }
      onCfg({ repo: repo.value.trim(), branch: branch.value.trim() || 'main', folder: folder.value.trim().replace(/^\/+|\/+$/g, ''), token: token.value.trim(), role: 'admin', readOnly: false });
    } }, 'Connect as admin'));
}
