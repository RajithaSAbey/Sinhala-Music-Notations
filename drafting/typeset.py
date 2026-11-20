import base64, html, io, sys
from PIL import Image

import os
SRC = os.environ.get('NOTATION_IMAGE', 'original.jpg')  # the picture of the handwritten sheet (kept out of the repository)
OUT = sys.argv[1]
SIN = {'S': 'ස', 'R': 'රි', 'G': 'ග', 'M': 'ම', 'P': 'ප', 'D': 'ධ', 'N': 'නි'}
e = html.escape

# token syntax
#   '=X'  Latin letters exactly as written in the picture (printed in English letters)
#   'X'   Sinhala swara (S R G M P D N), my reading of the handwriting -> orange (guess)
#   '+' '—' plain marks;  '^' after a letter = dot above, '_' = dot below, '+' after = upper octave sign
# a bar is {'a': [...], 'b': [...], 'c': [(chord, position)], 'note': text}; 'a' = top line, 'b' = second line (optional)


def latin_to_sin(tok):
    # a Latin token that stands for notes -> same notes in Sinhala letters (certain, because the Latin letters are written under them)
    t = tok[1:]
    out = ''
    for ch in t:
        if ch.upper() in SIN:
            out += ch.upper()
        else:
            out += ch
    return out


def render_tok(tok, derived=False):
    if tok in ('+', '—', '‡', '·'):
        cls = 'mark'
        return f'<span class="c mark">{e(tok)}</span>'
    latin = tok.startswith('=')
    body = tok[1:] if latin else tok
    cls = 'c latin' if latin else ('c sin ok' if derived else 'c sin guess')
    out = ''
    i = 0
    marks = ''
    und = False
    for ch in body:
        if ch == '^':
            marks += '<i class="dot up"></i>'
        elif ch == '.':
            marks += '<i class="dot dn"></i>'
        elif ch == '_':
            und = True
        elif ch == '+':
            out += '<sup>+</sup>' if not latin else '+'
        elif ch == '*':
            out += '<sup class="orn">ˣ</sup>'
        elif latin:
            out += e(ch)
        elif ch in SIN:
            out += SIN[ch]
        else:
            out += e(ch)
    if und:
        cls += ' u'
    return f'<span class="{cls}">{out}{marks}</span>'


def line_html(toks, derived=False):
    out = ''
    stack = []
    cur = ''
    for t in toks:
        if t == '(':
            stack.append(cur); cur = ''
        elif t == ')':
            inner = cur; cur = stack.pop() if stack else ''
            cur += f'<span class="slur">{inner}</span>'
        else:
            cur += render_tok(t, derived)
    while stack:
        inner = cur; cur = stack.pop() + inner
    return '<div class="ln">' + cur + '</div>'


def bar_html(b):
    lines = ''
    if 'a' in b:
        lines += line_html(b['a'], derived=b.get('ad', False))
    if 'm' in b:
        lines += line_html(b['m'], derived=True)
    if 'b' in b:
        lines += line_html(b['b'])
    chords = ''.join(f'<span class="chord" style="left:{p * 100:.0f}%">{e(c)}</span>' for c, p in b.get('c', []))
    note = f'<span class="bnote">{e(b["note"])}</span>' if b.get('note') else ''
    return f'<div class="bar">{chords}{note}{lines}</div>'


ROWDATA = []


def row_html(label, bars, sect=None, tail=None, cls=''):
    ROWDATA.append({'label': label, 'bars': bars, 'sect': sect})
    s = f'<div class="sect">{e(sect)}</div>' if sect else ''
    t = f'<div class="tail">{tail}</div>' if tail else ''
    return f'<div class="sys {cls}{" hs" if sect else ""}">{s}<div class="lab">{e(label)}</div><div class="bars">' + ''.join(bar_html(b) for b in bars) + f'</div>{t}</div>'


def B(a=None, b=None, c=None, ad=False, note=None, m=None):
    if ad and b is not None:
        a = [x[1:].upper() if x.startswith('=') else x for x in b]
    d = {}
    if a is not None:
        d['a'] = a
    if b is not None:
        d['b'] = b
    if m is not None:
        d['m'] = m
    if c:
        d['c'] = c
    if ad:
        d['ad'] = True
    if note:
        d['note'] = note
    return d


def L(*xs):
    return ['=' + x if x not in ('+', '—', '(', ')') else x for x in xs]


def SL(*xs):
    """the Sinhala line that goes with a Latin line (same notes, printed in Sinhala letters)"""
    out = []
    for x in xs:
        out.append(x if x in ('+', '—') else x)
    return out


