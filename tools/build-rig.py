"""
Builds Mira's real-time 2D puppet rig from ONE picture (public/assets/mira2.jpg, 941x1672).
Run:  /workspace/.rigenv/bin/python tools/build-rig.py   (needs opencv-python-headless, numpy, pillow, rembg)

Outputs (public/assets/rig/):
  char-alpha.png   her silhouette (anime matte from rembg isnet-anime, cleaned, 2 px grown)
  bg.jpg           the room with her painted out (inpainted), shown only where she moves away
  weights.png      deformation weights: R head+hair, G side-hair sway, B fringe sway (half resolution)
  face/*.png       face parts in her art style: eye lids (3 blink steps, closed, happy), eye whites + iris
                   (for gaze), mouth shapes (visemes) painted on a lip-free skin copy
  rig.json         all coordinates the overlay needs
"""
import json, os, sys, math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/assets/rig'); os.makedirs(OUT + '/face', exist_ok=True)
SRC = os.path.join(ROOT, 'public/assets/mira2.jpg')
img = Image.open(SRC).convert('RGB'); W, H = img.size
A = np.asarray(img).astype(np.float32)

# ------------------------------------------------------------------ silhouette
matte_path = '/tmp/rig-matte.png'
if not os.path.exists(matte_path):
    from rembg import remove, new_session
    remove(img, session=new_session('isnet-anime'), only_mask=True).save(matte_path)
