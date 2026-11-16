"""
Mystic Mira v2 ("Tarot Mistress") rig builder.
Run:  /workspace/.rigenv/bin/python tools/build-rig-v2.py   (opencv-python-headless, numpy, pillow)

Sources (public/assets/rig-v2/src/, all 1080x1920 frame coordinates):
  char.png   the character, matted (RGBA). Generated design (option 3), 4x anime-upscaled, placed so her face sits
             at ~30% of the frame like the old painting.
  room.jpg   the empty room behind her (generated, same art style as the old painting)
  table.png  the fortune-telling table + crystal ball in front of her (RGBA)

Outputs (public/assets/rig-v2/):
  room.jpg               background layer (static)
  body.png               her body + head, with the ponytail and the tarot charm cut out and the cloth under them
                         painted in (so they can swing without leaving holes)
  tail.png, charm.png    the ponytail (+ ribbon tails) and the chain + tarot card, each its own layer (cropped)
  table.png              the table / crystal ball foreground layer (cropped)
  weights.png            deformation weights over the frame (half res): R head (incl. side hair + neck blend),
                         G side hair sway, B fringe sway, A body (breathing / lean)
  face/*.png             eye whites + iris (gaze), lid steps (blink), closed + happy eyes, mouth visemes
  parts/*.png            every part as a separate full-frame transparent layer, for editing / inspection
  rig.json               coordinates for the renderer (public/rig.js, version 2)
"""
import json, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'public/assets/rig-v2'); SRC = BASE + '/src'
os.makedirs(BASE + '/face', exist_ok=True); os.makedirs(BASE + '/parts', exist_ok=True)
charI = np.asarray(Image.open(SRC + '/char.png').convert('RGBA')).astype(np.float32)
H, W = charI.shape[:2]
# the generator's grey backdrop shows through gaps in her hair (the matte kept those as opaque): key them out
_c = charI[..., :3]; _mx, _mn = _c.max(2), _c.min(2)
_grey = ((_mx - _mn) < 10) & (_mx > 135) & (_mx < 205) & (charI[..., 3] > 128)
_grey[850:] = False
_n, _lab, _st, _ = cv2.connectedComponentsWithStats(_grey.astype(np.uint8), 8)
_holes = np.zeros(_grey.shape, np.uint8)
for _i in range(1, _n):
    if _st[_i, cv2.CC_STAT_AREA] >= 60: _holes[_lab == _i] = 1
_near = cv2.dilate(_holes, np.ones((5, 5), np.uint8)) > 0
_d = np.linalg.norm(_c - np.array([170.0, 169.0, 168.0]), axis=2)
charI[..., 3] = np.where(_holes > 0, 0, np.where(_near, np.minimum(charI[..., 3], np.clip((_d - 12) / 40, 0, 1) * 255), charI[..., 3]))
print('grey gaps keyed out:', int(_holes.sum()), 'px')
A = charI[..., :3].copy(); ALPHA = charI[..., 3] / 255
A8 = A.astype(np.uint8)[:, :, ::-1]  # BGR for cv2
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
hsv = cv2.cvtColor(A.astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
pink = (ALPHA > 0.5) & ((hue >= 163) | (hue <= 2)) & (sat > 28) & (sat < 150) & (val > 105)
gold = (ALPHA > 0.5) & (hue >= 8) & (hue <= 30) & (sat > 70) & (val > 90)
dark = (ALPHA > 0.5) & (val < 70)
K = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def poly(pts, shape=(H, W)):
    m = np.zeros(shape, np.uint8); cv2.fillPoly(m, [np.array(pts, np.int32)], 1); return m

def save_rgba(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).round().astype(np.uint8), 'RGBA').save(path, optimize=True)

