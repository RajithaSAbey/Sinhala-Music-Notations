// A "database code" carries the repository, branch, folder and a key in one piece of text (same format as the Android app).
import { b64decode, text } from './util.js';

const FIND = /NSHELF1\.([A-Za-z0-9_-]+)/;

export function parse(pasted) {
  const m = FIND.exec((pasted || '').trim());
  if (!m) return null;
  try {
    const o = JSON.parse(text(b64decode(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const repo = String(o.r || '').trim();
    const token = String(o.t || '').trim();
    if (!repo.includes('/') || !token) return null;
    const member = Number(o.m) === 1;
    return {
      repo, branch: String(o.b || '').trim() || 'main', folder: String(o.f ?? 'notation-shelf').replace(/^\/+|\/+$/g, ''), token,
      role: member ? 'member' : 'admin',
      readOnly: !member, // an older code only reads
    };
  } catch { return null; }
}

export function create({ repo, branch, folder, token, member = true }) {
  const json = JSON.stringify({ r: repo.trim(), b: branch.trim(), f: folder.replace(/^\/+|\/+$/g, ''), t: token.trim(), ...(member ? { m: 1 } : {}) });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `NSHELF1.${b64}`;
}
