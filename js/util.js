// Small helpers shared by every module. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Creates an element. Children can be strings, nodes or arrays. Text is always inserted as text, never as HTML. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function hex(buf) { return [...new Uint8Array(buf)].map((n) => n.toString(16).padStart(2, '0')).join(''); }
export async function sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

/** The id git gives a file's content ("blob"), so we know a file's version without asking GitHub. */
export async function gitBlobSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(head.length + bytes.byteLength);
  all.set(head); all.set(new Uint8Array(bytes), head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

export function b64encode(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const s = atob(str.replace(/\s+/g, ''));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export const utf8 = (text) => new TextEncoder().encode(text);
export const text = (bytes) => new TextDecoder().decode(bytes);

export function ago(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** GitHub's request limit was reached: wait until resetAt (ms since 1970). */
export class RateLimited extends Error {
  constructor(resetAt) { super("GitHub's request limit was reached"); this.resetAt = resetAt; }
}
/** The server will keep refusing: wrong key, no permission, repository not found. */
export class PermanentError extends Error {}