# ------------------------------------------------------------------ ponytail (below the ribbon knot) + ribbon tails
TAIL_ANCHOR = (662.0, 772.0)
tail_area = poly([(612, 772), (700, 760), (726, 790), (724, 860), (712, 940), (706, 1004), (684, 1020), (650, 996), (612, 944), (596, 890), (598, 830)])
tail = tail_area & (pink | (gold & (yy < 812)) | (dark & cv2.dilate(pink.astype(np.uint8), K(3)).astype(bool)))
tail = cv2.morphologyEx(tail.astype(np.uint8), cv2.MORPH_CLOSE, K(3)) & tail_area
nt, labt, stt, _ = cv2.connectedComponentsWithStats(tail, 8)
keep = 1 + np.argmax(stt[1:, cv2.CC_STAT_AREA]); tail = (labt == keep).astype(np.uint8)
ff = tail.copy(); mk = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(ff, mk, (0, 0), 1); tail = tail | (1 - ff)
tail_soft = cv2.GaussianBlur(tail.astype(np.float32), (0, 0), 0.7) * ALPHA
# the tail starts right under the ribbon knot: the renderer pins it to the knot (same displacement as the body
# there), so the cut never opens; the bow itself stays on the body layer and hides it

# ------------------------------------------------------------------ tarot charm (chain + card) on the skirt
CHARM_ANCHOR = (607.0, 1206.0)
charm_area = poly([(600, 1203), (616, 1201), (634, 1260), (657, 1322), (702, 1324), (703, 1442), (636, 1442), (636, 1326), (640, 1320), (618, 1262)])
charm = charm_area & (gold | dark | (val > 40))
card = poly([(641, 1327), (698, 1327), (698, 1437), (641, 1437)])
charm = ((charm_area & (gold | (cv2.dilate(gold.astype(np.uint8), K(2)).astype(bool) & dark))) | card).astype(np.uint8)
charm_soft = cv2.GaussianBlur(charm.astype(np.float32), (0, 0), 0.6) * ALPHA

# ------------------------------------------------------------------ body layer: cut both out, paint the cloth under them
def fill_under(rgb, alpha, hole):
    hole8 = cv2.dilate(hole.astype(np.uint8), K(3))
    bgr = rgb.astype(np.uint8)[:, :, ::-1].copy()
    # paint the cloth from the plum fabric around the hole, not from the gold trim / hair at its edge
    ring = (cv2.dilate(hole8, K(28)) > 0) & (hole8 == 0)
    fabric = ring & (hue > 125) & (hue < 168) & (val < 150) & (alpha > 0.5)
    plum = np.median(bgr[fabric], axis=0) if fabric.sum() > 50 else np.array([60, 30, 45])
    src = bgr.copy(); trim = ring & ~fabric; src[trim] = plum
    bgr_orig = bgr; bgr = src
    small = cv2.resize(bgr, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA); sh = cv2.resize(hole8, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    coarse = cv2.resize(cv2.inpaint(small, sh, 9, cv2.INPAINT_TELEA), (W, H), interpolation=cv2.INTER_CUBIC)
    fine = cv2.inpaint(np.where(hole8[..., None] > 0, coarse, bgr), cv2.dilate(hole8, K(2)) - cv2.erode(hole8, K(6)), 5, cv2.INPAINT_TELEA)
    # a little fabric grain so the patch does not look airbrushed
    rng = np.random.default_rng(7); grain = cv2.GaussianBlur(rng.normal(0, 5, (H, W)).astype(np.float32), (0, 0), 1.2)[..., None]
    fine = np.clip(fine.astype(np.float32) + grain, 0, 255).astype(np.uint8)
    out = np.where(hole8[..., None] > 0, fine, bgr_orig)[:, :, ::-1].astype(np.float32)
    # alpha under the hole: the silhouette without the part, closed (the cloth continues behind it)
    # both parts lie over her clothes, so the cloth under them is opaque
    a2 = np.where(hole8 > 0, np.maximum(alpha, 1.0), alpha)
    return out, a2

# under the knot the body keeps its own hair + ribbon (the tail layer draws the same pixels on top, pinned to the knot),
# so no painted-in cloth can show as a line at the cut
tail_hole = (tail_soft > 0.05) & (yy >= TAIL_ANCHOR[1] + 8)
body_rgb, body_a = fill_under(A, ALPHA, tail_hole | (charm_soft > 0.05))
save_rgba(np.dstack([body_rgb, body_a * 255]), BASE + '/body.png')
Image.fromarray((body_a * 255).astype(np.uint8)).save(BASE + '/parts/body-alpha.png')

def crop_layer(rgb, a, name, pad=6):
    ys, xs = np.where(a > 0.004)
    x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
    save_rgba(np.dstack([rgb[y0:y1, x0:x1], a[y0:y1, x0:x1] * 255]), f'{BASE}/{name}.png')
    save_rgba(np.dstack([rgb, a * 255]), f'{BASE}/parts/{name}.png')
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]

