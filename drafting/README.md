# Notation drafting

Turns a picture of a handwritten notation sheet into a typeset PDF, and into the bar-by-bar check page (`/check/` on the site).

- `typeset.py` builds `notation.html` and `notation.rows.json` from the rows written inside it (chords, English-letter notes, Sinhala-letter notes, bars under notes `_`, brackets under notes `( )`). Sinhala-only notes are guesses and are coloured orange.
- `render_pdf.js` prints the HTML to PDF with Chromium (Playwright).
- `make_check_page.py <folder>` cuts the bars out of the picture and writes `data.json` and `crops/` for the check page.
- `song1.rows.json` is the transcription of the first sheet. Corrections sent from the check page are applied to it by hand.

The picture itself is not in the repository (it belongs to its author). Set `NOTATION_IMAGE=/path/to/original.jpg` when running.

```
NOTATION_IMAGE=original.jpg python3 typeset.py out.pdf
NODE_PATH=$(npm root -g) node render_pdf.js $PWD/out.html $PWD/out.pdf
```