m = np.asarray(Image.open(matte_path).convert('L')).astype(np.float32) / 255
hard = (m > 0.35).astype(np.uint8)
# keep the biggest blob (her), fill holes (semi-transparent neck shadow, earring)
n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]); hard = (lab == big).astype(np.uint8)
ff = hard.copy(); mask = np.zeros((H + 2, W + 2), np.uint8); cv2.floodFill(ff, mask, (0, 0), 1); hard = hard | (1 - ff)
hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
grown = cv2.dilate(hard, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
alpha = cv2.GaussianBlur(grown.astype(np.float32), (0, 0), 0.8)
Image.fromarray((alpha * 255).astype(np.uint8)).save(OUT + '/char-alpha.png', optimize=True)

# ------------------------------------------------------------------ background plate (only needs to look right near her outline)
y_cut = 1210
hole = cv2.dilate(grown, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
hole[y_cut:] = 0
small = 0.5
A8 = A.astype(np.uint8)[:, :, ::-1]
# coarse fill at half size for the deep interior, then a full-size pass that keeps the outline sharp
s_img = cv2.resize(A8, None, fx=small, fy=small, interpolation=cv2.INTER_AREA)
s_hole = cv2.resize(hole, (s_img.shape[1], s_img.shape[0]), interpolation=cv2.INTER_NEAREST)
s_fill = cv2.inpaint(s_img, s_hole, 9, cv2.INPAINT_TELEA)
coarse = cv2.resize(s_fill, (W, H), interpolation=cv2.INTER_CUBIC)
plate = A8.copy(); plate[hole > 0] = coarse[hole > 0]
ring = hole - cv2.erode(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
plate = cv2.inpaint(np.where(ring[..., None] > 0, 0, plate).astype(np.uint8), ring, 6, cv2.INPAINT_TELEA)
plate = cv2.GaussianBlur(plate, (0, 0), 1.2) * (hole[..., None] > 0) + A8 * (hole[..., None] == 0)
cv2.imwrite(OUT + '/bg.jpg', plate.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 86])

# ------------------------------------------------------------------ deformation weights
hsv = cv2.cvtColor(A8, cv2.COLOR_BGR2HSV).astype(np.float32)
sat, val = hsv[..., 1], hsv[..., 2]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
hairish = (hard > 0) & (sat < 75) & (val > 70) & (yy < 665) & (xx > 340) & (xx < 640)
hairish &= ~((yy > 612) & (xx > 420) & (xx < 535))                 # collar / brooch are not hair
for (ex0, ey0, ex1, ey1) in [(402, 494, 464, 536), (494, 497, 550, 536), (448, 560, 505, 600)]:  # eyes, mouth
    hairish &= ~((xx >= ex0) & (xx < ex1) & (yy >= ey0) & (yy < ey1))
hairish = cv2.morphologyEx(hairish.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
nh, labh, sth, _ = cv2.connectedComponentsWithStats(hairish, 8)
for i in range(1, nh):
    ys_, xs_ = np.where(labh == i)
    if sth[i, cv2.CC_STAT_AREA] < 120 or ys_.min() > 600: hairish[labh == i] = 0   # specks and gold trim on the cape
head_core = ((hard > 0) & (yy < 603) & (xx > 340) & (xx < 640)).astype(np.uint8) | hairish
head_core = cv2.morphologyEx(head_core, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
head = cv2.GaussianBlur(cv2.dilate(head_core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))).astype(np.float32), (0, 0), 9)
# the neck: follows the head at the chin, the body at the collar
neck = ((xx > 435) & (xx < 520) & (yy > 590) & (yy < 660)).astype(np.float32)
neck *= np.clip((650 - yy) / 50, 0, 1)
head = np.maximum(head, cv2.GaussianBlur(neck, (0, 0), 6))
head = np.clip(head, 0, 1)
# side hair below the eyes swings (more toward the tips); grown so moved strands still find pixels
side = hairish * ((yy > 505) & ((xx < 445) | (xx > 512))).astype(np.uint8)
side = cv2.dilate(side, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))).astype(np.float32)
side *= np.clip((yy - 500) / 130, 0, 1)
side = cv2.GaussianBlur(side, (0, 0), 4)
# fringe over the forehead
fringe = hairish * ((yy > 420) & (yy < 508) & (xx > 415) & (xx < 545)).astype(np.uint8)
fringe = cv2.dilate(fringe, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(np.float32)
fringe *= np.clip((yy - 430) / 80, 0, 1)
fringe = cv2.GaussianBlur(fringe, (0, 0), 3)
wimg = np.dstack([head, np.clip(side, 0, 1), np.clip(fringe, 0, 1), np.ones_like(head)])
wsmall = cv2.resize(wimg, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
Image.fromarray((wsmall * 255).round().astype(np.uint8), 'RGBA').save(OUT + '/weights.png', optimize=True)

# ------------------------------------------------------------------ face parts
SS = 8  # supersampling for hand-drawn parts
FACE = (400, 480, 560, 616)  # patch rectangle x0,y0,x1,y1 (the overlay redraws this area every frame)
fx0, fy0, fx1, fy1 = FACE

def catmull(pts, n=16):
    pts = [pts[0]] + list(pts) + [pts[-1]]; out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = map(np.array, pts[i - 1:i + 3])
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(pts[-2])); return np.array(out, np.float32)

def stroke_poly(curve, widths):
    """Tapered stroke polygon around a curve; widths: per-point full width."""
    d = np.gradient(curve, axis=0); d /= (np.linalg.norm(d, axis=1, keepdims=True) + 1e-6)
    nrm = np.stack([-d[:, 1], d[:, 0]], 1)
    a = curve + nrm * (widths[:, None] / 2); b = curve - nrm * (widths[:, None] / 2)
    return np.concatenate([a, b[::-1]])

def taper(n, w, start=0.25, end=0.25, wmin=0.25):
    t = np.linspace(0, 1, n); f = np.ones(n)
    f = np.minimum(f, np.clip(t / start, 0, 1) ** 0.6 if start else 1); f = np.minimum(f, np.clip((1 - t) / end, 0, 1) ** 0.6 if end else 1)
    return np.maximum(wmin, w * f)

class Canvas:
    """RGBA drawing surface in image coordinates over a box, supersampled."""
    def __init__(self, box):
        self.x0, self.y0, self.x1, self.y1 = box
        self.w, self.h = self.x1 - self.x0, self.y1 - self.y0
        self.im = Image.new('RGBA', (self.w * SS, self.h * SS), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im)
    def P(self, pts): return [((x - self.x0) * SS, (y - self.y0) * SS) for x, y in pts]
    def poly(self, pts, fill): self.d.polygon(self.P(pts), fill=fill)
    def ellipse(self, cx, cy, rx, ry, fill): self.d.ellipse([((cx - rx) - self.x0) * SS, ((cy - ry) - self.y0) * SS, ((cx + rx) - self.x0) * SS, ((cy + ry) - self.y0) * SS], fill=fill)
    def result(self): return self.im.resize((self.w, self.h), Image.LANCZOS)

def crop(arr, box): x0, y0, x1, y1 = box; return arr[y0:y1, x0:x1]
def paste_over(base, top):  # float RGBA arrays (0..1 alpha)
    a = top[..., 3:4]; out = base.copy(); out[..., :3] = top[..., :3] * a + base[..., :3] * (1 - a); out[..., 3:4] = a + base[..., 3:4] * (1 - a); return out
def to_f(im): return np.asarray(im).astype(np.float32) / 255
def save(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8), 'RGBA').save(f'{OUT}/face/{name}.png', optimize=True)

