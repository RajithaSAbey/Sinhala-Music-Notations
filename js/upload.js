// Adding pictures and PDFs to the database: spot repeats, name them, join songs with the same title, send them to GitHub.
import { sha256, uuid, sleep, RateLimited, PermanentError } from './util.js';
import { newSong, parseSong, plainCopy, UNTITLED } from './library.js';
import { same } from './phonetic.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;
export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

/** Everything dropped on the page, including folders inside folders. */
export async function expandDrop(dataTransfer) {
  const out = [];
  const walk = async (entry, depth = 0) => {
    if (!entry || depth > 30) return;
    if (entry.isFile) { await new Promise((res) => entry.file((f) => { out.push(f); res(); }, res)); return; }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const e of batch) await walk(e, depth + 1);
      }
    }
  };
  const items = [...(dataTransfer.items || [])];
  if (items.length && items[0].webkitGetAsEntry) {
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean); // must be read before the first await
    for (const e of entries) await walk(e);
  } else out.push(...(dataTransfer.files || []));
  return out;
}

const CAMERA_WORDS = /\b(img|image|dsc\w*|pxl\w*|photo|pic|picture|scan|scanned|whatsapp|wa\d*|screenshot|screen|shot|received|signal|file|untitled|document|doc|page|cam|camera|vid|mvimg|snap|fb|facebook|download|at|am|pm|copy)\b/gi;

/** A song title from a file name, or '' when the name says nothing ("IMG_2231.jpg"). */
export function titleFromName(name) {
  let t = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  t = t.replace(/\s*\((\d+)\)\s*$/, '').replace(/\s*-\s*copy(\s*\d+)?\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) return '';
  if (/^[\d\s.\-:]+$/.test(t)) return '';
  if (/^[0-9a-f-]{16,}$/i.test(t)) return '';
  // nothing left once camera words, dates and numbers are taken out: the name says nothing
  if (t.replace(CAMERA_WORDS, ' ').replace(/[\d_\-.:()\s]+/g, '').length < 3) return '';
  return t;
}

/** The picture as JPEG bytes. A JPEG is sent exactly as it is (no quality loss); other formats are converted without shrinking. */
export async function pictureBytes(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xd8) return buf;
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95));
  if (!blob) throw new Error('Could not convert');
  return new Uint8Array(await blob.arrayBuffer());
}

let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

/** Every page of a PDF as JPEG bytes. */
export async function pdfPages(file, { maxPages = 400, onPage } = {}) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1.5, 1800 / Math.max(base.width, 1)));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      out.push(new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally { doc.destroy(); }
  return out;
}

