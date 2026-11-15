// The song list (search, sort, favourites, recent, letter strip, select several) and the singers tab.
import { h, debounce, plural } from '../util.js';
import { S, favs, recents, openSong, go, canEditSongs } from '../state.js';
import { prefs } from '../store.js';
import { icon, iconButton, chip, empty, toast, dialog } from '../ui.js';
import { UNTITLED } from '../library.js';
import { tokens } from '../phonetic.js';

const SORTS = [['az', 'A–Z', 'sort'], ['new', 'Newest', 'plus'], ['opened', 'Opened lately', 'clock']];

export function sortSongs(list, sort) {
  const az = (a, b) => a._k.localeCompare(b._k) || a.title.localeCompare(b.title);
  if (sort === 'new') return [...list].sort((a, b) => b.createdAt - a.createdAt || az(a, b));
  if (sort === 'opened') { const m = recents.map(); return [...list].sort((a, b) => (m[b.uid] || 0) - (m[a.uid] || 0) || az(a, b)); }
  return [...list].sort(az);
}
const letterOf = (s) => { const c = (s._k || '').charAt(0); return c >= 'a' && c <= 'z' ? c.toUpperCase() : '#'; };

/**
 * A searchable list of songs.
 * opts: { songs(): Song[], name, heading, hint, canSelect, emptyHint, showFilters }
 */