def poly_mask(box, pts, grow=0.0, blur=0.0):
    c = Canvas(box); c.poly(pts, (255, 255, 255, 255)); m = to_f(c.result())[..., 3]
    if grow: m = cv2.dilate((m > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(grow * 2 + 1),) * 2)).astype(np.float32)
    if blur: m = cv2.GaussianBlur(m, (0, 0), blur)
    return np.clip(m, 0, 1)

def inpaint_box(box, maskf, radius=3):
    x0, y0, x1, y1 = box
    pad = 6; bb = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    src = crop(A8, bb).copy(); mk = np.zeros(src.shape[:2], np.uint8); mk[pad:-pad, pad:-pad] = (maskf > 0.02).astype(np.uint8)
    res = cv2.inpaint(src, mk, radius, cv2.INPAINT_TELEA)
    res = cv2.GaussianBlur(res, (0, 0), 0.7) * mk[..., None] + src * (1 - mk[..., None])
    return res[pad:-pad, pad:-pad, ::-1].astype(np.float32) / 255

EYES = {
    'L': dict(box=(404, 494, 462, 534),
              band_top=[(409, 506), (418, 504.3), (430, 504.6), (441, 506), (449, 509), (455.5, 514.5)],
              lid=[(417, 513.5), (424, 511.3), (433, 510.6), (442, 511.2), (449, 513.5), (455, 518)],
              low=[(417, 514.5), (421, 519), (428, 523.6), (436, 525.3), (444, 524.6), (450, 522), (455, 518)],
              closed=[(415, 515.5), (424, 520.0), (436, 522.4), (447, 521.4), (455, 518)],
              happy=[(415, 520.5), (424, 515.8), (436, 513.6), (447, 515.2), (455, 519.5)],
              outer='left', iris=(438.6, 516.8), r=9.5),
    'R': dict(box=(496, 497, 548, 534),
              band_top=[(499.5, 518), (504, 510.5), (512, 507), (522, 506), (533, 506.2), (541, 507.8), (545, 510)],
              lid=[(500, 520), (505, 515.2), (513, 513.2), (523, 512.8), (533, 513.3), (539.5, 514.2), (543.5, 515)],
              low=[(500, 520.5), (506, 524), (514, 526.2), (523, 526.3), (530, 524.3), (536, 520.6), (543.5, 515)],
              closed=[(500, 519.5), (510, 523.0), (522, 524.0), (533, 522.0), (544, 516.5)],
              happy=[(500, 521.5), (510, 516.6), (522, 514.8), (533, 516.4), (544, 520.5)],
              outer='right', iris=(515.4, 517.4), r=9.5),
}
LASH = (16, 7, 9, 255)
rig_eyes = {}
for k, e in EYES.items():
    box = e['box']; bx0, by0, bx1, by1 = box
    band_top, lid, low = catmull(e['band_top']), catmull(e['lid']), catmull(e['low'])
    # eye opening (white + iris): between the lid edge and the lower lid
    opening = np.concatenate([lid, low[::-1]])
    m_open = poly_mask(box, opening, blur=0.35)
    whole = np.concatenate([band_top, low[::-1]])
    m_whole = poly_mask(box, whole, grow=1.0, blur=0.6)
    skin = inpaint_box(box, m_whole, radius=4)                    # her skin with the eye painted out
    # eyelid skin: paint the eye AND every non-skin pixel in the box (hair strands, lashes) out, so the lid
    # is filled only from her surrounding skin
    o = crop(A, box)
    nonskin = ~((o[..., 0] > 150) & (o[..., 0] - o[..., 1] > 35) & (o[..., 0] - o[..., 2] > 30))
    nonskin = cv2.dilate(nonskin.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    skin = inpaint_box(box, np.maximum(m_whole, nonskin), radius=6)
    skin = cv2.GaussianBlur(skin, (0, 0), 1.0)
    orig = crop(A, box) / 255
    origA = np.dstack([orig, np.ones(orig.shape[:2])])
    skinA = np.dstack([skin, np.ones(orig.shape[:2])])
    # eye white (for gaze): opening filled with her sclera tone, a little shade under the upper lid
    sc = Canvas(box); sc.poly(opening, (205, 180, 186, 255)); scl = to_f(sc.result())
    shade = np.clip(1 - (np.arange(by0, by1)[:, None] - np.interp(np.arange(bx0, bx1), lid[:, 0], lid[:, 1])[None, :]) / 4.5, 0, 1)
    scl[..., :3] *= (1 - 0.35 * shade[..., None]); scl[..., 3] = m_open
    save(scl, f'eye{k}-white')
    inner = origA.copy(); inner[..., 3] = m_open; save(inner, f'eye{k}-inner')
    mo = np.dstack([np.ones_like(m_open)] * 3 + [m_open]); save(mo, f'eye{k}-mask')
    # lash band of the open eye (drawn back on top so the moved iris tucks under it)
    band = origA.copy(); bm = poly_mask(box, np.concatenate([band_top, lid[::-1]]), grow=0.5, blur=0.4); band[..., 3] = bm; save(band, f'eye{k}-band')

    def lid_frame(f, name, curve_closed, thick):
        """Upper lid lowered to fraction f (0 open .. 1 closed): skin above, a lash line on the lid edge, the eye below."""
        cl = catmull(curve_closed)
        # resample to same count
        def rs(c, n=60):
            s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]; t = np.linspace(0, s[-1], n)
            return np.stack([np.interp(t, s, c[:, 0]), np.interp(t, s, c[:, 1])], 1)
        L0, L1 = rs(lid), rs(cl)
        edge = L0 * (1 - f) + L1 * f
        out = origA.copy()
        # below the lid edge: the eye as drawn (cut at the lower lid); above: skin
        above = poly_mask(box, np.concatenate([rs(band_top) - [0, 1.2], edge[::-1]]), grow=0.6, blur=0.5)
        out = paste_over(out, np.dstack([skin, above]))
        if f >= 0.999:  # fully closed: the opening becomes skin too
            out = paste_over(out, np.dstack([skin, poly_mask(box, np.concatenate([edge, rs(low)[::-1]]), grow=1.0, blur=0.6)]))
        c = Canvas(box)
        n = len(edge); w = taper(n, thick, 0.18 if e['outer'] == 'left' else 0.35, 0.35 if e['outer'] == 'left' else 0.18)
        # a soft crease shadow just above the lid
        sh = Canvas(box); sh.poly(stroke_poly(edge - [0, thick * 0.9], taper(n, thick * 1.6, .3, .3)), (160, 85, 75, 45)); out = paste_over(out, to_f(sh.result().filter(ImageFilter.GaussianBlur(SS * 0.6))))
        c.poly(stroke_poly(edge, w), LASH)
        # outer-corner lash flick
        if e['outer'] == 'left':
            p = edge[0]; c.poly(stroke_poly(catmull([tuple(p + [1.5, -0.3]), tuple(p + [-3, 0.6]), tuple(p + [-6.0, 2.2])], 8), taper(17, thick * 0.7, 0, 0.9)), LASH)
        else:
            p = edge[-1]; c.poly(stroke_poly(catmull([tuple(p + [-1.5, -0.3]), tuple(p + [3, 0.6]), tuple(p + [6.0, 2.0])], 8), taper(17, thick * 0.7, 0, 0.9)), LASH)
        out = paste_over(out, to_f(c.result()))
        out[..., 3] = 1.0
        # feather to the original at the box border
        fe = np.ones(out.shape[:2], np.float32); b = 3
        for i in range(b): fe[i, :] = fe[-1 - i, :] = np.minimum(fe[i, :], (i + 0.5) / b); fe[:, i] = np.minimum(fe[:, i], (i + 0.5) / b); fe[:, -1 - i] = np.minimum(fe[:, -1 - i], (i + 0.5) / b)
        out[..., 3] = fe
        save(out, f'eye{k}-{name}')
    lid_frame(0.35, 'lid1', e['closed'], 5.4)
    lid_frame(0.70, 'lid2', e['closed'], 4.6)
    lid_frame(1.0, 'closed', e['closed'], 2.7)
    lid_frame(1.0, 'happy', e['happy'], 2.8)
    rig_eyes[k] = dict(box=list(box), iris=list(e['iris']))

