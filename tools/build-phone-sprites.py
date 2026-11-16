"""Cuts the iPhone ("phone mode") sprites for Mira v1/v2 out of frames baked from the real rig.
Run tools/build-phone-sprites.mjs first (it writes /tmp/phone-frames/<v>/*.png), then:
    python tools/build-phone-sprites.py            -> public/assets/phone/<v>/{base.jpg, upper.png, *.png, phone.json}
Phone mode draws, on one small 2D canvas: base.jpg (the room, the table and her lower body; behind her upper body the
painted-out room), upper.png (her upper body, moved with a breathing / sway / bow transform about the hips) and small
face patches (eyelids, mouth shapes) that only cover the pixels they change. Everything is sized for a phone:
780 px wide = an iPhone's ~390 CSS px x 2, so it is sharp there and ~10 MB of decoded images in total.
"""
import json, os, sys
from PIL import Image, ImageChops, ImageFilter
import numpy as np

SRC = os.environ.get('FRAMES', '/tmp/phone-frames/')
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
OUT_W = int(os.environ.get('OUT_W', 780))
CHARS = {
    # upper body fades out between y0 and y1 (picture px), above the crystal ball / hands, which stay in the base
    'v1': {'room': 'rig/bg.jpg', 'alpha': 'rig/char-alpha.png', 'fade': (840, 940)},
    'v2': {'room': 'rig-v2/room.jpg', 'alpha': None, 'fade': (1000, 1100)},
}

def resize_box(im, k, box):
    """Crop box (output px) from a full-size image, resampled so it lands exactly on the output pixel grid."""
    x0, y0, x1, y1 = box
    mode = im.mode
    src = im.convert('RGBa') if mode == 'RGBA' else im
    out = src.resize((x1 - x0, y1 - y0), Image.LANCZOS, box=(x0 / k, y0 / k, min(im.width, x1 / k), min(im.height, y1 / k)))
    return out.convert('RGBA') if mode == 'RGBA' else out

def bbox_out(mask, k, pad=1):
    ys, xs = np.nonzero(mask)
    W, H = mask.shape[1], mask.shape[0]
    x0 = max(0, int(np.floor(xs.min() * k)) - pad); y0 = max(0, int(np.floor(ys.min() * k)) - pad)
    x1 = min(int(round(W * k)), int(np.ceil((xs.max() + 1) * k)) + pad); y1 = min(int(round(H * k)), int(np.ceil((ys.max() + 1) * k)) + pad)
    return [x0, y0, x1, y1]

