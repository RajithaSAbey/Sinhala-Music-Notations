// Bar-by-bar review of a typeset notation sheet. Answers are kept in this browser and sent to the owner on request.
const WORKER = 'https://intake.sinhala-music.workers.dev/fix';
const SIN = { S: 'ස', R: 'රි', G: 'ග', M: 'ම', P: 'ප', D: 'ධ', N: 'නි' };
const $ = (s) => document.querySelector(s);
let DATA = [], SHEET = 'song1', st = {}, i = 0;
try { st = JSON.parse(localStorage.getItem('nc.state') || '{}'); } catch { /* private window */ }
const save = () => { try { localStorage.setItem('nc.state', JSON.stringify(st)); } catch { /* ignore */ } };
const norm = (t) => [...t].map((c) => (/[A-Za-z]/.test(c) && SIN[c.toUpperCase()]) || c).join('');

function cells(text) {
  const box = $('#cells'); box.replaceChildren();
  for (const g of text.trim().split(/\s+/).filter(Boolean)) {
    const s = document.createElement('span');
    s.className = 'cell' + (/^[+—\-‡]+$/.test(g) ? ' mark' : '');
    s.textContent = g; box.append(s);
  }
}
function show(n) {
  i = Math.max(0, Math.min(DATA.length - 1, n));
  const d = DATA[i], s = st[d.id] || {};
  $('#where').replaceChildren();
  const b = document.createElement('b'); b.textContent = d.where || '';
  $('#where').append(b, ` · ${d.label ? d.label + ' · ' : ''}bar ${d.bar}${d.chords ? ' · chord ' + d.chords : ''}`);
  $('#img').src = d.img;
  const cur = s.fix != null ? s.fix : d.text;
  $('#in').value = cur; cells(cur);
  $('#latin').textContent = d.latin || 'none written in this bar';
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
  for (const [k, n] of [['ස', 'sa'], ['රි', 'ri'], ['ග', 'ga'], ['ම', 'ma'], ['ප', 'pa'], ['ධ', 'dha'], ['නි', 'ni'], ['+', 'plus'], ['—', 'dash'], ['^', 'dot above'], [' ', 'space']]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'k'; b.setAttribute('aria-label', n); b.textContent = k === ' ' ? 'space' : k;
    b.addEventListener('click', () => {
      const el = $('#in'), a = el.selectionStart ?? el.value.length, z = el.selectionEnd ?? a;
      el.value = el.value.slice(0, a) + k + el.value.slice(z); el.focus(); el.setSelectionRange(a + k.length, a + k.length); cells(norm(el.value));
    });
    pal.append(b);
  }
  const back = document.createElement('button'); back.type = 'button'; back.textContent = '⌫'; back.setAttribute('aria-label', 'Delete the last letter');
  back.onclick = () => { const el = $('#in'), a = el.selectionStart ?? el.value.length; if (a > 0) { el.value = el.value.slice(0, a - 1) + el.value.slice(el.selectionEnd ?? a); el.setSelectionRange(a - 1, a - 1); cells(norm(el.value)); el.focus(); } };
  const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo my edit';
  undo.onclick = () => { $('#in').value = DATA[i].text; cells(DATA[i].text); };
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
  $('#in').addEventListener('input', () => cells(norm($('#in').value)));
  $('#ok').onclick = () => mark('ok'); $('#fix').onclick = () => mark('fix'); $('#skip').onclick = () => mark('skip');
  $('#prev').onclick = () => show(i - 1); $('#next').onclick = () => show(i + 1); $('#send').onclick = send;
  document.addEventListener('keydown', (e) => { if (e.target.matches('input,textarea')) return; if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); });
  show(0);
})();