# ------------------------------------------------------------------ mouth shapes
MB = (450, 563, 503, 599)
mx0, my0, mx1, my1 = MB
cx, cy = 476.2, 579.4
lips_hole = poly_mask(MB, [(459, 579), (463, 575.5), (470, 573.4), (476, 574.2), (483, 573.4), (489, 575.5), (494, 579.3), (489, 584), (482, 587.2), (476, 589.5), (470, 587.2), (463, 584)], grow=1.5, blur=0.8)
mskin = inpaint_box(MB, lips_hole, radius=5)
morig = np.dstack([crop(A, MB) / 255, np.ones((my1 - my0, mx1 - mx0))])
LINE_Y = 579.6
INNER = (70, 16, 28, 255); TEETH = (236, 224, 222, 255); TONGUE = (190, 88, 100, 255)
UP = 4  # remap resolution
mh, mw = my1 - my0, mx1 - mx0
big = cv2.resize(crop(A, MB) / 255, (mw * UP, mh * UP), interpolation=cv2.INTER_CUBIC)
lipm = cv2.resize(lips_hole, (mw * UP, mh * UP), interpolation=cv2.INTER_LINEAR)
gy, gx = np.mgrid[0:mh * UP, 0:mw * UP].astype(np.float32)
X = mx0 + (gx + 0.5) / UP - 0.5; Y = my0 + (gy + 0.5) / UP - 0.5     # image coords of each hi-res pixel
upper_m = lipm * np.clip((LINE_Y + 0.6 - Y), 0, 1)
lower_m = lipm * np.clip((Y - LINE_Y + 0.4), 0, 1)

