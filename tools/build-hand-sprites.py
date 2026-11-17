#!/usr/bin/env python3
"""Hand sprites for the crystal-ball gaze (phone mode): cut her two hovering hands out of an AI-edited still
(tools/hands-src/v1.jpg, v2.jpg: the same scene with her hands raised over the ball), skin-keyed, cleaned, feathered at
the wrist, scaled to the phone sprites (by the crystal ball's size) and written to public/assets/phone/<v>/hand-l.png,
hand-r.png. Their place (relative to the ball) goes into phone.json "hands"."""
import json, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = __file__.rsplit('/tools/', 1)[0]
# per version: the ball in the source still (cx, cy, r) and a box around each hand
SRC = {
  # cuffs: where each raised hand's wrist meets her sleeve (the hand bends up from the cuff toward the ball)
  'v1': {'ball': (512, 616, 120), 'boxes': [(290, 450, 450, 590), (585, 455, 745, 605)], 'cuffs': [(214, 888), (566, 888)]},
  'v2': {'ball': (454, 700, 116), 'boxes': [(290, 470, 450, 620), (555, 470, 715, 625)], 'cuffs': [(206, 992), (590, 992)]},
}

def cut(im, box):
  x0, y0, x1, y1 = box
  c = im[y0:y1, x0:x1].astype(float); R, G, B = c[..., 0], c[..., 1], c[..., 2]
  lum = (R + G + B) / 3
  m = (R > 150) & (lum > 140) & (G > 100)
  m = ndi.binary_opening(m, iterations=1)
  lab, n = ndi.label(m)
  if n: m = lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))
  m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=3))
  a = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
  rgba = Image.fromarray(c.astype(np.uint8)).convert('RGBA'); rgba.putalpha(a)
  return rgba

def main():
  for v, s in SRC.items():
    man_p = f'{ROOT}/public/assets/phone/{v}/phone.json'; man = json.load(open(man_p))
    im = np.asarray(Image.open(f'{ROOT}/tools/hands-src/{v}.jpg').convert('RGB'))
    gx, gy, gr = s['ball']; bx, by, br = man['ball']; k = br / gr
    hands = {}
    for side, box in zip(('l', 'r'), s['boxes']):
      sp = cut(im, box)
      # the wrist end fades out (the hand rises out of a soft violet glow, no hard cut at the sleeve)
      w, h = sp.size; a = np.asarray(sp.split()[3]).astype(float)
      xs = np.linspace(0, 1, w)[None, :]
      fade = np.clip((xs - 0.0) / 0.28, 0, 1) if side == 'r' else np.clip((1 - xs) / 0.28, 0, 1)
      # the wrist is on the outer, lower side: fade along x toward the outside and y toward the bottom
      ys = np.linspace(0, 1, h)[:, None]
      outer = (1 - xs) if side == 'l' else xs
      a = a * np.clip(1 - np.clip((outer - 0.62) / 0.38, 0, 1) * np.clip((ys - 0.45) / 0.55, 0, 1) * 1.15, 0, 1)
      sp.putalpha(Image.fromarray(a.clip(0, 255).astype(np.uint8)))
      sw, sh = max(2, round(w * k)), max(2, round(h * k))
      sp = sp.resize((sw, sh), Image.LANCZOS)
      sp.save(f'{ROOT}/public/assets/phone/{v}/hand-{side}.png', optimize=True)
      cx, cy = s['cuffs'][0 if side == 'l' else 1]
      wx, wy = (0.12 * sw, 0.88 * sh) if side == 'l' else (0.88 * sw, 0.88 * sh)   # the wrist corner of the sprite
      hands[side] = {'src': f'hand-{side}.png', 'rect': [round(cx - wx, 1), round(cy - wy, 1), sw, sh], 'wrist': [cx, cy]}
      print(v, side, hands[side])
    man['hands'] = hands
    json.dump(man, open(man_p, 'w'), indent=1)

# v1 shows her real hands resting on the table: they are cut out (lifted about the wrist while she gazes) and the table
# under them is filled in (a smooth diffusion fill, only visible while a hand is lifted)
V1_REST = {'l': {'box': (140, 905, 250, 995), 'wrist': (233, 946)}, 'r': {'box': (530, 905, 650, 995), 'wrist': (551, 946)}}

def diffuse_fill(c, hole, iters=500):
  out = c.copy(); known = ~hole
  out[hole] = c[known].mean(axis=0)
  for _ in range(iters):
    avg = (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 4
    out[hole] = avg[hole]
  return out

def rest_hands():
  v = 'v1'; man_p = f'{ROOT}/public/assets/phone/{v}/phone.json'; man = json.load(open(man_p))
  im = np.asarray(Image.open(f'{ROOT}/public/assets/phone/{v}/base.jpg').convert('RGB')).astype(float)
  lift = {}
  for side, o in V1_REST.items():
    x0, y0, x1, y1 = o['box']; c = im[y0:y1, x0:x1]; R, G, B = c[..., 0], c[..., 1], c[..., 2]; lum = (R + G + B) / 3
    m = (R > 120) & (lum > 105) & (R > B) & (G > 80)
    lab, n = ndi.label(m); m = lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))
    m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=2))
    hand = np.zeros(c.shape[:2] + (4,), np.uint8); hand[..., :3] = c
    hand[..., 3] = np.asarray(Image.fromarray((ndi.binary_dilation(m, iterations=1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
    Image.fromarray(hand).save(f'{ROOT}/public/assets/phone/{v}/rest-{side}.png', optimize=True)
    hole = ndi.binary_dilation(m, iterations=3)
    filled = diffuse_fill(c, hole)
    # a little of the cloth's grain back, so the fill is not a flat smear
    rng = np.random.default_rng(3); filled[hole] += rng.normal(0, 4, (hole.sum(), 3))
    fill = np.zeros_like(hand); fill[..., :3] = filled.clip(0, 255).astype(np.uint8)
    fill[..., 3] = np.asarray(Image.fromarray((ndi.binary_dilation(hole, iterations=2) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)))
    Image.fromarray(fill).save(f'{ROOT}/public/assets/phone/{v}/rest-{side}-fill.png', optimize=True)
    lift[side] = {'src': f'rest-{side}.png', 'fill': f'rest-{side}-fill.png', 'rect': [x0, y0, x1 - x0, y1 - y0], 'wrist': list(o['wrist'])}
    print(v, 'rest', side, lift[side])
  man['restHands'] = lift
  json.dump(man, open(man_p, 'w'), indent=1)

if __name__ == '__main__':
  main()
  rest_hands()