for v, c in CHARS.items():
    d = os.path.join(SRC, v)
    rig = json.load(open(os.path.join(d, 'rig.json')))
    W, H = rig['width'], rig['height']; k = OUT_W / W; OH = int(round(H * k))
    neutral = Image.open(os.path.join(d, 'neutral.png')).convert('RGB')
    room = Image.open(os.path.join(ROOT, c['room'])).convert('RGB').resize((W, H))
    # her silhouette (0..1)
    if c['alpha']:
        s = np.asarray(Image.open(os.path.join(ROOT, c['alpha'])).convert('L').resize((W, H)), np.float32) / 255
    else:
        s = np.asarray(Image.open(os.path.join(ROOT, 'rig-v2/body.png')).split()[3], np.float32) / 255
    # v2 extras (phone "lively" mode): the ponytail and the tarot charm swing as their own sprites, so their pixels
    # come out of the body / base (body.png already has both painted out); the table goes back over the charm
    extra = {}
    if v == 'v2':
        for nm in ('tail', 'charm'):
            L = rig['layers'][nm]; im = Image.open(os.path.join(ROOT, 'rig-v2', nm + '.png')).convert('RGBA')
            full_a = np.zeros((H, W), np.float32); x, y, w_, h_ = L['rect']; full_a[y:y + h_, x:x + w_] = np.asarray(im.split()[3], np.float32) / 255
            extra[nm] = (L, im, full_a)
    y0, y1 = c['fade']; yy = np.arange(H, dtype=np.float32)[:, None]
    u = np.clip((y1 - yy) / (y1 - y0), 0, 1); u = u * u * (3 - 2 * u)
    A = s * u                                                   # the moving layer's alpha
    wts = Image.open(os.path.join(ROOT, 'rig' if v == 'v1' else 'rig-v2', 'weights.png')).convert('RGBA')
    wts = Image.merge('RGB', wts.split()[:3]).resize((W, H), Image.BILINEAR)   # RGB first: resizing RGBA zeroes colour where alpha is 0
    wr = np.asarray(wts.split()[0], np.float32) / 255; wg = np.asarray(wts.split()[1], np.float32) / 255
    sm = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    neutral_np = np.asarray(neutral, np.float32)
    body_rgb = None
    if extra:
        bimg = Image.open(os.path.join(ROOT, 'rig-v2/body.png')).convert('RGBA'); body_rgb = np.asarray(bimg.convert('RGB'), np.float32)
        ta = np.asarray(Image.fromarray((extra['tail'][2] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), np.float32)[..., None] / 255
        neutral_np = neutral_np * (1 - ta) + body_rgb * ta          # her body under the ponytail (the ponytail is drawn on top)
        neutral = Image.fromarray(neutral_np.astype(np.uint8))
    full = ((s > 0.02) | ((extra['tail'][2] > 0.02) if extra else False)) & (u >= 0.999)   # behind her upper body (and ponytail): the room plate
    fb = np.asarray(Image.fromarray((full * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), np.float32)[..., None] / 255
    base = (np.asarray(neutral, np.float32) * (1 - fb) + np.asarray(room, np.float32) * fb)
    if extra:
        # the charm hangs in the static part of the picture: paint it out (room < body < table) so it can swing
        L, cim, ca = extra['charm']
        cb = np.asarray(Image.fromarray((ca * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.float32)[..., None] / 255
        ba = np.asarray(bimg.split()[3], np.float32)[..., None] / 255
        under = np.asarray(room, np.float32) * (1 - ba) + body_rgb * ba
        tb = Image.open(os.path.join(ROOT, 'rig-v2/table.png')).convert('RGBA'); tx, ty, tw, th = rig['layers']['table']['rect']
        tfull = np.zeros((H, W, 4), np.float32); tfull[ty:ty + th, tx:tx + tw] = np.asarray(tb.resize((tw, th)), np.float32)
        under = under * (1 - tfull[..., 3:] / 255) + tfull[..., :3] * (tfull[..., 3:] / 255)
        base = base * (1 - cb) + under * cb
    base = base.astype(np.uint8)
    od = os.path.join(ROOT, 'phone', v); os.makedirs(od, exist_ok=True)
    resize_box(Image.fromarray(base), k, (0, 0, OUT_W, OH)).save(os.path.join(od, 'base.jpg'), quality=86, optimize=True, progressive=False)
    # head: its own layer (rolls / turns / nods about the neck); the upper body keeps everything but the solid core of
    # the head, so the layers overlap smoothly at the neck and no old head shows behind a moved one
    HA = A * sm(wr, 0.02, 0.45)
    A_up = A * (1 - sm(wr, 0.45, 0.7))
    up = np.dstack([np.asarray(neutral), (A_up * 255).astype(np.uint8)])
    ub = bbox_out(A > 0.004, k)
    resize_box(Image.fromarray(up, 'RGBA'), k, ub).save(os.path.join(od, 'upper.png'), optimize=True)
    hb = bbox_out(HA > 0.004, k)
    resize_box(Image.fromarray(np.dstack([np.asarray(neutral), (HA * 255).astype(np.uint8)]), 'RGBA'), k, hb).save(os.path.join(od, 'head.png'), optimize=True)
    # hair ends (weights' green): drawn again on top of the head with a sideways swing
    GA = A * sm(wg, 0.05, 0.6)
    gbx = bbox_out(GA > 0.01, k) if GA.max() > 0.05 else None
    if gbx: resize_box(Image.fromarray(np.dstack([np.asarray(neutral), (GA * 255).astype(np.uint8)]), 'RGBA'), k, gbx).save(os.path.join(od, 'hair.png'), optimize=True)
    # candle flames (the brightest small spots outside the crystal ball) for the cheap glow
    small = np.asarray(Image.fromarray(base).resize((OUT_W, OH)).filter(ImageFilter.GaussianBlur(3)), np.float32)
    lum = small.mean(axis=2) * ((small[..., 0] - small[..., 2]) > 45) * (small[..., 0] > 200)   # warm and bright: candle flames, not the moon
    bx_, by_, br_ = [c_ * k for c_ in rig['ball']]; flames = []
    yy2, xx2 = np.mgrid[0:OH, 0:OUT_W]; L2 = lum.copy(); L2[(xx2 - bx_) ** 2 + (yy2 - by_) ** 2 < (br_ * 1.4) ** 2] = 0
    for _ in range(10):
        i = int(L2.argmax()); y_, x_ = divmod(i, OUT_W)
        if L2[y_, x_] < 150: break
        if x_ < 12 or x_ > OUT_W - 12 or y_ > by_ - 10:   # edges; gold on the table and hands are not candles
            L2[max(0, y_ - 30):y_ + 30, max(0, x_ - 30):x_ + 30] = 0; continue
        flames.append([int(x_), int(y_)]); L2[max(0, y_ - 30):y_ + 30, max(0, x_ - 30):x_ + 30] = 0
    man_extra = {'head': {'src': 'head.png', 'rect': [hb[0], hb[1], hb[2] - hb[0], hb[3] - hb[1]]}, 'flames': flames}
    if gbx: man_extra['hair'] = {'src': 'hair.png', 'rect': [gbx[0], gbx[1], gbx[2] - gbx[0], gbx[3] - gbx[1]]}
    for nm, (L, im, _) in extra.items():
        x, y, w_, h_ = L['rect']; box = [int(np.floor(x * k)), int(np.floor(y * k)), int(np.ceil((x + w_) * k)), int(np.ceil((y + h_) * k))]
        im.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS).save(os.path.join(od, nm + '.png'), optimize=True)
        man_extra[nm] = {'src': nm + '.png', 'rect': [box[0], box[1], box[2] - box[0], box[3] - box[1]], 'anchor': [round(L['anchor'][0] * k, 1), round(L['anchor'][1] * k, 1)], 'length': round(L['length'] * k, 1)}
    if extra:
        # the table in front of the swinging charm
        L = rig['layers']['charm']; x, y, w_, h_ = L['rect']; tx, ty, tw, th = rig['layers']['table']['rect']
        fx0, fx1, fy1 = max(tx, x - 70), min(tx + tw, x + w_ + 70), min(ty + th, y + h_ + 30)
        tcrop = np.zeros((fy1 - ty, fx1 - fx0, 4), np.uint8); tcrop[...] = tfull[ty:fy1, fx0:fx1].astype(np.uint8)
        fb2 = [int(np.floor(fx0 * k)), int(np.floor(ty * k)), int(np.ceil(fx1 * k)), int(np.ceil(fy1 * k))]
        Image.fromarray(tcrop, 'RGBA').resize((fb2[2] - fb2[0], fb2[3] - fb2[1]), Image.LANCZOS).save(os.path.join(od, 'table-front.png'), optimize=True)
        man_extra['tableFront'] = {'src': 'table-front.png', 'rect': [fb2[0], fb2[1], fb2[2] - fb2[0], fb2[3] - fb2[1]]}
    man = {'version': 2 if rig.get('version') == 2 else 1, 'width': OUT_W, 'height': OH, 'scale': k,
           'upper': {'src': 'upper.png', 'rect': [ub[0], ub[1], ub[2] - ub[0], ub[3] - ub[1]]},
           'pivots': {kk: [round(p[0] * k, 1), round(p[1] * k, 1)] for kk, p in rig['pivots'].items()},
           'ball': [round(rig['ball'][0] * k, 1), round(rig['ball'][1] * k, 1), round(rig['ball'][2] * k, 1)],
           'patches': {}, **man_extra}
    nz = np.asarray(neutral, np.int16)
    for f in sorted(os.listdir(d)):
        if not f.startswith(('eye-', 'mouth-', 'gaze-', 'brow-')): continue
        im = Image.open(os.path.join(d, f)).convert('RGB'); a = np.asarray(im, np.int16)
        diff = (np.abs(a - nz).max(axis=2) > 5).astype(np.uint8) * 255
        # only the face can change in these frames: drop stray pixels elsewhere (hair / tail settle a little between bakes)
        fxp, fyp = rig['pivots']['face']; cyp = rig['pivots']['chin'][1]; keep = np.zeros_like(diff)
        fx0_, fx1_, fy0_, fy1_ = int(fxp - 0.14 * W), int(fxp + 0.14 * W), int(fyp - 0.075 * H), int(cyp + 0.02 * H)
        keep[max(0, fy0_):fy1_, max(0, fx0_):fx1_] = 1; diff = diff * keep
        m = Image.fromarray(diff).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2))
        m = np.asarray(m, np.float32) / 255; m = np.clip(m * 1.6, 0, 1)
        if m.max() < 0.05: continue
        box = bbox_out(m > 0.01, k)
        rgba = np.dstack([np.asarray(im), (m * 255).astype(np.uint8)])
        name = f[:-4]
        resize_box(Image.fromarray(rgba, 'RGBA'), k, box).save(os.path.join(od, name + '.png'), optimize=True)
        man['patches'][name] = [box[0] - ub[0], box[1] - ub[1], box[2] - box[0], box[3] - box[1]]   # relative to the upper layer
    json.dump(man, open(os.path.join(od, 'phone.json'), 'w'), indent=1)
    tot = sum(os.path.getsize(os.path.join(od, f)) for f in os.listdir(od))
    print(v, 'base', OUT_W, 'x', OH, 'upper', man['upper']['rect'], 'patches', len(man['patches']), 'bytes', tot)