def prof(u, p): return np.where(np.abs(u) < 1, 1 - np.abs(u) ** p, 0.0)

def warp_part(mask, sx, sy, dy_fn):
    """Her own painted lip, scaled about the mouth centre and pushed up/down per column."""
    srcx = cx + (X - cx) / sx
    srcy = LINE_Y + (Y - dy_fn(srcx) - LINE_Y) / sy
    mx = ((srcx - mx0 + 0.5) * UP - 0.5).astype(np.float32); my = ((srcy - my0 + 0.5) * UP - 0.5).astype(np.float32)
    rgba = np.dstack([big, mask])
    return cv2.remap(rgba.astype(np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

def mouth_shape(name, hw, ht, hb, p=2.2, sx=1.0, sy=1.0, teeth=0.0, tongue=0.0, corner_up=0.0):
    cu = lambda x: corner_up * np.clip(np.abs(x - cx) / 15.0, 0, 1) ** 2
    up_dy = lambda x: -ht * prof((x - cx) / (hw / sx), p) - cu(x)
    lo_dy = lambda x: hb * prof((x - cx) / (hw / sx), p) - cu(x)
    out = np.dstack([cv2.resize(mskin, (mw * UP, mh * UP), interpolation=cv2.INTER_CUBIC), np.ones((mh * UP, mw * UP))]).astype(np.float32)
    if ht + hb > 0.2:
        xs = np.linspace(cx - hw, cx + hw, 81)
        top = LINE_Y + up_dy(xs) + 0.2; bot = LINE_Y + lo_dy(xs) - 0.1
        def hp(pts): return [((x - mx0 + 0.5) * UP - 0.5, (y - my0 + 0.5) * UP - 0.5) for x, y in pts]
        def layer(pts, col, blur=0.6):
            im = Image.new('RGBA', (mw * UP * 2, mh * UP * 2)); ImageDraw.Draw(im).polygon([(x * 2, y * 2) for x, y in hp(pts)], fill=col)
            im = im.resize((mw * UP, mh * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur * UP / 4)); return to_f(im)
        inner = layer(list(zip(xs, top)) + list(zip(xs[::-1], bot[::-1])), INNER)
        # darker toward the back of the mouth
        out = paste_over(out, inner)
        clip = inner[..., 3:4]
        if teeth > 0:
            t = layer(list(zip(xs, top - 0.5)) + list(zip(xs[::-1], (top + teeth)[::-1])), TEETH, 0.5); t[..., 3:4] *= clip * 0.78; out = paste_over(out, t)
        if tongue > 0:
            g = Image.new('RGBA', (mw * UP, mh * UP)); dd = ImageDraw.Draw(g)
            tx, ty = (cx - mx0 + 0.5) * UP, (LINE_Y + hb - my0 + 0.6) * UP
            dd.ellipse([tx - hw * 0.62 * UP, ty - tongue * UP, tx + hw * 0.62 * UP, ty + tongue * UP], fill=TONGUE)
            g = to_f(g.filter(ImageFilter.GaussianBlur(UP * 0.4))); g[..., 3:4] *= clip; out = paste_over(out, g)
    out = paste_over(out, warp_part(lower_m, sx, sy, lo_dy))
    out = paste_over(out, warp_part(upper_m, sx, sy, up_dy))
    out = cv2.resize(out, (mw, mh), interpolation=cv2.INTER_AREA)
    fe = np.ones(out.shape[:2], np.float32); b = 4
    for i in range(b):
        v = (i + 0.5) / b; fe[i, :] = np.minimum(fe[i, :], v); fe[-1 - i, :] = np.minimum(fe[-1 - i, :], v); fe[:, i] = np.minimum(fe[:, i], v); fe[:, -1 - i] = np.minimum(fe[:, -1 - i], v)
    out[..., 3] = fe
    save(out, 'mouth-' + name)

mouth_shape('rest', 12, 0, 0)
mouth_shape('smile', 12, 0, 0, sx=1.05, corner_up=1.7)
mouth_shape('small', 10, 0.9, 2.1, p=2.4, sx=0.98, teeth=1.0)
mouth_shape('E', 13, 1.2, 3.0, p=3.0, sx=1.08, sy=0.9, teeth=1.7, corner_up=0.5)
mouth_shape('A', 11, 2.3, 6.2, p=2.0, sx=0.96, teeth=1.5, tongue=2.0)
mouth_shape('O', 7, 2.7, 5.2, p=1.7, sx=0.78, sy=1.12, teeth=0.6, tongue=1.2)
mouth_shape('U', 5, 1.4, 2.7, p=1.6, sx=0.7, sy=1.18)
mouth_shape('happy', 12, 1.2, 3.8, p=2.6, sx=1.06, teeth=1.7, corner_up=1.9)
morig_out = morig.copy(); save(morig_out, 'mouth-orig')

rig = dict(width=W, height=H, face=list(FACE), eyes=rig_eyes, mouth=dict(box=list(MB), center=[cx, cy]),
           pivots=dict(neck=[476, 612], hips=[476, 1190], face=[477, 536], chin=[476, 600]),
           brows=dict(L=[434, 497], R=[519, 500]), ball=[469.6, 1063.4, 118],
           mouthShapes=['rest', 'smile', 'small', 'E', 'A', 'O', 'U', 'happy'],
           weightsScale=0.5)
json.dump(rig, open(OUT + '/rig.json', 'w'), indent=1)
print('rig built', OUT)
