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
        tl = rig['layers']['tail']['rect']; tail = np.asarray(Image.open(os.path.join(ROOT, 'rig-v2/tail.png')).split()[3], np.float32) / 255
        s = s.copy(); x, y = tl[0], tl[1]; s[y:y + tail.shape[0], x:x + tail.shape[1]] = np.maximum(s[y:y + tail.shape[0], x:x + tail.shape[1]], tail)
    y0, y1 = c['fade']; yy = np.arange(H, dtype=np.float32)[:, None]
    u = np.clip((y1 - yy) / (y1 - y0), 0, 1); u = u * u * (3 - 2 * u)
    A = s * u                                                   # the moving layer's alpha
    full = (s > 0.02) & (u >= 0.999)                            # behind her upper body: the room plate (no ghost when she moves)
    fb = np.asarray(Image.fromarray((full * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), np.float32)[..., None] / 255
    base = (np.asarray(neutral, np.float32) * (1 - fb) + np.asarray(room, np.float32) * fb).astype(np.uint8)
    od = os.path.join(ROOT, 'phone', v); os.makedirs(od, exist_ok=True)
    resize_box(Image.fromarray(base), k, (0, 0, OUT_W, OH)).save(os.path.join(od, 'base.jpg'), quality=86, optimize=True, progressive=False)
    up = np.dstack([np.asarray(neutral), (A * 255).astype(np.uint8)])
    ub = bbox_out(A > 0.004, k)
    resize_box(Image.fromarray(up, 'RGBA'), k, ub).save(os.path.join(od, 'upper.png'), optimize=True)
    man = {'version': 2 if rig.get('version') == 2 else 1, 'width': OUT_W, 'height': OH, 'scale': k,
           'upper': {'src': 'upper.png', 'rect': [ub[0], ub[1], ub[2] - ub[0], ub[3] - ub[1]]},
           'pivots': {kk: [round(p[0] * k, 1), round(p[1] * k, 1)] for kk, p in rig['pivots'].items()},
           'ball': [round(rig['ball'][0] * k, 1), round(rig['ball'][1] * k, 1), round(rig['ball'][2] * k, 1)],
           'patches': {}}
    nz = np.asarray(neutral, np.int16)
    for f in sorted(os.listdir(d)):
        if not (f.startswith('eye-') or f.startswith('mouth-')): continue
        im = Image.open(os.path.join(d, f)).convert('RGB'); a = np.asarray(im, np.int16)
        diff = (np.abs(a - nz).max(axis=2) > 5).astype(np.uint8) * 255
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