tail_rect = crop_layer(A, tail_soft, 'tail')
charm_rect = crop_layer(A, charm_soft, 'charm')
tbl = np.asarray(Image.open(SRC + '/table.png').convert('RGBA')).astype(np.float32)
table_rect = crop_layer(tbl[..., :3], tbl[..., 3] / 255, 'table', pad=0)
Image.open(SRC + '/room.jpg').convert('RGB').save(BASE + '/room.jpg', quality=88, optimize=True)

# ------------------------------------------------------------------ deformation weights
hairish = pink & ~(tail > 0)
for (ex0, ey0, ex1, ey1) in [(442, 568, 516, 614), (558, 568, 642, 614), (512, 660, 570, 694)]:  # eyes, mouth
    hairish &= ~((xx >= ex0) & (xx < ex1) & (yy >= ey0) & (yy < ey1))
hairish = cv2.morphologyEx(hairish.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
nh, labh, sth, _ = cv2.connectedComponentsWithStats(hairish, 8)
for i in range(1, nh):
    if sth[i, cv2.CC_STAT_AREA] < 150 or sth[i, cv2.CC_STAT_TOP] > 760: hairish[labh == i] = 0
head_core = (((ALPHA > 0.5) & (yy < 712) & (xx > 380) & (xx < 720)).astype(np.uint8) | hairish) & (yy < 790).astype(np.uint8)
head_core = cv2.morphologyEx(head_core, cv2.MORPH_CLOSE, K(8))
head = cv2.GaussianBlur(cv2.dilate(head_core, K(22)).astype(np.float32), (0, 0), 10)
neck = ((xx > 492) & (xx < 590) & (yy > 690) & (yy < 760)).astype(np.float32) * np.clip((752 - yy) / 52, 0, 1)
head = np.clip(np.maximum(head, cv2.GaussianBlur(neck, (0, 0), 7)), 0, 1)
# the head never drags the collar / shoulders: fade out below the chin outside the neck
head *= np.where((yy > 722) & ((xx < 488) | (xx > 594)), np.clip((790 - yy) / 68, 0, 1), 1)
side = hairish * ((yy > 610) & ((xx < 470) | (xx > 612))).astype(np.uint8)
side = cv2.dilate(side, K(8)).astype(np.float32) * np.clip((yy - 600) / 150, 0, 1)
side = cv2.GaussianBlur(side, (0, 0), 4)
fringe = hairish * ((yy > 470) & (yy < 600) & (xx > 440) & (xx < 645)).astype(np.uint8)
fringe = cv2.dilate(fringe, K(4)).astype(np.float32) * np.clip((yy - 485) / 95, 0, 1)
fringe = cv2.GaussianBlur(fringe, (0, 0), 3)
bodyw = np.clip((yy - 700) / 120, 0, 1) * (1 - np.clip(head, 0, 1))
wimg = np.dstack([head, np.clip(side, 0, 1), np.clip(fringe, 0, 1), np.clip(bodyw, 0, 1)])
wsmall = cv2.resize(wimg, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
Image.fromarray((wsmall * 255).round().astype(np.uint8), 'RGBA').save(BASE + '/weights.png', optimize=True)
save_rgba(np.dstack([A, np.clip(head, 0, 1) * ALPHA * 255]), BASE + '/parts/head-weighted.png')

# ------------------------------------------------------------------ face parts (same method as the v1 rig, v2 coordinates)
SS = 8
FACE = (436, 536, 648, 704)
fx0, fy0, fx1, fy1 = FACE

def catmull(pts, n=16):
    pts = [pts[0]] + list(pts) + [pts[-1]]; out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = map(np.array, pts[i - 1:i + 3])
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(pts[-2])); return np.array(out, np.float32)

def stroke_poly(curve, widths):
    d = np.gradient(curve, axis=0); d /= (np.linalg.norm(d, axis=1, keepdims=True) + 1e-6)
    nrm = np.stack([-d[:, 1], d[:, 0]], 1)
    return np.concatenate([curve + nrm * (widths[:, None] / 2), (curve - nrm * (widths[:, None] / 2))[::-1]])

def taper(n, w, start=0.25, end=0.25, wmin=0.25):
    t = np.linspace(0, 1, n); f = np.ones(n)
    f = np.minimum(f, np.clip(t / start, 0, 1) ** 0.6 if start else 1); f = np.minimum(f, np.clip((1 - t) / end, 0, 1) ** 0.6 if end else 1)
    return np.maximum(wmin, w * f)

class Canvas:
    def __init__(self, box):
        self.x0, self.y0, self.x1, self.y1 = box; self.w, self.h = self.x1 - self.x0, self.y1 - self.y0
        self.im = Image.new('RGBA', (self.w * SS, self.h * SS), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im)
    def P(self, pts): return [((x - self.x0) * SS, (y - self.y0) * SS) for x, y in pts]
    def poly(self, pts, fill): self.d.polygon(self.P(pts), fill=fill)
    def result(self): return self.im.resize((self.w, self.h), Image.LANCZOS)

def crop(arr, box): x0, y0, x1, y1 = box; return arr[y0:y1, x0:x1]
def paste_over(base, top):
    a = top[..., 3:4]; out = base.copy(); out[..., :3] = top[..., :3] * a + base[..., :3] * (1 - a); out[..., 3:4] = a + base[..., 3:4] * (1 - a); return out
def to_f(im): return np.asarray(im).astype(np.float32) / 255
def save(arr, name): Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8), 'RGBA').save(f'{BASE}/face/{name}.png', optimize=True)
def poly_mask(box, pts, grow=0.0, blur=0.0):
    c = Canvas(box); c.poly(pts, (255, 255, 255, 255)); m = to_f(c.result())[..., 3]
    if grow: m = cv2.dilate((m > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(grow * 2 + 1),) * 2)).astype(np.float32)
    if blur: m = cv2.GaussianBlur(m, (0, 0), blur)
    return np.clip(m, 0, 1)