rows = []
# ---------------- INTRO
rows.append(row_html('Guit', [
    B(a=['D', 'R', 'M', 'R'], c=[('Dm', .55)]),
    B(a=['(', 'M', 'M', ')', 'M_', 'S', '—'], c=[('C', .45)]),
    B(a=['P', 'S', 'M', 'R']),
    B(a=['(', 'G', ')', 'G_', 'D', '—'], m=['+', '+', 'M', 'D^'], b=L('+', '+', 'm', 'D^'), c=[('Dm', .05)]),
], sect='INTRO'))
rows.append(row_html('SAX', [
    B(a=['R^', '—', '—', '—'], b=L('R^', '—', '—', '—'), ad=True),
    B(a=['—', '—', '‡', '—', '—'], b=['—', '—', '‡', '—', '—']),
    B(a=['S', 'D+_', 'G+_', 'S'], b=L('S', 'D+_', 'G+_', 'S'), ad=True, c=[('Am', .35)]),
    B(a=['D+_', 'G+_', 'S', 'D'], b=L('D+_', 'G+_', 'S', 'D'), ad=True),
]))
rows.append(row_html('', [
    B(a=['G', '—', '—', 'G_'], b=L('G', '—', '—', 'G_'), ad=True),
    B(a=['G', 'D', 'M', 'G'], b=L('G', 'D', 'm', 'G'), ad=True),
    B(a=['S', 'R', 'M', 'G*'], b=L('S', 'R', 'm', 'G*'), ad=True, c=[('C', .4)]),
    B(a=['—', '—', '—'], b=['—', '—', '—']),
]))
rows.append(row_html('Guit', [
    B(a=['D', 'D', 'R', '(', 'R+', ')'], c=[('Dm', .55)]),
    B(a=['(', 'M', 'M', ')', 'M_', 'M', '—']),
    B(a=['+', '(', 'R^', 'S^', ')', '(', 'R^', 'S^', ')', '(', 'R^', 'S^', ')'], b=L('+', '(', 'R^', 'S^', ')', '(', 'R^', 'S^', ')', '(', 'R^', 'S^', ')'), ad=True, c=[('Bb', .35)], note='SAX'),
    B(a=['N_', '—', 'D', 'P'], b=L('N_', '—', 'D', 'P'), ad=True),
]))
rows.append(row_html('SAX', [
    B(a=['M', '—', '—', '—'], b=L('m', '—', '—', '—'), ad=True, c=[('Dm', .55)], note='ᵖᵐᴳᵐ'),
    B(a=['(', 'M', 'M', ')', '+M_', 'M+_', 'M+_'], c=[]),
    B(a=['S', 'M', 'P', 'M'], c=[('F', .6)]),
    B(a=['(', 'M', 'R', ')', 'G_', '—'], c=[('C', .65)]),
], tail='Guit (bars 2 to 4)'))
rows.append(row_html('SAX', [
    B(a=['P+_', 'G', '—', 'S'], b=L('P+_', 'G', '—', 'S'), ad=True),
    B(a=['R', 'M', 'G', 'S'], b=L('R', 'm', 'G', 'S'), ad=True),
    B(a=['G*', '—', '—', '—'], b=L('D*', '—', '—', '—'), c=[('Dm', .45)]),
    B(a=['—', '‡', '—'], b=['—', '‡', '—']),
]))
# ---------------- CHORUS
rows.append(row_html('', [
    B(a=['+', '+', 'D', 'D'], c=[('Dm', .35)]),
    B(a=['D', 'R', 'M', 'M']),
    B(a=['G', 'S', 'G', '—'], c=[('A', .3)]),
    B(a=['—', 'M', 'M', 'R', 'S'], b=L('(', '+', '+', ')', 'P', '—'), note='Guit'),
], sect='CHORUS  𝄋', cls='rep', tail='then: <span class="c latin">Ġ</span> —'))
rows.append(row_html('', [
    B(a=['+', '+', 'P', 'P'], c=[('C', .55)]),
    B(a=['P', 'S', '—', 'G'], c=[]),
    B(a=['R', '—', '—', 'S'], b=L('+', 'S_', '—', 'S'), c=[('Dm', .35)], note='Guit / SAX'),
    B(a=['G_', 'D_', '—'], b=L('S_', '—', 'N_', '—', 'N_', '—', 'P_')),
], tail='D — · TO ⊛ · TO END'))
rows.append(row_html('', [
    B(a=['+', 'M', 'P', 'P'], c=[('D7', .35)]),
    B(a=['P', 'G', 'M', 'D']),
    B(a=['G', '—', '—', '—'], c=[('Gm', .3)], note='(2nd chorus)'),
    B(a=['—', '—', 'M', 'G']),
]))
rows.append(row_html('', [
    B(a=['+', 'D', 'G_', 'G_'], c=[('Bb', .35)]),
    B(a=['G_', '—', 'D', 'D']),
    B(a=['M', '—', '—', 'M_'], c=[('A', .3)]),
    B(a=['M', '—', '+G_', '—']),
]))
rows.append(row_html('', [
    B(a=['—', 'M', '—', '—'], c=[('A', .55)]),
    B(a=['—', 'P', 'R', 'S']),
    B(a=['(', 'D+', ')', '+', 'D', 'D'], c=[('Dm', .35)]),
    B(a=['D', 'R', 'M', 'M']),
]))
rows.append(row_html('', [
    B(a=['G', 'S', 'G', '—'], c=[('A', .1)]),
    B(a=['—', 'M', 'M', 'R', 'S'], b=L('(', '+', '+', ')', 'P', '—'), note='Guit'),
    B(a=['+', '+', 'P', 'P'], b=L('G^', '—', '—', '—'), c=[('C', .55)]),
    B(a=['P', 'S', '—', '(', 'M', 'M', ')']),
]))
rows.append(row_html('Guit', [
    B(a=['R', '—', '—', 'S'], b=L('(', 'S', 'R', ')', '—', '—'), c=[('Dm', .45)]),
    B(a=['(', 'G', 'M', ')', 'D', 'M', 'D^']), B(), B(),
]))
# ---------------- END
rows.append(row_html('', [
    B(a=['D^', 'R', '—', 'D^'], m=['D^', 'R', 'G', '—', 'D^'], c=[('Dm', .25)]),
    B(a=['—', '—', 'P^']),
    B(a=['+', 'P^', '—', 'D^'], c=[('C', .35)]),
    B(a=['P^', 'D^', 'P^', 'D^']),
], sect='END    R+F  ⊛', cls='end'))
rows.append(row_html('Guit', [
    B(a=['R+', 'R+', 'R+', 'RR'], ad=True, b=L('R+_', 'R+_', 'R+_', 'R.R._'), c=[]),
    B(a=['+R', '+R', 'R+', 'R+'], b=L('+R_', '+R_', 'R+_', 'R+_'), ad=True),
    B(a=['S+', 'S+', 'S+', 'SS'], b=L('S+_', 'S+_', 'S+_', 'SS_'), ad=True),
    B(a=['+S', '+S', 'S+', 'G+'], b=L('+S_', '+S_', 'S+_', 'G+_'), ad=True),
]))
rows.append(row_html('Guit', [
    B(a=['(', 'P', 'D', ')', '(', 'P', 'M', ')', '—'], b=L('M+_', 'M+_', 'M+_', 'MM_'), c=[('F', .55)]),
    B(a=['+', '+', 'D', 'R'], b=L('+M_', '+M_', 'M+_', 'G+_')),
    B(a=['M', '—', 'D', '—'], b=L('R+_', 'R+_', 'R+_', 'RR_'), c=[('Gm', .35)]),
    B(a=['—', '—', '—'], b=L('+G_', '+G_', 'G+_', 'G+_'), c=[('Eb', .45)]),
]))
rows.append(row_html('Guit', [
    B(a=['+', 'R', '—', 'D'], b=L('G+_', 'G+_', 'G+_', 'GG_'), c=[('C', .3)]),
    B(a=['R', 'D', 'R', 'D'], b=L('+G_', '+G_', 'G+_', 'G+_')),
    B(a=['(', 'R', 'M', ')', '(', 'R', 'D', ')', '—'], b=L('R+_', 'R+_', 'R+_', 'RR_'), c=[('Dm', .6)], note='2nd'),
    B(a=['+', '+', 'M', 'D^'], b=L('+R_', '+R_', 'R+_', 'R+_'), note='1st'),
], tail='TO 1st INTER<br>TO 2nd INTER'))
rows.append(row_html('Guit', [
    B(), B(), B(),
    B(a=['—', 'R', '—', 'M', '—'], b=['M', 'M', 'P', 'D^']),
], tail='2nd ending: TO 2nd INTER'))
# ---------------- 1st INTER
rows.append(row_html('Guit', [
    B(a=['D^', '—', '—', '—'], c=[('Dm', .45)]),
    B(a=['+', 'P', '(', 'D^', 'M', ')']),
    B(a=['D^', '—', 'D', 'M'], b=['—', '—', '=D', '=m'], c=[('F', .45)], note='SAX'),
    B(a=['M', '—', '—'], b=L('G', '—', '—'), c=[('C#', .35)]),
], sect='1st INTER'))
rows.append(row_html('SAX', [
    B(a=['M', 'P', 'D^', 'P'], b=L('m', 'P', 'D', 'p'), ad=True, c=[('Dm', .35)]),
    B(a=['M', 'D^', '—', '—'], b=L('m', 'D', '—', '—'), ad=True),
    B(a=['(', 'M', 'M', ')', '(', '+M', ')', 'P', '—'], c=[('F', .3)], note='Guit'),
    B(a=['D^', 'P', 'D^', '—']),
]))

