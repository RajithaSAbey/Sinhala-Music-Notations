// Bar-by-bar review of a typeset notation sheet. Answers are kept in this browser and sent to the owner on request.
const WORKER = 'https://intake.sinhala-music.workers.dev/fix';
const SIN = { S: 'ස', R: 'රි', G: 'ග', M: 'ම', P: 'ප', D: 'ධ', N: 'නි' };
const $ = (s) => document.querySelector(s);
let DATA = [], SHEET = 'song1', st = {}, i = 0;
try { st = JSON.parse(localStorage.getItem('nc.state') || '{}'); } catch { /* private window */ }
const save = () => { try { localStorage.setItem('nc.state', JSON.stringify(st)); } catch { /* ignore */ } };
const norm = (t) => [...t].map((c) => (/[A-Za-z]/.test(c) && SIN[c.toUpperCase()]) || c).join('');

let sel = new Set(); // indexes (in the token list) of the notes the person has tapped
const tokensOf = (text) => text.trim().split(/\s+/).filter(Boolean);
const isNote = (t) => t !== '(' && t !== ')';
function setTokens(tokens) { $('#in').value = tokens.join(' '); cells($('#in').value); }
function cells(text) {
  const box = $('#cells'); box.replaceChildren();
  const toks = tokensOf(text);
  sel = new Set([...sel].filter((k) => k < toks.length && isNote(toks[k])));
  const stack = []; let cur = box;
  toks.forEach((g, k) => {
    if (g === '(') { const w = document.createElement('span'); w.className = 'slur'; cur.append(w); stack.push(cur); cur = w; return; }
    if (g === ')') { cur = stack.pop() || box; return; }
    const und = g.endsWith('_');
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'cell' + (/^[+—\-‡]+$/.test(g) ? ' mark' : '') + (und ? ' u' : '') + (sel.has(k) ? ' sel' : '');
    s.textContent = und ? g.slice(0, -1) : g;
    s.setAttribute('aria-pressed', String(sel.has(k)));
    s.setAttribute('aria-label', `Note ${s.textContent}. Tap to select it`);
    s.addEventListener('click', () => { sel.has(k) ? sel.delete(k) : sel.add(k); cells($('#in').value); });
    cur.append(s);
  });
  const n = sel.size;
  for (const id of ['#brk', '#bar', '#clr']) $(id).disabled = n === 0;
  $('#selhint').textContent = n ? `${n} note${n === 1 ? '' : 's'} selected` : 'Tap the notes above that need a bar or a bracket under them';
}
function dropBrackets(toks, from, to) { // remove brackets that surround or sit inside the range
  const out = []; const open = [];
  toks.forEach((t, k) => { if (t === '(') open.push(out.length); if (t === ')') { open.pop(); } out.push(t); });
  // find matching pairs
  const pairs = []; const st = [];
  toks.forEach((t, k) => { if (t === '(') st.push(k); else if (t === ')') { const o = st.pop(); if (o !== undefined) pairs.push([o, k]); } });
  const kill = new Set();
  for (const [o, c] of pairs) if (!(c < from || o > to)) { kill.add(o); kill.add(c); }
  return toks.filter((_, k) => !kill.has(k));
}
function addBracket() {
  let toks = tokensOf($('#in').value);
  const ks = [...sel].sort((a, b) => a - b); if (!ks.length) return;
  const noteTokens = ks.map((k) => toks[k]);
  toks = dropBrackets(toks, ks[0], ks.at(-1));
  // indexes shift after removing brackets: find the notes again by counting notes
  const noteIdx = []; toks.forEach((t, k) => { if (isNote(t)) noteIdx.push(k); });
  const all = tokensOf($('#in').value).map((t, k) => [t, k]).filter(([t]) => isNote(t));
  const first = all.findIndex(([, k]) => k === ks[0]), last = all.findIndex(([, k]) => k === ks.at(-1));
  const a = noteIdx[first], b = noteIdx[last];
  toks.splice(b + 1, 0, ')'); toks.splice(a, 0, '(');
  sel = new Set(); setTokens(toks); void noteTokens;
}
function toggleBar() {
  const toks = tokensOf($('#in').value);
  const ks = [...sel]; const allOn = ks.every((k) => toks[k].endsWith('_'));
  for (const k of ks) toks[k] = allOn ? toks[k].slice(0, -1) : (toks[k].endsWith('_') ? toks[k] : toks[k] + '_');
  setTokens(toks);
}
function clearMarks() {
  let toks = tokensOf($('#in').value);
  const ks = [...sel].sort((a, b) => a - b);
  for (const k of ks) if (toks[k].endsWith('_')) toks[k] = toks[k].slice(0, -1);
  toks = dropBrackets(toks, ks[0], ks.at(-1));
  sel = new Set(); setTokens(toks);
}
function show(n) {
  i = Math.max(0, Math.min(DATA.length - 1, n));
  const d = DATA[i], s = st[d.id] || {};
  $('#where').replaceChildren();
  const b = document.createElement('b'); b.textContent = d.where || '';
  $('#where').append(b, ` · ${d.label ? d.label + ' · ' : ''}bar ${d.bar}${d.chords ? ' · chord ' + d.chords : ''}`);
  $('#img').src = d.img;
  const cur = s.fix != null ? s.fix : d.text;
  sel = new Set(); $('#in').value = cur; cells(cur);
  const lat = $('#latin'); lat.replaceChildren();
  if (!d.latin) lat.textContent = 'none written in this bar';
  else {
    const stack = []; let cur = lat;
    for (const g of d.latin.split(/\s+/).filter(Boolean)) {
      if (g === '(') { const w = document.createElement('span'); w.className = 'slur'; cur.append(w); stack.push(cur); cur = w; continue; }
      if (g === ')') { cur = stack.pop() || lat; continue; }
      const und = g.endsWith('_'); const sp = document.createElement('span'); sp.className = 'lt' + (und ? ' u' : ''); sp.textContent = und ? g.slice(0, -1) : g; cur.append(sp);
    }
  }
  $('#note').value = s.note || '';
  $('#count').textContent = `${i + 1} of ${DATA.length}`;
  $('#st').textContent = s.status ? { ok: 'Marked: looks right', fix: 'Marked: fixed', skip: 'Marked: cannot tell' }[s.status] : 'Not checked yet';
  draw();
}
function draw() {
  const done = DATA.filter((d) => st[d.id]?.status).length;
  $('#fill').style.width = `${(100 * done) / DATA.length}%`; $('#prog').textContent = `${done} of ${DATA.length} checked`;
  const c = $('#chips'); c.replaceChildren();
  DATA.forEach((d, k) => {
    const b = document.createElement('button');
    b.className = 'chip ' + (st[d.id]?.status || '') + (k === i ? ' cur' : '');
    b.textContent = d.id.replace('R', '').replace('.B', ' · '); b.title = d.id; b.onclick = () => show(k); c.append(b);
  });
}
function mark(status) {
  const d = DATA[i], v = norm($('#in').value.trim());
  st[d.id] = { status, fix: status === 'fix' ? v : undefined, note: $('#note').value.trim() }; save();
  show(i < DATA.length - 1 ? i + 1 : i);
}
function palette() {
  const pal = $('#pal');
  for (const [k, n] of [['ස', 'sa'], ['රි', 'ri'], ['ග', 'ga'], ['ම', 'ma'], ['ප', 'pa'], ['ධ', 'dha'], ['නි', 'ni'], ['+', 'plus'], ['—', 'dash'], ['^', 'dot above'], ['_', 'bar under the note'], ['(', 'start of a bracket under the notes'], [')', 'end of the bracket'], [' ', 'space']]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'k'; b.setAttribute('aria-label', n); b.textContent = k === ' ' ? 'space' : k;
    b.addEventListener('click', () => {
      const el = $('#in'), a = el.selectionStart ?? el.value.length, z = el.selectionEnd ?? a;
      el.value = el.value.slice(0, a) + k + el.value.slice(z); el.focus(); el.setSelectionRange(a + k.length, a + k.length); sel = new Set(); cells(norm(el.value));
    });
    pal.append(b);
  }
  const back = document.createElement('button'); back.type = 'button'; back.textContent = '⌫'; back.setAttribute('aria-label', 'Delete the last letter');
  back.onclick = () => { const el = $('#in'), a = el.selectionStart ?? el.value.length; if (a > 0) { el.value = el.value.slice(0, a - 1) + el.value.slice(el.selectionEnd ?? a); el.setSelectionRange(a - 1, a - 1); cells(norm(el.value)); el.focus(); } };
  const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo my edit';
  undo.onclick = () => { sel = new Set(); $('#in').value = DATA[i].text; cells(DATA[i].text); };
  pal.append(back, undo);
}
async function send() {
  const answers = DATA.filter((d) => st[d.id]?.status).map((d) => ({ id: d.id, status: st[d.id].status, fix: st[d.id].fix || '', note: st[d.id].note || '' }));
  const msg = $('#sent');
  if (!answers.length) { msg.textContent = 'Check at least one bar first.'; return; }
  $('#send').disabled = true; msg.textContent = 'Sending…';
  try {
    const r = await fetch(WORKER, { method: 'POST', body: JSON.stringify({ sheet: SHEET, who: $('#who').value.trim(), answers }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Could not send (${r.status}).`);
    msg.textContent = `Sent ${answers.length} bar${answers.length === 1 ? '' : 's'}. Thank you!`;
    try { localStorage.setItem('nc.who', $('#who').value.trim()); } catch { /* ignore */ }
  } catch (e) { msg.textContent = (e && e.message) || 'Could not send. Please check your internet and try again.'; } finally { $('#send').disabled = false; }
}
(async () => {
  palette();
  try { $('#who').value = localStorage.getItem('nc.who') || ''; } catch { /* ignore */ }
  try {
    const d = await (await fetch('data.json')).json();
    DATA = d.bars; SHEET = d.sheet;
  } catch { $('#loading').textContent = 'Could not load the page. Please reload.'; return; }
  $('#loading').hidden = true; $('#card').hidden = false;
  $('#in').addEventListener('input', () => { sel = new Set(); cells(norm($('#in').value)); });
  $('#brk').onclick = addBracket; $('#bar').onclick = toggleBar; $('#clr').onclick = clearMarks;
  $('#ok').onclick = () => mark('ok'); $('#fix').onclick = () => mark('fix'); $('#skip').onclick = () => mark('skip');
  $('#prev').onclick = () => show(i - 1); $('#next').onclick = () => show(i + 1); $('#send').onclick = send;
  document.addEventListener('keydown', (e) => { if (e.target.matches('input,textarea')) return; if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); });
  show(0);
})();