def inpaint_box(box, maskf, radius=3):
    x0, y0, x1, y1 = box; pad = 6; bb = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    src = crop(A8, bb).copy(); mk = np.zeros(src.shape[:2], np.uint8); mk[pad:-pad, pad:-pad] = (maskf > 0.02).astype(np.uint8)
    res = cv2.inpaint(src, mk, radius, cv2.INPAINT_TELEA)
    res = cv2.GaussianBlur(res, (0, 0), 0.7) * mk[..., None] + src * (1 - mk[..., None])
    return res[pad:-pad, pad:-pad, ::-1].astype(np.float32) / 255

EYES = {
    'L': dict(box=(440, 566, 518, 616),
              band_top=[(447, 584), (455, 579.5), (465, 575.5), (476, 574.5), (487, 575.5), (497, 578), (505, 583), (511, 590)],
              lid=[(461, 594), (467, 589.5), (477, 586.5), (489, 586), (499, 588), (506, 592.5), (511, 599)],
              low=[(461, 594), (466, 601), (475, 606), (487, 608), (498, 606.5), (506, 603), (511, 599)],
              closed=[(459, 598), (470, 603.5), (485, 605.5), (500, 603.5), (512, 598.5)],
              happy=[(459, 603.5), (470, 597.5), (485, 595), (500, 597.5), (512, 603)],
              outer='left', iris=(487.0, 596.5)),
    'R': dict(box=(560, 566, 642, 616),
              band_top=[(569, 587), (577, 580.5), (588, 577), (600, 576), (611, 577), (621, 580.5), (629, 585.5), (634, 589)],
              lid=[(572, 597), (578, 590.5), (588, 586.5), (600, 585.5), (611, 586.5), (619, 590), (626, 597)],
              low=[(572, 597), (577, 604), (586, 609), (597, 610), (608, 608.5), (618, 604), (626, 597)],
              closed=[(571, 599), (584, 604.5), (598, 606.5), (612, 604.5), (627, 598.5)],
              happy=[(571, 603.5), (584, 597.5), (598, 595), (612, 597.5), (627, 603)],
              outer='right', iris=(591.0, 597.5)),
}
LASH = (24, 12, 18, 255)
SCLERA = (246, 228, 220, 255)
rig_eyes = {}
for k, e in EYES.items():
    box = e['box']; bx0, by0, bx1, by1 = box
    band_top, lid, low = catmull(e['band_top']), catmull(e['lid']), catmull(e['low'])
    opening = np.concatenate([lid, low[::-1]])
    m_open = poly_mask(box, opening, blur=0.35)
    whole = np.concatenate([band_top, low[::-1]])
    m_whole = poly_mask(box, whole, grow=1.0, blur=0.6)
    o = crop(A, box)
    skinlike = (o[..., 0] > 200) & (o[..., 0] - o[..., 2] > 40) & (o[..., 1] > 150)
    nonskin = cv2.dilate((~skinlike).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    skin = cv2.GaussianBlur(inpaint_box(box, np.maximum(m_whole, nonskin * m_whole.clip(0, 1) + nonskin * 0), radius=6), (0, 0), 1.0)
    orig = crop(A, box) / 255; origA = np.dstack([orig, np.ones(orig.shape[:2])])
    sc = Canvas(box); sc.poly(opening, SCLERA); scl = to_f(sc.result())
    shade = np.clip(1 - (np.arange(by0, by1)[:, None] - np.interp(np.arange(bx0, bx1), lid[:, 0], lid[:, 1])[None, :]) / 5.5, 0, 1)
    scl[..., :3] *= (1 - 0.32 * shade[..., None]); scl[..., 3] = m_open
    save(scl, f'eye{k}-white')
    inner = origA.copy(); inner[..., 3] = m_open; save(inner, f'eye{k}-inner')
    save(np.dstack([np.ones_like(m_open)] * 3 + [m_open]), f'eye{k}-mask')
    band = origA.copy(); band[..., 3] = poly_mask(box, np.concatenate([band_top, lid[::-1]]), grow=0.5, blur=0.4); save(band, f'eye{k}-band')

    # her skin around this eye: the cheek just under it (clean, no eyeshadow), as a flat colour + a soft crease shadow
    lowmax = int(max(y for _, y in e['low']))
    cheek = A[lowmax + 4:lowmax + 14, bx0 + 6:bx1 - 6].reshape(-1, 3)
    ck = cheek[(cheek[:, 0] > 200) & (cheek[:, 0] - cheek[:, 2] > 25)]
    skin_col = np.median(ck, axis=0) / 255 if len(ck) > 10 else np.array([250, 222, 205]) / 255
    hsvb = crop(hsv, box); hairm = (((hsvb[..., 0] >= 163) | (hsvb[..., 0] <= 3)) & (hsvb[..., 1] > 30) & (hsvb[..., 1] < 150) & (hsvb[..., 2] > 120)).astype(np.uint8)
    hairm = cv2.morphologyEx(hairm, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    nh2, lab2, st2, _ = cv2.connectedComponentsWithStats(hairm, 8)
    for i2 in range(1, nh2):
        if st2[i2, cv2.CC_STAT_AREA] < 25 or st2[i2, cv2.CC_STAT_TOP] > 1: hairm[lab2 == i2] = 0   # strands come from above
    hairA = cv2.GaussianBlur(hairm.astype(np.float32), (0, 0), 0.6)
    gyb, gxb = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)

    def rs(c, n=60):
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]; t = np.linspace(0, s[-1], n)
        return np.stack([np.interp(t, s, c[:, 0]), np.interp(t, s, c[:, 1])], 1)

    def lid_frame(f, name, curve_closed, thick):
        L0, L1 = rs(lid), rs(catmull(curve_closed))
        edge = L0 * (1 - f) + L1 * f
        out = origA.copy()
        top = rs(band_top) - [0, 3.0]
        top[0] += [-2.5, -1.0] if e['outer'] == 'left' else [-1.0, 0]; top[-1] += [1.0, 0] if e['outer'] == 'left' else [4.0, -1.5]
        if f >= 0.999: cover = np.concatenate([top, rs(low)[::-1] + [0, 2.0]])
        else: cover = np.concatenate([top, edge[::-1]])
        m = poly_mask(box, cover, grow=1.5, blur=1.1)
        # skin with a soft pink crease along the lid line
        ey = np.interp(gxb, edge[:, 0], edge[:, 1]); dd = gyb - ey
        crease = np.exp(-0.5 * ((dd + 3.5) / 3.2) ** 2) * (dd < 1)
        sk = np.ones(m.shape + (3,), np.float32) * skin_col
        sk = sk * (1 - 0.16 * crease[..., None]) + np.array([0.86, 0.55, 0.55]) * 0.16 * crease[..., None]
        out = paste_over(out, np.dstack([sk, m]))
        n = len(edge); w = taper(n, thick, 0.18 if e['outer'] == 'left' else 0.35, 0.35 if e['outer'] == 'left' else 0.18)
        c = Canvas(box); c.poly(stroke_poly(edge, w), LASH)
        if e['outer'] == 'left':
            p = edge[0]; c.poly(stroke_poly(catmull([tuple(p + [1.5, -0.3]), tuple(p + [-4, 0.0]), tuple(p + [-8.0, -2.0])], 8), taper(17, thick * 0.8, 0, 0.9)), LASH)
        else:
            p = edge[-1]; c.poly(stroke_poly(catmull([tuple(p + [-1.5, -0.3]), tuple(p + [4, 0.0]), tuple(p + [8.0, -2.0])], 8), taper(17, thick * 0.8, 0, 0.9)), LASH)
        if f >= 0.999 and name == 'closed':   # a few short lashes hanging from the closed lid
            for u in (0.25, 0.42, 0.6, 0.77) if e['outer'] == 'right' else (0.23, 0.4, 0.58, 0.75):
                kk = int(u * (n - 1)); q = edge[kk]; dx = (-1.5 if e['outer'] == 'left' else 1.5) * (1 - u if e['outer'] == 'right' else u)
                cl = catmull([tuple(q), tuple(q + [dx * 0.5, 2.2]), tuple(q + [dx, 3.6])], 4); c.poly(stroke_poly(cl, taper(len(cl), 1.1, 0, 0.9)), LASH)
        out = paste_over(out, to_f(c.result()))
        out = paste_over(out, np.dstack([orig, hairA * m]))     # hair strands stay in front of the lid
        fe = np.ones(out.shape[:2], np.float32); b = 3
        for i in range(b): fe[i, :] = fe[-1 - i, :] = np.minimum(fe[i, :], (i + 0.5) / b); fe[:, i] = np.minimum(fe[:, i], (i + 0.5) / b); fe[:, -1 - i] = np.minimum(fe[:, -1 - i], (i + 0.5) / b)
        out[..., 3] = fe
        save(out, f'eye{k}-{name}')
    lid_frame(0.35, 'lid1', e['closed'], 6.5)
    lid_frame(0.70, 'lid2', e['closed'], 5.5)
    lid_frame(1.0, 'closed', e['closed'], 3.8)
    lid_frame(1.0, 'happy', e['happy'], 3.8)
    rig_eyes[k] = dict(box=list(box), iris=list(e['iris']))