# title crop
im = Image.open(SRC).convert('RGB')
t = im.crop((215, 0, 1060, 54))
buf = io.BytesIO(); t.save(buf, 'JPEG', quality=85)
title_b64 = base64.b64encode(buf.getvalue()).decode()
fullbuf = io.BytesIO(); im.save(fullbuf, 'JPEG', quality=88)
full_b64 = base64.b64encode(fullbuf.getvalue()).decode()

CSS = '''
@page { size: A4; margin: 10mm 10mm 12mm; }
body { font-family: "Noto Serif Sinhala","LKLUG","DejaVu Sans",serif; margin:0; color:#111; }
.banner { border:1px solid #c2410c; background:#fff3e8; padding:6px 10px; font:11px/1.4 "DejaVu Sans",sans-serif; margin-bottom:8px; }
.legend span { display:inline-block; padding:0 6px; margin:0 2px; border-radius:3px; }
.head { display:flex; align-items:center; gap:10px; margin:4px 0 6px; font:14px "DejaVu Sans",sans-serif; }
.head .big { font-weight:bold; }
.head img { height:34px; }
.sys { position:relative; display:flex; align-items:flex-end; margin:11px 0 4px; page-break-inside:avoid; }
.sys.hs { margin-top:30px; }
.sect { position:absolute; left:0; top:-14px; font:bold 12px "DejaVu Sans",sans-serif; letter-spacing:.5px; }
.lab { width:34px; font:italic 10px "DejaVu Sans",sans-serif; text-align:right; padding-right:4px; flex:none; }
.bars { display:flex; flex:1; border-left:1.6px solid #111; }
.bar { position:relative; flex:1; min-width:0; border-right:1.6px solid #111; padding:15px 4px 2px; }
.ln { display:flex; justify-content:space-around; align-items:flex-end; min-height:21px; }
.c { position:relative; min-width:16px; text-align:center; font-size:15px; line-height:21px; padding:0 1px; }
.c.latin { font-family:"DejaVu Sans",sans-serif; font-size:12px; font-weight:600; }
.c.mark { font-family:"DejaVu Sans",sans-serif; }
.c.sin.guess { background:#ffd9b0; border-radius:3px; }
.c.u::after { content:''; position:absolute; left:2px; right:2px; bottom:-1px; border-bottom:1.4px solid #111; }
.slur { display:inline-flex; position:relative; padding-bottom:4px; }
.slur::after { content:''; position:absolute; left:3px; right:3px; bottom:0; height:5px; border:1.4px solid #111; border-top:none; border-radius:0 0 50% 50% / 0 0 100% 100%; }
.c sup { font-size:9px; }
.dot { position:absolute; width:3px; height:3px; border-radius:50%; background:#111; left:50%; margin-left:-1.5px; }
.dot.up { top:0; } .dot.dn { bottom:-1px; }
.chord { position:absolute; top:-1px; font:bold 11px "DejaVu Sans",sans-serif; color:#c01818; transform:translateX(-30%); }
.bnote { position:absolute; right:3px; top:0; font:9px "DejaVu Sans",sans-serif; color:#555; }
.tail { font:10px "DejaVu Sans",sans-serif; margin-left:6px; width:72px; flex:none; }
.sys.end { page-break-before:always; }
.pg2 { page-break-before:always; }
.pg2 img { height:240mm; width:auto; max-width:100%; display:block; margin:0 auto; }
'''
page = f'''<!doctype html><meta charset="utf-8"><style>{CSS}</style>
<div class="banner"><b>Draft typeset copy.</b> English-letter notes, chords, section names and marks are copied as written.
Sinhala-letter notes are my reading of handwriting that is often unclear:
<span class="legend"><span style="background:#ffd9b0">orange</span> = guessed, please check against the picture on the last page;
<span style="border:1px solid #bbb">no colour</span> = taken from the English letters written under or beside it.</div>
<div class="head"><img src="data:image/jpeg;base64,{title_b64}" alt="Title line copied from the picture"></div>
{''.join(rows)}
<div class="pg2"><div class="banner"><b>The picture this was typed from</b> (for checking)</div><img src="data:image/jpeg;base64,{full_b64}"></div>'''
open(OUT.replace('.pdf', '.html'), 'w', encoding='utf-8').write(page)
print('ok')

import json
json.dump(ROWDATA, open(OUT.replace('.pdf', '.rows.json'), 'w', encoding='utf-8'), ensure_ascii=False)
