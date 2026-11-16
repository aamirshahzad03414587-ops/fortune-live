"""Rebuild the lip-sync mouth patches for the Mira still.

Usage:  pip install opencv-python-headless numpy
        python tools/build-mouth-patches.py SRC_DIR  (SRC_DIR has mira2-character.png, mouth-o.jpg, mouth-e.jpg, mouth-a.jpg)

1. The still is saved as public/assets/mira2.jpg; patches are cut from that exact JPEG so pixels match.
2. Each mouth image is resized to the still and registered with ECC (translation, scale searched) on the
   nose/cheek/jaw-edge region, with the mouth excluded (the jaw moves when the mouth opens).
3. Inside a feathered ellipse around the mouth, the aligned mouth replaces the still; colours are matched
   to the skin ring around it. Output: RGBA PNG patches + the patch rectangle (printed, % of image).
"""
import cv2, numpy as np, sys, os, json
src = sys.argv[1] if len(sys.argv) > 1 else '.'
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
base = cv2.imread(os.path.join(src, 'mira2-character.png'))
cv2.imwrite(os.path.join(out, 'mira2.jpg'), base, [cv2.IMWRITE_JPEG_QUALITY, 92])
base = cv2.imread(os.path.join(out, 'mira2.jpg')); H, W = base.shape[:2]
MX, MY = 475, 581            # mouth centre in the 941x1672 still
RX, RY, FE = 27, 21, 9       # replaced ellipse radii and feather width (px)
g = lambda im: cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255, (0, 0), 1.0)
G = g(base)
reg = np.zeros((H, W), np.uint8)
reg[MY-152:MY-14, MX-120:MX+120] = 255
reg[MY-14:MY+38, MX-120:MX-45] = 255; reg[MY-14:MY+38, MX+45:MX+120] = 255
def ell(rx, ry):
    m = np.zeros((H, W), np.float32); cv2.ellipse(m, (MX, MY), (rx, ry), 0, 0, 360, 1, -1); return m
inner = ell(RX, RY)
dist = cv2.distanceTransform((1 - inner).astype(np.uint8), cv2.DIST_L2, 5)
alpha = np.clip(1 - dist / FE, 0, 1); alpha = alpha * alpha * (3 - 2 * alpha)
ring = (ell(RX+FE+6, RY+FE+6) - ell(RX+2, RY+2)) > 0
X0, Y0, X1, Y1 = MX-RX-FE-4, MY-RY-FE-4, MX+RX+FE+4, MY+RY+FE+4
for n in 'oea':
    m = cv2.resize(cv2.imread(os.path.join(src, f'mouth-{n}.jpg')), (W, H), interpolation=cv2.INTER_LANCZOS4)
    best = None
    for s in np.linspace(0.97, 1.03, 13):
        Wm = np.array([[s, 0, MX*(1-s)], [0, s, MY*(1-s) - 8]], np.float32)
        try: cc, Wr = cv2.findTransformECC(G, g(m), Wm.copy(), cv2.MOTION_TRANSLATION, (3, 200, 1e-7), reg, 5)
        except cv2.error: continue
        if best is None or cc > best[0]: best = (cc, s, Wr)
    cc, s, Wm = best
    al = cv2.warpAffine(m, Wm, (W, H), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP).astype(np.float32)
    b = base.astype(np.float32); adj = al.copy()
    for c in range(3):
        mb, sb = b[..., c][ring].mean(), b[..., c][ring].std(); ma, sa = al[..., c][ring].mean(), al[..., c][ring].std()
        adj[..., c] = (al[..., c] - ma) * (0.5 * sb / max(sa, 1e-3) + 0.5) + mb
    comp = np.clip(b * (1 - alpha[..., None]) + adj * alpha[..., None], 0, 255).astype(np.uint8)
    rgba = np.dstack([comp[Y0:Y1, X0:X1], (alpha[Y0:Y1, X0:X1] * 255).astype(np.uint8)])
    cv2.imwrite(os.path.join(out, f'mira2-mouth-{n}.png'), rgba)
    print(n, 'ecc', round(float(cc), 4), 'scale', round(float(s), 3), 'shift', Wm[:, 2].round(2).tolist())
print(json.dumps({'x': round(X0/W*100, 4), 'y': round(Y0/H*100, 4), 'w': round((X1-X0)/W*100, 4), 'h': round((Y1-Y0)/H*100, 4)}))
