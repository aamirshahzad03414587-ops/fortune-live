# Joins the layout-check screenshots into one PNG: python3 tools/layout-composite.py <out.png> <img:label>...
import sys
from PIL import Image, ImageDraw, ImageFont
out, items = sys.argv[1], [a.rsplit('::', 1) for a in sys.argv[2:]]
W = 540; ims = [Image.open(p).convert('RGB') for p, _ in items]
ims = [im.resize((W, round(im.height * W / im.width))) for im in ims]
H = max(im.height for im in ims) + 56
canvas = Image.new('RGB', (W * len(ims) + 12 * (len(ims) - 1), H), (20, 10, 30))
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26)
except Exception: font = ImageFont.load_default()
d = ImageDraw.Draw(canvas)
for i, (im, (_, label)) in enumerate(zip(ims, items)):
    x = i * (W + 12); canvas.paste(im, (x, 56)); d.text((x + 12, 14), label, fill=(255, 220, 140), font=font)
canvas.save(out); print('wrote', out, canvas.size)
