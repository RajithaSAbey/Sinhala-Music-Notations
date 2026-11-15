// Finds Sinhala song names whether they are typed in Sinhala letters or spelled in English letters ("Singlish").
// A port of the Android app's Phonetic + TitleMatch, so both find the same songs.

const INDEPENDENT = { 'අ': 'a', 'ආ': 'aa', 'ඇ': 'ae', 'ඈ': 'aae', 'ඉ': 'i', 'ඊ': 'ii', 'උ': 'u', 'ඌ': 'uu', 'ඍ': 'ru', 'ඎ': 'ruu', 'ඏ': 'lu', 'ඐ': 'luu', 'එ': 'e', 'ඒ': 'ee', 'ඓ': 'ai', 'ඔ': 'o', 'ඕ': 'oo', 'ඖ': 'au' };
const CONSONANT = { 'ක': 'k', 'ඛ': 'kh', 'ග': 'g', 'ඝ': 'gh', 'ඞ': 'ng', 'ඟ': 'ng', 'ච': 'ch', 'ඡ': 'chh', 'ජ': 'j', 'ඣ': 'jh', 'ඤ': 'ny', 'ඥ': 'gn', 'ඦ': 'nj', 'ට': 't', 'ඨ': 'th', 'ඩ': 'd', 'ඪ': 'dh', 'ණ': 'n', 'ඬ': 'nd', 'ත': 't', 'ථ': 'th', 'ද': 'd', 'ධ': 'dh', 'න': 'n', 'ඳ': 'nd', 'ප': 'p', 'ඵ': 'ph', 'බ': 'b', 'භ': 'bh', 'ම': 'm', 'ඹ': 'mb', 'ය': 'y', 'ර': 'r', 'ල': 'l', 'ව': 'v', 'ශ': 'sh', 'ෂ': 'sh', 'ස': 's', 'හ': 'h', 'ළ': 'l', 'ෆ': 'f' };
const SIGN = { 'ා': 'aa', 'ැ': 'ae', 'ෑ': 'aae', 'ි': 'i', 'ී': 'ii', 'ු': 'u', 'ූ': 'uu', 'ෘ': 'ru', 'ෲ': 'ruu', 'ෙ': 'e', 'ේ': 'ee', 'ෛ': 'ai', 'ො': 'o', 'ෝ': 'oo', 'ෞ': 'au', 'ෟ': 'lu', 'ෳ': 'luu' };
const VIRAMA = '්';
const isSinhalaChar = (c) => c >= '඀' && c <= '෿';

export const hasSinhala = (s) => [...s].some(isSinhalaChar);

export function toLatin(textIn) {
  const s = [...textIn].filter((c) => c !== '‍' && c !== '‌');
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (CONSONANT[c] !== undefined) {
      out += CONSONANT[c];
      const n = s[i + 1];
      if (n === VIRAMA) i += 2;
      else if (n !== undefined && SIGN[n] !== undefined) { out += SIGN[n]; i += 2; } else { out += 'a'; i++; }
    } else if (INDEPENDENT[c] !== undefined) { out += INDEPENDENT[c]; i++; }
    else if (c === 'ං') { out += 'n'; i++; }
    else if (c === 'ඃ') { out += 'h'; i++; }
    else if (isSinhalaChar(c)) i++;
    else { out += c; i++; }
  }
  return out;
}

export function key(textIn) {
  let s = toLatin(textIn).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  s = s.replace(/aae/g, 'a').replace(/ae/g, 'a').replace(/chh/g, 'c').replace(/ch/g, 'c').replace(/sh/g, 's')
    .replace(/th/g, 't').replace(/dh/g, 'd').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/bh/g, 'b')
    .replace(/ph/g, 'p').replace(/jh/g, 'j').replace(/v/g, 'w').replace(/q/g, 'k');
  return s.replace(/(.)\1+/g, '$1').replace(/ +/g, ' ').trim();
}
export const skeleton = (k) => [...k].filter((c) => c !== ' ' && !'aeiou'.includes(c)).join('');

export function tokens(query) {
  return query.trim().split(/\s+/).filter(Boolean).map((t) => { const k = key(t); return { plain: t.toLowerCase(), key: k, skeleton: skeleton(k) }; });
}

/** Pre-computed forms of a piece of text, for fast matching of many songs. */
export class Index {
  constructor(textIn) {
    this.plain = textIn.toLowerCase();
    this.key = key(textIn);
    this.skel = skeleton(this.key);
  }
  matches(toks) {
    return toks.every((t) => this.plain.includes(t.plain) || (t.key && this.key.includes(t.key)) || (t.skeleton.length >= 3 && this.skel.includes(t.skeleton)));
  }
}

function edit(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const nospace = (t) => key(t).replace(/ /g, '');

/** 0 (nothing alike) .. 1 (same sound). */
export function similarity(a, b) {
  const x = nospace(a), y = nospace(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - edit(x, y) / Math.max(x.length, y.length);
}
/** The same song: at least 80% alike, and not too short to be a coincidence. */
export function same(a, b) {
  const x = nospace(a), y = nospace(b);
  return Math.min(x.length, y.length) >= 4 && similarity(a, b) >= 0.8;
}
