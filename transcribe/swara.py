"""Turns a note (MIDI number) into a swara letter relative to the key's Sa.

Only the seven natural degrees are mapped for now (S R G M P D N). Other semitones return None:
how they are written on the sheets (for example the lower-case m and p seen on the first sheet) is to be learnt
from the corrected bars on the check page, not guessed.
"""
DEGREES = {0: 'S', 2: 'R', 4: 'G', 5: 'M', 7: 'P', 9: 'D', 11: 'N'}


def to_swara(midi: int, sa: int, home_octave: int = 0):
    """Returns e.g. 'G', 'D+' (upper octave) or 'N.' (lower octave); None when the note is not a natural degree."""
    offset = midi - sa
    octave, semitone = divmod(offset, 12)
    letter = DEGREES.get(semitone)
    if letter is None:
        return None
    octave -= home_octave
    return letter + ('+' * octave if octave > 0 else '.' * -octave)
