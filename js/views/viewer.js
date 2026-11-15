// Full-screen reading of one song: swipe, tap the edges, pinch/double-tap to zoom, stage mode, chords link.
import { h } from '../util.js';
import { S, favs, recents, canEditSongs, isAdmin, go } from '../state.js';
import { prefs } from '../store.js';
import { icon, iconButton, toast, dialog, askText, confirmBox, friendly } from '../ui.js';
import { UNTITLED } from '../library.js';

export function viewer(root, uid) {
  const lib = S.lib;
  let song = lib.get(uid);
  if (!song || song.deleted) { go('#/songs'); return () => {}; }
  recents.add(uid);

  let pageIndex = Math.min(Number(new URLSearchParams(location.search).get('p')) || 0, Math.max(0, song.pages.length - 1));
  let z = 1, tx = 0, ty = 0;
  let stage = prefs.get('stage', false);
  let bright = prefs.get('bright', 1);
  let chromeOn = true;
  let url = '';
  let token = 0;
  let natural = { w: 0, h: 0 };
  let lock = null;
  let gone = false;

  const ctx = S.ctx?.uids?.includes(uid) ? S.ctx : { uids: [uid], name: '' };
  const pos = () => ctx.uids.indexOf(uid);

  const img = h('img', { alt: '', draggable: 'false', class: 'v-img' });
  const pane = h('div', { class: 'v-pane' }, img);
  const msg = h('div', { class: 'v-msg', role: 'status' });
  const stageEl = h('div', { class: 'v-stage' }, pane, msg);
  const title = h('div', { class: 'v-title' });
  const sub = h('div', { class: 'v-sub muted' });
  const counter = h('span', { class: 'v-count' });
  const starBtn = iconButton('star', 'Favourite', () => { const on = favs.toggle(uid); refreshChrome(); toast(on ? 'Added to favourites' : 'Removed from favourites'); }, 'star-btn');
  const stageBtn = iconButton('moon', 'Dark stage mode', () => { stage = !stage; prefs.set('stage', stage); applyLook(); });
  const slider = h('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(bright), 'aria-label': 'Brightness', class: 'v-bright', oninput: () => { bright = Number(slider.value); prefs.set('bright', bright); applyLook(); } });
  const chords = h('a', { class: 'v-chords', target: '_blank', rel: 'noopener noreferrer' }, icon('music', 18), ' Chords');
  const prevBtn = iconButton('back', 'Previous page', () => step(-1));
  const nextBtn = iconButton('next', 'Next page', () => step(1));
  const top = h('div', { class: 'v-top' },
    iconButton('back', 'Back', () => close()),
    h('div', { class: 'v-heading' }, title, sub),
    starBtn, stageBtn, iconButton('more', 'More', () => menu()));
  const bottom = h('div', { class: 'v-bottom' }, prevBtn, counter, nextBtn, slider);
  const el = h('div', { class: 'viewer', tabindex: '-1' }, top, stageEl, bottom, chords);
  root.append(el);

  function close() {
    if (history.length > 1 && ctx) history.back(); else go('#/songs');
  }

  function applyLook() {
    el.classList.toggle('stage', stage);
    el.classList.toggle('hide-chrome', !chromeOn);
    img.style.filter = `${stage ? 'invert(1) ' : ''}brightness(${stage ? bright : 1})`;
    slider.hidden = !stage;
    stageBtn.classList.toggle('on', stage);
    stageEl.style.background = stage ? '#000' : '';
  }
  function refreshChrome() {
    song = lib.get(uid) || song;
    title.textContent = song.title === UNTITLED ? 'Untitled' : song.title;
    sub.textContent = [song.singer, ctx.uids.length > 1 ? `${pos() + 1} of ${ctx.uids.length}${ctx.name ? ' in ' + ctx.name : ''}` : ''].filter(Boolean).join(' · ');
    starBtn.classList.toggle('on', favs.has(uid));
    starBtn.setAttribute('aria-pressed', String(favs.has(uid)));
    counter.textContent = song.pages.length ? `Page ${pageIndex + 1} of ${song.pages.length}` : '';
    prevBtn.disabled = pageIndex === 0 && pos() <= 0;
    nextBtn.disabled = pageIndex >= song.pages.length - 1 && pos() >= ctx.uids.length - 1;
    const c = song.links.find((l) => l.kind.toLowerCase() === 'chords') || null;
    chords.hidden = !c;
    if (c) { chords.href = c.url; chords.title = c.title; }
  }

  function layout() {
    const cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    const rot = song.pages[pageIndex]?.rotation || 0;
    const sw = rot % 180 ? natural.h : natural.w, sh = rot % 180 ? natural.w : natural.h;
    if (!sw || !cw) return;
    const fit = Math.min(cw / sw, ch / sh);
    const w = natural.w * fit, hh = natural.h * fit;
    Object.assign(img.style, { width: `${w}px`, height: `${hh}px`, left: `${(cw - w) / 2}px`, top: `${(ch - hh) / 2}px`, transform: `rotate(${rot}deg)` });
    transform();
  }
  function transform() {
    const cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    const maxX = (cw * (z - 1)) / 2 + 40, maxY = (ch * (z - 1)) / 2 + 40;
    tx = Math.max(-maxX, Math.min(maxX, tx)); ty = Math.max(-maxY, Math.min(maxY, ty));
    if (z === 1) { tx = 0; ty = 0; }
    pane.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  }
  function setZoom(nz, cx, cy) {
    nz = Math.max(1, Math.min(6, nz));
    const r = stageEl.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2), py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
    tx = px - ((px - tx) / z) * nz; ty = py - ((py - ty) / z) * nz; z = nz; transform();
  }

  async function show() {
    const my = ++token;
    const p = song.pages[pageIndex];
    z = 1; tx = ty = 0;
    refreshChrome();
    if (!p) { img.removeAttribute('src'); msg.textContent = 'This song has no pictures yet.'; msg.hidden = false; return; }
    msg.textContent = 'Loading…'; msg.hidden = false;
    try {
      const blob = await lib.image(p.file);
      if (my !== token || gone) return;
      const u = URL.createObjectURL(blob);
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This picture could not be shown.')); img.src = u; });
      if (url) URL.revokeObjectURL(url);
      url = u;
      natural = { w: img.naturalWidth, h: img.naturalHeight };
      msg.hidden = true;
      layout();
      prefetch();
    } catch (e) {
      if (my !== token) return;
      msg.replaceChildren(h('p', {}, friendly(e)), h('button', { class: 'btn', onclick: () => show() }, 'Try again'));
    }
  }
  function prefetch() {
    const next = song.pages[pageIndex + 1] || lib.get(ctx.uids[pos() + 1])?.pages[0];
    if (next) lib.image(next.file).catch(() => {});
  }

  function gotoSong(delta, last = false) {
    const to = ctx.uids[pos() + delta];
    if (!to) return false;
    S.ctx = ctx;
    const s = lib.get(to);
    const p = last && s ? Math.max(0, s.pages.length - 1) : 0;
    location.replace(`${location.pathname}${p ? `?p=${p}` : ''}#/song/${to}`);
    return true;
  }
  function step(d) {
    if (d > 0) {
      if (pageIndex < song.pages.length - 1) { pageIndex++; show(); } else if (gotoSong(1)) toast(`Next: ${lib.get(ctx.uids[pos() + 1])?.title || ''}`, { ms: 1500 }); else toast('That is the last page', { ms: 1200 });
    } else if (pageIndex > 0) { pageIndex--; show(); } else if (!gotoSong(-1, true)) toast('That is the first page', { ms: 1200 });
  }

  // ---- touch / mouse ----
  const pts = new Map();
  let start = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
  stageEl.addEventListener('pointerdown', (e) => {
    stageEl.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, t: Date.now(), tx, ty, moved: false };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z }; start.moved = true; }
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) start.moved = true;
      if (z > 1) { tx = start.tx + dx; ty = start.ty + dy; transform(); }
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    const wasPinch = pts.size >= 2;
    pts.delete(e.pointerId);
    if (wasPinch) { if (pts.size < 2) pinch = null; if (!pts.size) start = null; return; }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = Date.now() - start.t;
    const s = start; start = null;
    if (e.type === 'pointercancel') return;
    if (!s.moved && dt < 500) {
      const r = stageEl.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      const now = Date.now();
      const center = rel > 0.25 && rel < 0.75;
      if (center && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap.t = 0; z > 1 ? setZoom(1) : setZoom(2.5, e.clientX, e.clientY); return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (z === 1 && rel <= 0.25) step(-1);
      else if (z === 1 && rel >= 0.75) step(1);
      else { chromeOn = !chromeOn; applyLook(); }
    } else if (z === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  };
  stageEl.addEventListener('pointerup', end);
  stageEl.addEventListener('pointercancel', end);
  stageEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || z === 1 && Math.abs(e.deltaY) < 1) setZoom(z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else if (z > 1) { tx -= e.deltaX; ty -= e.deltaY; transform(); } else if (Math.abs(e.deltaY) > 30) step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  const onKey = (e) => {
    if (e.target.closest?.('input,textarea')) return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', 'ArrowDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); step(1); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace'].includes(k)) { e.preventDefault(); step(-1); }
    else if (k === 'Escape') close();
    else if (k === '+' || k === '=') setZoom(z * 1.3);
    else if (k === '-') setZoom(z / 1.3);
    else if (k === '0') setZoom(1);
    else if (k.toLowerCase() === 's') { stage = !stage; prefs.set('stage', stage); applyLook(); }
    else if (k.toLowerCase() === 'f') starBtn.click();
  };
  document.addEventListener('keydown', onKey);
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  async function keepAwake() {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
  }
  const onVis = () => { if (document.visibilityState === 'visible' && !gone) keepAwake(); };
  document.addEventListener('visibilitychange', onVis);
  keepAwake();

  // ---- the ⋯ menu ----
  async function menu() {
    const items = [];
    const add = (label, fn, danger = false) => items.push({ label, fn, danger });
    if (canEditSongs()) { add('Change the name or singer…', rename); add('Edit everything about this song…', () => go(`#/edit/${uid}`)); add('Turn this page', rotate); }
    add('Add to an album…', addToAlbum);
    add('Share this song', share);
    if (isAdmin()) add('Delete this song…', del, true);
    const r = await dialog({
      title: 'This song',
      body: (done) => [h('div', { class: 'stack' }, items.map((i) => h('button', { class: `btn block${i.danger ? ' danger' : ''}`, type: 'button', onclick: () => done(i) }, i.label)))],
      actions: [{ label: 'Close', value: null }],
    });
    if (r) r.fn();
  }
  async function rename() {
    const t = await askText('Name of the song', { value: song.title === UNTITLED ? '' : song.title, label: 'Song name' });
    if (t == null) return;
    const s = await askText('Singer (can be left empty)', { value: song.singer, label: 'Singer' });
    if (s == null) return;
    try {
      await lib.updateSong(uid, (r) => { if (t) { r.title = t; if (r.titleState === 2) r.titleState = 0; } r.singer = s; }, 'Rename a song');
      refreshChrome(); toast('Saved');
    } catch (e) { toast(friendly(e), { error: true }); }
  }
  async function rotate() {
    try {
      const idx = pageIndex;
      await lib.updateSong(uid, (r) => { if (r.pages[idx]) r.pages[idx].rotation = ((r.pages[idx].rotation || 0) + 90) % 360; }, 'Turn a page');
      song = lib.get(uid); layout();
    } catch (e) { toast(friendly(e), { error: true }); }
  }
  async function addToAlbum() {
    const { pickAlbum } = await import('./albums.js');
    const a = await pickAlbum();
    if (a) { await lib.addToAlbum(a.uid, [uid]); toast(`Added to ${a.name}`); }
  }
  async function share() {
    try {
      const files = [];
      for (const [i, p] of song.pages.entries()) files.push(new File([await lib.image(p.file)], `${song.title} ${i + 1}.jpg`, { type: 'image/jpeg' }));
      if (navigator.canShare?.({ files })) await navigator.share({ files, title: song.title });
      else { for (const f of files) { const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); } toast('Saved to your downloads'); }
    } catch (e) { if (e?.name !== 'AbortError') toast(friendly(e), { error: true }); }
  }
  async function del() {
    if (!(await confirmBox('Delete this song?', `“${song.title}” will be removed from the database for everyone.`, { yes: 'Delete', danger: true }))) return;
    try { await lib.updateSong(uid, (r) => { r.deleted = true; }, 'Delete a song'); toast('Deleted'); close(); } catch (e) { toast(friendly(e), { error: true }); }
  }

  applyLook();
  show();
  el.focus();
  const onChange = () => { if (lib.get(uid)?.deleted) close(); else refreshChrome(); };
  lib.addEventListener('change', onChange);

  return () => {
    gone = true; token++;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
    lib.removeEventListener('change', onChange);
    lock?.release?.().catch(() => {});
    if (url) URL.revokeObjectURL(url);
    el.remove();
  };
}
