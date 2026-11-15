// Where the public copy of the library lives (Cloudflare R2). Anyone can read it; nobody can change it from the web.
export const PUBLIC_BASE = 'https://pub-1c5827d145f949969424a7ed623d5039.r2.dev';
export const PUBLIC_CFG = { repo: 'public', branch: '', folder: '', token: '', role: 'public', readOnly: true };

// Where the public web app sends pictures (a Cloudflare Worker that can only add pictures to a private intake).
export const UPLOAD_URL = 'https://intake.sinhala-music.workers.dev/upload';
export const EDIT_URL = UPLOAD_URL.replace(/\/upload$/, '/edit');
