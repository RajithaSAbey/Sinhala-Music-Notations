# Sinhala Music Notations (web)

A web app for the Notation Shelf database of Sinhala song notations. It works in any modern browser and can be added to the
iPhone / iPad / Android home screen like an app (it is a PWA: installable, works offline for songs you have opened).

**Open it:** https://rajithasabey.github.io/Sinhala-Music-Notations/

## What it does

Same as the Android app:

- Search by song or singer in **Sinhala or English letters** ("sanda" finds "සඳ"), did-you-mean, voice search, sort, favourites, recent, letter strip, select several songs.
- Singers tab, albums / set lists (admin's albums sync between devices, helpers' albums stay on their device), keep an album for offline use.
- Full-screen reader: swipe, tap the edges, pinch / double-tap zoom, keyboard and page-turner pedals, dark stage mode with brightness, screen stays awake, chords link bottom-left, share, turn a page.
- Add pictures, PDFs or whole folders (drag and drop). JPEGs are stored byte-for-byte (no quality loss), repeats are skipped by fingerprint (SHA-256), same-title songs join as extra pages, pictures with no useful file name go to the **To-do** tab.
- To-do tab with plain instructions; helpers can name pictures or mark them "not a song"; only the admin can delete.
- Message to the admin (with pictures) – it appears in the admin panel of the nightly backup.
- Roles come from the database code (`NSHELF1.…`): admin, helper (can add, cannot delete), reader.

## How it works

There is no server. The page talks straight to GitHub's API with the key inside the person's database code, which is kept only in that browser (`localStorage`). The key is sent only to `api.github.com` (enforced by a Content-Security-Policy).

- First visit: downloads the search list in one file (`catalog.json` on the `web-catalog` branch, refreshed nightly by the backup job in the `REST` repository). If it is missing, songs are fetched one by one.
- Later visits: compares the git ids of the song files with what is stored on the device and fetches only what changed.
- Pictures are fetched when opened and kept on the device (IndexedDB).
- Saving uses the git data API (pictures → tree → one commit), the same way the Android app does, and the same file formats, so both stay compatible.

Limits to know: GitHub allows about 5,000 requests per hour per key and about 500 new pictures per hour; the app waits and continues by itself when it is told to slow down.

## Publishing

Push to `main`. The workflow in `.github/workflows/pages.yml` publishes to GitHub Pages.
One-time setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Developing

```
npm test            # quick checks (search rules, database code, file format)
npm run test:e2e    # the whole app in headless Chromium against a fake GitHub (needs Playwright)
npm run serve       # http://localhost:8080
```

`vendor/pdfjs` is pdf.js (Apache-2.0), used to turn PDF pages into pictures in the browser.