# ------------------------------------------------------------------ mouth visemes from her own lips
MB = (508, 652, 574, 702)
mx0, my0, mx1, my1 = MB
cx, LINE_Y = 540.0, 672.4
S = 1.2   # her mouth is ~1.2x the old painting's
lips_hole = poly_mask(MB, [(516, 671), (524, 667.5), (540, 669), (556, 667.5), (564, 671), (557, 679), (549, 688), (540, 691), (531, 688), (523, 679)], grow=1.5, blur=0.8)
mskin = inpaint_box(MB, lips_hole, radius=5)
INNER = (92, 28, 40, 255); TEETH = (246, 236, 232, 255); TONGUE = (205, 100, 108, 255)
UP = 4; mh, mw = my1 - my0, mx1 - mx0
big = cv2.resize(crop(A, MB) / 255, (mw * UP, mh * UP), interpolation=cv2.INTER_CUBIC)
lipm = cv2.resize(lips_hole, (mw * UP, mh * UP), interpolation=cv2.INTER_LINEAR)
gy, gx = np.mgrid[0:mh * UP, 0:mw * UP].astype(np.float32)
X = mx0 + (gx + 0.5) / UP - 0.5; Y = my0 + (gy + 0.5) / UP - 0.5
upper_m = lipm * np.clip((LINE_Y + 0.6 - Y), 0, 1)
lower_m = lipm * np.clip((Y - LINE_Y + 0.4), 0, 1)
def prof(u, p): return np.where(np.abs(u) < 1, 1 - np.abs(u) ** p, 0.0)
def warp_part(mask, sx, sy, dy_fn):
    srcx = cx + (X - cx) / sx; srcy = LINE_Y + (Y - dy_fn(srcx) - LINE_Y) / sy
    mxp = ((srcx - mx0 + 0.5) * UP - 0.5).astype(np.float32); myp = ((srcy - my0 + 0.5) * UP - 0.5).astype(np.float32)
    return cv2.remap(np.dstack([big, mask]).astype(np.float32), mxp, myp, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
def mouth_shape(name, hw, ht, hb, p=2.2, sx=1.0, sy=1.0, teeth=0.0, tongue=0.0, corner_up=0.0, lower_tuck=0.0):
    hw, ht, hb, teeth, tongue, corner_up = hw * S, ht * S, hb * S, teeth * S, tongue * S, corner_up * S
    cu = lambda x: corner_up * np.clip(np.abs(x - cx) / (15.0 * S), 0, 1) ** 2
    up_dy = lambda x: -ht * prof((x - cx) / (hw / sx), p) - cu(x)
    lo_dy = lambda x: hb * prof((x - cx) / (hw / sx), p) - cu(x) - lower_tuck * S * prof((x - cx) / (hw / sx), 2)
    out = np.dstack([cv2.resize(mskin, (mw * UP, mh * UP), interpolation=cv2.INTER_CUBIC), np.ones((mh * UP, mw * UP))]).astype(np.float32)
    if ht + hb > 0.2:
        xs = np.linspace(cx - hw, cx + hw, 81)
        top = LINE_Y + up_dy(xs) + 0.2; bot = LINE_Y + lo_dy(xs) - 0.1
        def hp(pts): return [((x - mx0 + 0.5) * UP - 0.5, (y - my0 + 0.5) * UP - 0.5) for x, y in pts]
        def layer(pts, col, blur=0.6):
            im = Image.new('RGBA', (mw * UP * 2, mh * UP * 2)); ImageDraw.Draw(im).polygon([(x * 2, y * 2) for x, y in hp(pts)], fill=col)
            return to_f(im.resize((mw * UP, mh * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur * UP / 4)))
        inner = layer(list(zip(xs, top)) + list(zip(xs[::-1], bot[::-1])), INNER); out = paste_over(out, inner); clip = inner[..., 3:4]
        if teeth > 0:
            t = layer(list(zip(xs, top - 0.5)) + list(zip(xs[::-1], (top + teeth)[::-1])), TEETH, 0.5); t[..., 3:4] *= clip * 0.85; out = paste_over(out, t)
        if tongue > 0:
            g = Image.new('RGBA', (mw * UP, mh * UP)); dd = ImageDraw.Draw(g)
            tx, ty = (cx - mx0 + 0.5) * UP, (LINE_Y + hb - my0 + 0.6) * UP
            dd.ellipse([tx - hw * 0.6 * UP, ty - tongue * UP, tx + hw * 0.6 * UP, ty + tongue * UP], fill=TONGUE)
            g = to_f(g.filter(ImageFilter.GaussianBlur(UP * 0.4))); g[..., 3:4] *= clip; out = paste_over(out, g)
    out = paste_over(out, warp_part(lower_m, sx, sy, lo_dy)); out = paste_over(out, warp_part(upper_m, sx, sy, up_dy))
    out = cv2.resize(out, (mw, mh), interpolation=cv2.INTER_AREA)
    fe = np.ones(out.shape[:2], np.float32); b = 4
    for i in range(b):
        v = (i + 0.5) / b; fe[i, :] = np.minimum(fe[i, :], v); fe[-1 - i, :] = np.minimum(fe[-1 - i, :], v); fe[:, i] = np.minimum(fe[:, i], v); fe[:, -1 - i] = np.minimum(fe[:, -1 - i], v)
    out[..., 3] = fe; save(out, 'mouth-' + name)

mouth_shape('rest', 12, 0, 0)                                   # closed (her own lips)
mouth_shape('MBP', 11, 0, 0, sx=0.96, sy=0.8)                   # pressed lips (m, b, p)
mouth_shape('smile', 12, 0, 0, sx=1.06, corner_up=1.8)
mouth_shape('small', 10, 1.1, 2.8, p=2.4, sx=0.98, teeth=1.0)
mouth_shape('I', 13, 1.0, 2.6, p=3.2, sx=1.12, sy=0.9, teeth=1.6, corner_up=0.6)
mouth_shape('E', 13, 1.5, 4.2, p=3.0, sx=1.08, sy=0.9, teeth=1.7, corner_up=0.5)
mouth_shape('FV', 11, 1.0, 1.8, p=2.6, sx=1.02, teeth=1.5, lower_tuck=0.6)
mouth_shape('A', 12, 2.8, 8.4, p=2.0, sx=0.96, teeth=1.5, tongue=2.0)
mouth_shape('O', 7.5, 3.2, 7.0, p=1.7, sx=0.78, sy=1.12, teeth=0.6, tongue=1.2)
mouth_shape('U', 5.5, 1.7, 3.4, p=1.6, sx=0.7, sy=1.18)
mouth_shape('happy', 12.5, 1.5, 5.2, p=2.6, sx=1.06, teeth=1.7, corner_up=2.0)
save(np.dstack([crop(A, MB) / 255, np.ones((mh, mw))]), 'mouth-orig')
# face base with the mouth painted out (for editing; the renderer draws visemes over her own face)
fb = A.copy() / 255; fb[my0:my1, mx0:mx1] = mskin * lips_hole[..., None] + fb[my0:my1, mx0:mx1] * (1 - lips_hole[..., None])
save_rgba(np.dstack([fb * 255, ALPHA * cv2.GaussianBlur(poly([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)]).astype(np.float32), (0, 0), 3) * 255]), BASE + '/parts/face-base.png')