export function songList(root, opts) {
  const lib = S.lib;
  let query = opts.keepQuery ? prefs.get('q', '') : '';
  let sort = prefs.get('sort', 'az');
  let filter = opts.showFilters ? prefs.get('filter', 'all') : 'all';
  let rows = [];
  let shown = 0;
  let selecting = false;
  const selected = new Set();
  const CHUNK = 120;

  const input = h('input', { type: 'search', class: 'search', placeholder: 'Search by song or singer, in Sinhala or English', 'aria-label': 'Search songs', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: query });
  const mic = voiceButton((text) => { input.value = text; onInput(); });
  const clear = iconButton('x', 'Clear search', () => { input.value = ''; onInput(); input.focus(); }, 'clear');
  const bar = h('div', { class: 'searchbar' }, icon('search', 20), input, clear, mic);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show and sort' });
  const count = h('div', { class: 'count muted small', 'aria-live': 'polite' });
  const list = h('ul', { class: 'songs', role: 'list' });
  const sentinel = h('div', { class: 'sentinel' });
  const letters = h('div', { class: 'letters', 'aria-label': 'Jump to a letter' });
  const selbar = h('div', { class: 'selbar', hidden: true });
  const body = h('div', { class: 'list-wrap' }, list, sentinel);
  const el = h('section', { class: 'songs-view' }, opts.heading ? h('div', { class: 'view-head' }, opts.back ? iconButton('back', 'Back', () => history.back()) : null, h('h1', {}, opts.heading)) : null,
    bar, chips, count, selbar, h('div', { class: 'list-area' }, body, letters));
  root.append(el);

  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && shown < rows.length) renderChunk(); }, { rootMargin: '600px' });
  io.observe(sentinel);

  function compute() {
    let base = opts.songs();
    if (filter === 'fav') { const f = new Set(favs.list()); base = base.filter((s) => f.has(s.uid)); }
    else if (filter === 'recent') { const r = new Map(recents.list(100).map((u, i) => [u, i])); base = base.filter((s) => r.has(s.uid)).sort((a, b) => r.get(a.uid) - r.get(b.uid)); }
    const found = query.trim() ? lib.search(query, { list: base }) : base;
    rows = filter === 'recent' && !query.trim() ? found : sortSongs(found, sort);
    return base;
  }

  function drawChips() {
    const kids = [];
    if (opts.showFilters) {
      kids.push(chip('All', { active: filter === 'all', onClick: () => setFilter('all') }), chip('★ Favourites', { active: filter === 'fav', onClick: () => setFilter('fav') }), chip('Recent', { active: filter === 'recent', onClick: () => setFilter('recent') }));
    }
    kids.push(h('span', { class: 'spacer' }));
    if (filter !== 'recent') kids.push(h('button', { class: 'chip sortchip', type: 'button', onclick: cycleSort, 'aria-label': `Sorted ${SORTS.find((s) => s[0] === sort)[1]}. Change sorting` }, icon('sort', 16), ' ', SORTS.find((s) => s[0] === sort)[1]));
    if (opts.canSelect !== false) kids.push(h('button', { class: `chip${selecting ? ' active' : ''}`, type: 'button', onclick: () => toggleSelect(!selecting) }, selecting ? 'Done' : 'Select'));
    chips.replaceChildren(...kids);
  }
  function setFilter(f) { filter = f; prefs.set('filter', f); refresh(); }
  function cycleSort() { const i = SORTS.findIndex((s) => s[0] === sort); sort = SORTS[(i + 1) % SORTS.length][0]; prefs.set('sort', sort); refresh(); }

  function row(s) {
    const pages = s.pages.length;
    const li = h('li', { class: `row${selected.has(s.uid) ? ' selected' : ''}`, 'data-uid': s.uid },
      selecting ? h('span', { class: `check${selected.has(s.uid) ? ' on' : ''}`, 'aria-hidden': 'true' }, selected.has(s.uid) ? icon('check', 16) : null) : null,
      h('button', { class: 'row-main', type: 'button', role: selecting ? 'checkbox' : undefined, 'aria-checked': selecting ? String(selected.has(s.uid)) : undefined },
        h('span', { class: 'row-title' }, s.title === UNTITLED ? 'Untitled' : s.title),
        h('span', { class: 'row-sub muted' }, [s.singer, pages > 1 ? `${pages} pages` : ''].filter(Boolean).join(' · ') || ' ')),
      selecting ? null : h('button', { class: `star-btn${favs.has(s.uid) ? ' on' : ''}`, type: 'button', 'aria-label': favs.has(s.uid) ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': String(favs.has(s.uid)) }, icon('star', 20)));
    return li;
  }

  function renderChunk(upTo = shown + CHUNK) {
    const end = Math.min(rows.length, upTo);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.append(row(rows[i]));
    list.append(frag);
    shown = end;
  }

  function refresh() {
    const base = compute();
    drawChips();
    list.replaceChildren();
    shown = 0;
    renderChunk();
    clear.hidden = !input.value;
    const q = query.trim();
    count.textContent = q ? `${plural(rows.length, 'song')} found` : filter === 'fav' ? plural(rows.length, 'favourite') : filter === 'recent' ? `${plural(rows.length, 'song')} you opened lately` : plural(rows.length, 'song');
    list.parentElement.querySelector('.empty')?.remove();
    if (!rows.length) {
      const sug = q ? lib.suggest(q) : [];
      body.prepend(empty(q ? `Nothing found for “${q}”` : filter === 'fav' ? 'No favourites yet' : filter === 'recent' ? 'Nothing opened yet' : (opts.emptyHint?.[0] || 'No songs here'),
        q ? 'Try fewer letters, or another spelling. English spelling works for Sinhala names.' : filter === 'fav' ? 'Tap the star next to a song to keep it here.' : (opts.emptyHint?.[1] || ''),
        sug.length ? h('div', { class: 'chips center' }, h('span', { class: 'muted' }, 'Did you mean '), sug.map((s) => chip(s.title, { onClick: () => { input.value = s.title; onInput(); } }))) : null));
    }
    const showStrip = sort === 'az' && !q && filter !== 'recent' && rows.length > 40;
    letters.hidden = !showStrip;
    if (showStrip) {
      const have = new Set(rows.map(letterOf));
      letters.replaceChildren(...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'].map((c) => h('button', { type: 'button', class: have.has(c) ? '' : 'dim', 'aria-label': `Songs starting with ${c}`, onclick: () => jump(c) }, c)));
    }
    if (selecting) drawSelbar();
    void base;
  }
  function jump(c) {
    const i = rows.findIndex((s) => letterOf(s) === c);
    if (i < 0) return;
    if (i >= shown) renderChunk(i + CHUNK);
    list.children[i]?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  const onInput = () => { query = input.value; if (opts.keepQuery) prefs.set('q', query); refresh(); };
  input.addEventListener('input', debounce(onInput, 90));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  // ---- tapping rows (one listener for the whole list) ----
  let pressTimer;
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li.row'); if (!li) return;
    const uid = li.dataset.uid;
    if (e.target.closest('.star-btn')) { const on = favs.toggle(uid); toast(on ? 'Added to favourites' : 'Removed from favourites', { ms: 1200 }); if (filter === 'fav') refresh(); else { const b = li.querySelector('.star-btn'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } return; }
    if (selecting) { selected.has(uid) ? selected.delete(uid) : selected.add(uid); li.replaceWith(row(lib.get(uid))); drawSelbar(); return; }
    openSong(uid, rows.map((s) => s.uid), opts.name || '');
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li.row'); if (!li || selecting || opts.canSelect === false) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { toggleSelect(true); selected.add(li.dataset.uid); refresh(); li.dataset.long = '1'; }, 550);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'pointermove']) list.addEventListener(ev, () => clearTimeout(pressTimer));
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('li.row')) e.preventDefault(); });

  function toggleSelect(on) { selecting = on; if (!on) selected.clear(); selbar.hidden = !on; refresh(); }
  function drawSelbar() {
    selbar.hidden = !selecting;
    const n = selected.size;
    selbar.replaceChildren(
      h('strong', {}, n ? `${n} selected` : 'Tap songs to choose them'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', onclick: () => { rows.forEach((s) => selected.add(s.uid)); refresh(); } }, 'All'),
      h('button', { class: 'btn small', type: 'button', disabled: !n, onclick: async () => { const { pickAlbum } = await import('./albums.js'); const a = await pickAlbum(); if (a) { await lib.addToAlbum(a.uid, [...selected]); toast(`Added ${plural(n, 'song')} to ${a.name}`); toggleSelect(false); } } }, 'Add to album'),
      h('button', { class: 'btn small', type: 'button', disabled: !n, onclick: () => { [...selected].forEach((u) => !favs.has(u) && favs.toggle(u)); toast('Added to favourites'); toggleSelect(false); } }, '★ Favourite'));
  }

  const onChange = debounce(() => { if (!selecting && document.activeElement !== input) refresh(); }, 200);
  lib.addEventListener('change', onChange);
  refresh();
  return () => { io.disconnect(); lib.removeEventListener('change', onChange); el.remove(); };
}

export function voiceButton(onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const b = iconButton('mic', 'Say the song name', () => {
    const r = new SR();
    r.lang = prefs.get('voiceLang', 'si-LK');
    r.interimResults = false;
    b.classList.add('on');
    r.onresult = (e) => onText(e.results[0][0].transcript);
    r.onerror = (e) => { if (e.error === 'language-not-supported' && r.lang !== 'en-US') { prefs.set('voiceLang', 'en-US'); toast('Sinhala voice is not available here; using English. Tap the microphone again.'); } else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Could not hear you. Please try again.', { error: true }); };
    r.onend = () => b.classList.remove('on');
    try { r.start(); } catch { b.classList.remove('on'); }
  }, 'mic');
  if (!SR) b.hidden = true;
  return b;
}

export function songsTab(root) {
  const lib = S.lib;
  const dispose = songList(root, { songs: () => lib.live().filter((s) => s.titleState !== 2), name: "", showFilters: true, keepQuery: false, emptyHint: ['The database is empty', 'Add pictures with the + button.'] });
  const fab = (canEditSongs() || lib.isPublic) ? h('button', { class: 'fab', type: 'button', 'aria-label': 'Add songs', onclick: () => go('#/add') }, icon('plus', 26), h('span', {}, 'Add')) : null;
  if (fab) root.append(fab);
  return () => { dispose(); fab?.remove(); };
}

export function singersTab(root) {
  const lib = S.lib;
  let q = '';
  const input = h('input', { type: 'search', class: 'search', placeholder: 'Find a singer', 'aria-label': 'Find a singer', autocomplete: 'off', oninput: debounce(() => { q = input.value; draw(); }, 90) });
  const grid = h('div', { class: 'tiles' });
  const el = h('section', {}, h('div', { class: 'view-head' }, h('h1', {}, 'Singers')), h('div', { class: 'searchbar' }, icon('search', 20), input), grid);
  root.append(el);
  function draw() {
    const toks = tokens(q);
    const all = lib.singers().filter((s) => !toks.length || toks.every((t) => s.songs[0]._g.matches([t])));
    grid.replaceChildren(...(all.length ? all.map((s) => h('button', { class: 'tile', type: 'button', onclick: () => go(`#/singer/${encodeURIComponent(s.key)}`) },
      h('span', { class: 'tile-ic', 'aria-hidden': 'true' }, [...s.name][0]?.toUpperCase() || '♪'),
      h('span', { class: 'tile-name' }, s.name), h('span', { class: 'muted small' }, plural(s.songs.length, 'song')))) : [empty('No singers found', q ? 'Try another spelling.' : 'Songs with a singer name will appear here.')]));
  }
  draw();
  const on = debounce(draw, 300);
  lib.addEventListener('change', on);
  return () => { lib.removeEventListener('change', on); el.remove(); };
}

export function singerPage(root, keyStr) {
  const lib = S.lib;
  const sg = lib.singers().find((s) => s.key === keyStr);
  return songList(root, { songs: () => lib.live().filter((s) => s._sk === keyStr && s.titleState !== 2), name: sg?.name || 'Singer', heading: sg?.name || 'Singer', back: true, showFilters: false });
}
