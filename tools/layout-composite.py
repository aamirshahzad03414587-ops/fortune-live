# Phone mock + composite for tools/layout-check.mjs: python3 tools/layout-composite.py plan.json out.png
import json, sys
from PIL import Image, ImageDraw, ImageFont
plan = json.load(open(sys.argv[1])); out = sys.argv[2]
PW, PH, CROP, Z = plan['pw'], plan['ph'], plan['crop'], plan['zones']
def font(sz, bold=True):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else ''), sz)
    except Exception: return ImageFont.load_default()
def phone(raw):
    im = Image.open(raw).convert('RGB'); im = im.crop((CROP, 0, im.width - CROP, im.height)).resize((PW, PH))
    ov = Image.new('RGBA', (PW, PH), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    t = Z['top'][3] * PH
    d.rectangle((0, 0, PW, t), fill=(0, 0, 0, 70)); d.line((0, t, PW, t), fill=(255, 70, 110, 255), width=2)
    d.rounded_rectangle((8, 30, 210, 66), 18, fill=(0, 0, 0, 120)); d.ellipse((12, 34, 40, 62), fill=(190, 190, 190, 255))
    d.text((46, 38), 'Host · Join', font=font(16), fill='white'); d.rounded_rectangle((8, 76, 190, 100), 10, fill=(80, 40, 140, 170)); d.text((14, 79), 'Weekly league · Boost', font=font(13, False), fill='white')
    d.rounded_rectangle((PW - 130, 36, PW - 50, 62), 12, fill=(0, 0, 0, 120)); d.text((PW - 120, 39), '327', font=font(15), fill='white'); d.text((PW - 34, 33), 'x', font=font(22), fill='white')
    x1, y0, y1 = Z['comments'][2] * PW, Z['comments'][1] * PH, Z['comments'][3] * PH
    d.rectangle((0, y0, x1, y1), fill=(255, 40, 80, 28), outline=(255, 70, 110, 255), width=2)
    lines = [('', 'Welcome to TikTok LIVE! Have fun interacting with others in real time. Creators must be 18+.'), ('zoya_22', 'joined'),
             ('amir_k', 'Amir 23/6/1997'), ('sara.m', 'Sara 12/05/1998 will I travel?'), ('hina_x', 'hi Mira 💜'), ('Ayesha_99', 'sent Rose x1'), ('bilal', 'joined'), ('omar_fq', 'Omar 25/11/1991')]
    # TikTok stacks comments from the bottom of this area upwards (the welcome message is the oldest, on top)
    y = y1 - 8
    for who, txt in reversed(lines):
        f = font(14, False); h = 34 if not who else 22
        y -= h
        d.rounded_rectangle((6, y, x1 - 6, y + h), 9, fill=(0, 0, 0, 95)); d.text((12, y + 3), (who + '  ' if who else '') + txt[:58] + ('…' if len(txt) > 58 else ''), font=f, fill=(255, 225, 150, 255) if who else (220, 230, 255, 255))
        y -= 8
    b = Z['bottom'][1] * PH
    d.rectangle((0, b, PW, PH), fill=(0, 0, 0, 80)); d.rounded_rectangle((10, b + 14, PW - 140, PH - 16), 20, fill=(255, 255, 255, 60)); d.text((24, b + 24), 'Type...', font=font(16, False), fill='white')
    for i, ic in enumerate(['?', '♥', '🎁', '↗']): d.ellipse((PW - 130 + i * 31, b + 16, PW - 104 + i * 31, b + 42), fill=(255, 255, 255, 70))
    return Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
G = 14; LAB = 44
rows = plan['rows']; cols = max(len(r['shots']) for r in rows)
canvas = Image.new('RGB', (cols * PW + (cols - 1) * G + 150, len(rows) * (PH + LAB) + (len(rows) - 1) * G), (18, 8, 28))
d = ImageDraw.Draw(canvas)
for ri, r in enumerate(rows):
    y = ri * (PH + LAB + G)
    d.text((10, y + PH / 2), r['label'].upper(), font=font(30), fill=(255, 210, 120))
    for ci, s in enumerate(r['shots']):
        x = 150 + ci * (PW + G)
        canvas.paste(phone(s['raw']), (x, y + LAB)); d.text((x + 6, y + 8), f"{r['label']} · {s['state']}", font=font(24), fill=(255, 220, 140))
canvas.save(out); print('wrote', out, canvas.size)
