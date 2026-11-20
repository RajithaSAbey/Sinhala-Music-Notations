import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1]  # the check/ folder in the web repo
SRC = os.environ.get('NOTATION_IMAGE', 'original.jpg')
SHEET = 'song1'
R = json.load(open(ROOT + 'song1.rows.json', encoding='utf-8'))
im = Image.open(SRC).convert('RGB')
Y = [(46, 150), (148, 238), (232, 308), (300, 378), (372, 468), (462, 552), (548, 628), (620, 712), (722, 802), (792, 860), (850, 935), (900, 968),
     (978, 1052), (1045, 1145), (1135, 1185), (1180, 1255), (1250, 1345), (1335, 1400), (1380, 1480), (1470, 1566)]
X = [128, 345, 562, 762, 985]
SIN = {'S': 'ස', 'R': 'රි', 'G': 'ග', 'M': 'ම', 'P': 'ප', 'D': 'ධ', 'N': 'නි'}
os.makedirs(OUT + '/crops', exist_ok=True)


def to_text(tokens):
    return ' '.join(''.join(SIN.get(ch, ch) for ch in t) for t in tokens if not t.startswith('='))


bars = []
cur = ''
for i, r in enumerate(R):
    if r.get('sect'):
        cur = r['sect'].replace('𝄋', '').replace('⊛', '').replace('R+F', '').strip()
    a0, b0 = Y[i]
    for j, b in enumerate(r['bars']):
        a = b.get('a')
        if not a or b.get('ad'):
            continue
        if not any(ch in SIN for t in a if not t.startswith('=') for ch in t):
            continue
        bid = f'R{i + 1}.B{j + 1}'
        crop = im.crop((X[j] - 10, max(0, a0 - 6), X[j + 1] + 10, min(im.height, b0 + 6)))
        crop = crop.resize((int(crop.width * 2.0), int(crop.height * 2.0)), Image.LANCZOS)
        crop.save(f'{OUT}/crops/{bid}.jpg', 'JPEG', quality=80)
        bars.append({'id': bid, 'where': cur, 'label': r.get('label') or '', 'bar': j + 1, 'chords': ' '.join(c for c, _ in b.get('c', [])),
                     'text': to_text(a), 'latin': ' '.join(t[1:] if t.startswith('=') else t for t in b.get('b', [])) if 'b' in b else '', 'img': f'crops/{bid}.jpg'})
json.dump({'sheet': SHEET, 'bars': bars}, open(OUT + '/data.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(len(bars), 'bars')
