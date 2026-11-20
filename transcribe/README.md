# MP3 to notation (training and tools)

Goal: from a recording of a song, produce a draft of the melody in swara letters (with chords), in the style of the notation sheets in `notation-drafting`. A person then corrects the draft on the check page. The corrections are the training data.

Plan
1. **Melody from audio** with open-source models (Basic Pitch or similar for notes, Demucs for separating the voice).
2. **Key and chords** estimated from the recording.
3. **Notes to swara letters** (`swara.py`): offset from the key's Sa, upper octave `+`, lower octave `.`.
4. **Write the bars** (4 notes to a bar, chords above) and typeset with `notation-drafting/typeset.py`.
5. **Learn from corrections**: compare each draft with the bars people confirmed on the check page, measure where it is wrong, improve the rules or the model.

Needs an audio file (mp3 or wav) of each song. Nothing is downloaded from video sites.

`pip install -r requirements.txt` then `python -m unittest discover -s ../tests_transcribe`.
