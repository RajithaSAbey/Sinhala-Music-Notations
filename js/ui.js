// Shared building blocks: icons, messages, dialogs, progress screens.
import { h } from './util.js';
import { Index, tokens } from './phonetic.js';

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m5 9 7 7 7-7"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  album: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  todo: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.7 7L3 21l2-5.6A8 8 0 1 1 21 12z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01"/>',
  sort: '<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01"/>',
  flag: '<path d="M5 21V4m0 0h12l-2 4 2 4H5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
};

export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', name === 'star' ? 'none' : 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', `ic ic-${name}`);
  s.innerHTML = PATHS[name] || ''; // fixed strings above, never user text
  return s;
}

export function iconButton(name, label, onClick, cls = '') {
  return h('button', { class: `iconbtn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(name));
}

let toastTimer;
export function toast(message, { error = false, ms = 3500 } = {}) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = message;
  t.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms);
}

/** A box over the page. body: nodes. actions: [{label, primary, danger, value}]. Resolves with the action's value (or undefined if closed). */
export function dialog({ title, body = [], actions = [{ label: 'OK', primary: true, value: true }], dismissible = true, wide = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(undefined); } };
    const buttons = actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, type: 'button', onclick: () => { if (!a.onClick) return close(a.value); const v = a.onClick(); if (v !== undefined) close(v); } }, a.label));
    const box = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), h('div', { class: 'dialog-body' }, typeof body === 'function' ? body(close) : body), h('div', { class: 'dialog-actions' }, buttons));
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay && dismissible) close(undefined); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    (box.querySelector('input,textarea') || buttons.at(-1))?.focus();
  });
}

export const confirmBox = (title, message, { yes = 'Yes', no = 'Cancel', danger = false } = {}) =>
  dialog({ title, body: [h('p', {}, message)], actions: [{ label: no, value: false }, { label: yes, primary: !danger, danger, value: true }] });

export async function askText(title, { label = '', value = '', placeholder = '', yes = 'Save' } = {}) {
  const input = h('input', { type: 'text', value, placeholder, class: 'field', 'aria-label': label || title, autocomplete: 'off' });
  let out;
  const r = await dialog({
    title, body: [label ? h('label', { class: 'lbl' }, label) : null, input],
    actions: [{ label: 'Cancel', value: false }, { label: yes, primary: true, onClick: () => { out = input.value.trim(); return true; } }],
  });
  return r ? out : null;
}

/** A progress screen that blocks the page until closed. */
export function busy(title, { cancel = null } = {}) {
  const bar = h('div', { class: 'bar-fill' });
  const text = h('p', { class: 'busy-text', 'aria-live': 'polite' }, '');
  const count = h('p', { class: 'muted small' }, '');
  const box = h('div', { class: 'dialog' }, h('h2', {}, title), text, h('div', { class: 'bar', role: 'progressbar' }, bar), count,
    cancel ? h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => cancel() }, 'Stop')) : null);
  const overlay = h('div', { class: 'overlay solid' }, box);
  document.body.append(overlay);
  return {
    set(message, done, total) {
      if (message != null) text.textContent = message;
      if (total > 0) { bar.style.width = `${Math.min(100, (done / total) * 100)}%`; count.textContent = `${done.toLocaleString()} of ${total.toLocaleString()}`; bar.parentElement.classList.remove('indeterminate'); }
      else { bar.style.width = ''; count.textContent = ''; bar.parentElement.classList.add('indeterminate'); }
    },
    close() { overlay.remove(); },
  };
}

export function chip(label, { active = false, onClick, title } = {}) {
  return h('button', { class: `chip${active ? ' active' : ''}`, type: 'button', 'aria-pressed': String(active), onclick: onClick, title }, label);
}

export function empty(title, hint, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), hint ? h('p', { class: 'muted' }, hint) : null, action || null);
}

export function friendly(e) {
  if (e?.resetAt) {
    const mins = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 60000));
    return `GitHub is busy right now (it limits how often one key can be used). Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return e?.message || 'Something went wrong. Please try again.';
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * A singer name box that suggests existing singers while typing (Sinhala or English letters), so the same singer is
 * not spelled five different ways. Tap a suggestion to use it.
 */
export function singerField(lib, { value = '', label = 'Singer', placeholder = 'Singer (can be left empty)', onInput } = {}) {
  const input = h('input', { type: 'text', class: 'field', value, placeholder, 'aria-label': label, autocomplete: 'off', autocapitalize: 'words', role: 'combobox', 'aria-expanded': 'false' });
  const list = h('div', { class: 'suggest', role: 'listbox', 'aria-label': 'Singers already in the library' });
  let singers = null;
  const all = () => (singers ??= lib.singers().map((s) => ({ name: s.name, count: s.songs.length, ix: new Index(s.name) })));
  const draw = () => {
    const q = input.value.trim();
    const toks = tokens(q);
    let hits = [];
    if (toks.length) {
      const low = q.toLowerCase();
      hits = all().filter((s) => s.ix.matches(toks) && s.name !== q)
        .sort((a, b) => (b.name.toLowerCase().startsWith(low) - a.name.toLowerCase().startsWith(low)) || b.count - a.count).slice(0, 6);
    }
    input.setAttribute('aria-expanded', String(hits.length > 0));
    list.replaceChildren(...hits.map((s) => h('button', { class: 'chip', type: 'button', role: 'option', onclick: () => { input.value = s.name; onInput?.(s.name); draw(); input.focus(); } }, s.name, h('span', { class: 'muted small' }, ` · ${s.count}`))));
    list.hidden = !hits.length;
  };
  input.addEventListener('input', () => { onInput?.(input.value); draw(); });
  list.hidden = true;
  return { el: h('div', { class: 'singer-field' }, input, list), input };
}

/** Name + singer in one box. Resolves { title, singer } or null. */
export async function nameDialog(lib, { heading, title = '', singer = '', yes = 'Save', needTitle = true }) {
  const t = h('input', { type: 'text', class: 'field', value: title, placeholder: 'Song name', 'aria-label': 'Song name', autocomplete: 'off' });
  const sf = singerField(lib, { value: singer });
  let out = null;
  const ok = await dialog({
    title: heading,
    body: [h('label', { class: 'lbl' }, 'Song name'), t, h('label', { class: 'lbl' }, 'Singer'), sf.el],
    actions: [{ label: 'Cancel', value: false }, { label: yes, primary: true, onClick: () => {
      if (needTitle && !t.value.trim()) { toast('The song needs a name.', { error: true }); t.focus(); return undefined; }
      out = { title: t.value.trim(), singer: sf.input.value.trim() }; return true;
    } }],
  });
  return ok ? out : null;
}