# ------------------------------------------------------------------ crystal ball (for the glow effect): brightest violet disc in the table layer
tA = tbl[..., 3] / 255; th = cv2.cvtColor(tbl[..., :3].astype(np.uint8), cv2.COLOR_RGB2HSV)
ballm = ((tA > 0.5) & (th[..., 0] > 120) & (th[..., 0] < 160) & (th[..., 2] > 150) & (yy < 1330)).astype(np.uint8)
nb, lb, sb, cb = cv2.connectedComponentsWithStats(cv2.morphologyEx(ballm, cv2.MORPH_CLOSE, K(6)), 8)
bi = 1 + np.argmax(sb[1:, cv2.CC_STAT_AREA]); bx, by = cb[bi]; br = max(sb[bi, cv2.CC_STAT_WIDTH], sb[bi, cv2.CC_STAT_HEIGHT]) / 2
print('ball', bx, by, br)

rig = dict(version=2, width=W, height=H, face=list(FACE), eyes=rig_eyes, mouth=dict(box=list(MB), center=[cx, LINE_Y]),
           pivots=dict(neck=[540, 735], hips=[540, 1360], face=[540, 612], chin=[540, 708]),
           brows=dict(L=[488, 558], R=[598, 556], size=[22, 7]),
           shader=dict(bodyTop=780, bodyBottom=1330, chestY=920, chestH=130, centerX=540, faceR=[60, 74],
                       jaw=dict(y0=678, y1=690, y2=704, y3=726, sx=30, k=1.6)),
           layers=dict(tail=dict(rect=tail_rect, anchor=list(TAIL_ANCHOR), length=250, headW=float(head[int(TAIL_ANCHOR[1]), int(TAIL_ANCHOR[0])])),
                       charm=dict(rect=charm_rect, anchor=list(CHARM_ANCHOR), length=230),
                       table=dict(rect=table_rect)),
           ball=[475.0, 1295.0, 120.0],   # measured on the composite (the detector above finds the bright core: auto)
           blush=[[470, 640], [612, 640]],
           mouthShapes=['rest', 'MBP', 'smile', 'small', 'I', 'E', 'FV', 'A', 'O', 'U', 'happy'])
json.dump(rig, open(BASE + '/rig.json', 'w'), indent=1)
print('rig v2 built', BASE, 'tail', tail_rect, 'charm', charm_rect, 'table', table_rect)

# flat picture of the whole scene (fallback still / blurred backdrop)
im = Image.open(BASE + '/room.jpg').convert('RGBA'); im.alpha_composite(Image.open(BASE + '/body.png'))
for n in ['tail', 'charm', 'table']:
    x, y, w, h = rig['layers'][n]['rect']; im.alpha_composite(Image.open(f'{BASE}/{n}.png'), (x, y))
im.convert('RGB').save(BASE + '/still.jpg', quality=88, optimize=True)