// ---- reading a title from the picture itself (best effort; Sinhala reading is often poor) ----
let ocrWorker;
async function ocrTitle(bytes) {
  const T = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js');
  ocrWorker ??= await T.createWorker('sin+eng');
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const h = Math.round(bmp.height * 0.2);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, bmp.width, h, 0, 0, bmp.width, h);
  const { data } = await ocrWorker.recognize(c);
  const line = (data.lines || []).find((l) => l.confidence >= 75 && ((l.text.match(/[඀-෿]/g) || []).length >= 3 || (l.text.match(/[A-Za-z]/g) || []).length >= 4));
  return line ? line.text.replace(/[^඀-෿A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/**
 * Adds the chosen files to the database.
 * opts: { readTitles, onStatus(text), onProgress(done,total), signal:{cancelled} }
 * Returns { added, merged, todo, duplicates, unreadable, pictures }.
 */
export async function addToDatabase(lib, files, opts = {}) {
  const { readTitles = false, onStatus = () => {}, onProgress = () => {}, signal = { cancelled: false } } = opts;
  const result = { songs: 0, merged: 0, todo: 0, duplicates: 0, unreadable: 0, pictures: 0, stopped: false };
  const units = files.filter((f) => isPdf(f) || isImage(f));
  result.unreadable = files.length - units.length;
  units.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const batchSongs = new Map(); // songs created or changed in the batch not yet sent
  const queue = []; // { file, bytes }
  const seen = new Set(); // hashes added in this run
  let queued = 0;

  const withWait = async (fn) => {
    for (;;) {
      try { return await fn(); } catch (e) {
        if (!(e instanceof RateLimited)) throw e;
        const until = Math.min(e.resetAt, Date.now() + 65 * 60_000);
        while (Date.now() < until) {
          if (signal.cancelled) throw e;
          const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
          onStatus(`GitHub asked us to pause. Continuing automatically in about ${mins} min. You can leave this page open.`);
          await sleep(1000);
        }
      }
    }
  };

  const flush = async () => {
    if (!batchSongs.size && !queue.length) return;
    const songs = [...batchSongs.values()];
    const pics = queue.splice(0);
    queued = 0;
    batchSongs.clear();
    onStatus(`Saving ${songs.length} song${songs.length === 1 ? '' : 's'} to the database…`);
    await withWait(() => lib.commitChanges(songs, pics, `Add ${songs.length} song${songs.length === 1 ? '' : 's'} from the web`));
  };

  const findTarget = (title) => {
    for (const s of batchSongs.values()) if (s.titleState !== 2 && same(title, s.title)) return s;
    return lib.findSame(title);
  };

  let done = 0;
  for (const f of units) {
    if (signal.cancelled) { result.stopped = true; break; }
    onProgress(done, units.length);
    onStatus(`Reading ${f.name}`);
    let pics;
    try {
      pics = isPdf(f) ? await pdfPages(f, { onPage: (n, t) => onStatus(`Reading ${f.name} (page ${n} of ${t})`) }) : [await pictureBytes(f)];
    } catch { result.unreadable++; done++; continue; }
    if (!pics.length) { result.unreadable++; done++; continue; }

    const fresh = [];
    for (const bytes of pics) {
      const hash = await sha256(bytes);
      if (lib.hashes.has(hash) || seen.has(hash)) { result.duplicates++; continue; }
      seen.add(hash);
      fresh.push({ bytes, hash, file: `${uuid()}.jpg` });
    }
    if (!fresh.length) { done++; continue; }

    let title = titleFromName(f.name);
    if (!title && readTitles && !isPdf(f)) {
      onStatus(`Trying to read the title of ${f.name}…`);
      title = await Promise.race([ocrTitle(fresh[0].bytes), sleep(60000).then(() => '')]).catch(() => '');
    }
    const pages = fresh.map((p) => ({ file: p.file, rotation: 0, hash: p.hash }));
    let target = title ? findTarget(title) : null;
    if (target && !batchSongs.has(target.uid)) {
      // an existing song: start from its newest copy on GitHub, so nobody's change is lost
      const latest = await withWait(() => lib.repo.fileWithSha(lib.repo.path(`songs/${target.uid}.json`))).catch(() => null);
      target = latest ? parseSong(new TextDecoder().decode(latest.bytes), latest.sha) : plainCopy(target);
    }
    let ownerUid;
    if (target) {
      target.pages.push(...pages);
      target.updatedAt = Math.max(Date.now(), target.updatedAt + 1);
      batchSongs.set(target.uid, target);
      ownerUid = target.uid;
      result.merged++;
    } else {
      const s = newSong(title || UNTITLED, { pages, sourceName: f.name, titleState: title ? 0 : 2 });
      batchSongs.set(s.uid, s);
      ownerUid = s.uid;
      if (title) result.songs++; else result.todo++;
    }
    for (const p of fresh) { queue.push({ file: p.file, bytes: p.bytes }); queued += p.bytes.length; lib.hashes.set(p.hash, ownerUid); }
    result.pictures += fresh.length;
    done++;
    if (queue.length >= 30 || queued >= 40 * 1024 * 1024) await flush();
  }
  onProgress(done, units.length);
  await flush();
  return result;
}

export function describe(r) {
  const bits = [];
  if (r.songs) bits.push(`${r.songs} new song${r.songs === 1 ? '' : 's'}`);
  if (r.merged) bits.push(`${r.merged} added to songs that were already there`);
  if (r.todo) bits.push(`${r.todo} waiting in the To-do tab for a name`);
  if (r.duplicates) bits.push(`${r.duplicates} skipped because ${r.duplicates === 1 ? 'it was' : 'they were'} already in the database`);
  if (r.unreadable) bits.push(`${r.unreadable} could not be read`);
  return bits.length ? bits.join(', ') + '.' : 'Nothing new to add.';
}
export { PermanentError };
