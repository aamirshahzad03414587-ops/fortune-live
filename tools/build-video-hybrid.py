"""Build the video-mode assets from a generated idle clip (image-to-video of mira2-character.png).

Usage:  pip install opencv-python-headless numpy scipy   (ffmpeg on PATH)
        python tools/build-video-hybrid.py SRC_DIR [OUT_DIR]
SRC_DIR has idle-v2.mp4, mouth-o.jpg, mouth-e.jpg, mouth-a.jpg (same framing as the still).
OUT_DIR defaults to public/assets. Writes:
  mira2-idle-loop-1080.mp4 / -720.mp4   eased ping-pong loop (forward, then backward; the speed eases to 0 at each turn)
  mira2-idle-loop.track.json            per loop frame: mouth / skull / scene affines, skin-tone gain
  mira2v-mouth-{o,e,a}.png              lip-sync patches cut against the clip's first frame
  mira2v-mouth-x.png                    the first frame's own closed lips (held under the shapes while speaking)
  mira2v-poster.jpg                     first frame (shown until the video plays; identical to loop frame 0)

Why ping-pong: the clip has a slow camera push-in (background +3.8 %, face +8 % over 6 s with parallax), so its
end never matches its start; a crossfade would blend two framings (ghosting). Stabilising can't remove parallax.
"""
import cv2, numpy as np, json, os, sys, subprocess, tempfile, glob
from scipy.signal import savgol_filter
SRC = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
tmp = tempfile.mkdtemp(); subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, 'idle-v2.mp4'), '-map', '0:v:0', f'{tmp}/%04d.png'], check=True)
F = [cv2.imread(f) for f in sorted(glob.glob(f'{tmp}/*.png'))]; N = len(F); H, W = F[0].shape[:2]
MX, MY = 549, 667                                    # mouth centre in frame 0 (1088x1920)
crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 400, 1e-8)
def gray(im, s=1.0): return cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255, (0, 0), s)
def gradmag(im):
    g = gray(im, 1.5); return cv2.GaussianBlur(cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)), (0, 0), 1.5)
def track_region(G, cx, cy, w, h, mask=None, pad=40, inits=None):
    """ECC affine of a region of frame 0 through all frames. Returns frame0->frame i affines (2x3)."""
    x0, y0 = int(cx - w / 2), int(cy - h / 2); o = np.array([x0 - pad, y0 - pad])
    T0 = G[0][y0 - pad:y0 + h + pad, x0 - pad:x0 + w + pad]
    m = np.zeros(T0.shape, np.uint8); m[pad:pad + h, pad:pad + w] = 255 if mask is None else mask
    out, prev = [], np.eye(2, 3, dtype=np.float32)
    for i in range(len(G)):
        init = np.array(inits[i], np.float32) if inits is not None else prev
        Wc = init.copy(); Wc[:, 2] = init[:, :2] @ o + init[:, 2] - o
        try: _, Wc = cv2.findTransformECC(T0, G[i][y0 - pad:y0 + h + pad, x0 - pad:x0 + w + pad], Wc, cv2.MOTION_AFFINE, crit, m, 5)
        except cv2.error: pass
        Wf = Wc.copy(); Wf[:, 2] = Wc[:, 2] + o - Wc[:, :2] @ o; out.append(Wf); prev = Wf
    return np.array(out)
# 1) tracks on the source frames
G = [gray(f) for f in F]
fm = np.full((300, 300), 255, np.uint8); fm[0:55, :] = 0   # coarse face track (top of the hair out); refined on lip/nose/chin edges below
face = track_region(G, MX, MY - 60, 300, 300, fm)
mouth = track_region([gradmag(f) for f in F], MX, MY - 15, 200, 160, pad=30, inits=face)   # edges: lips, nostrils, chin line
mouth = savgol_filter(mouth.reshape(N, -1), 9, 2, axis=0).reshape(mouth.shape)
skull = savgol_filter(track_region(G, 170, 1069, 200, 170).reshape(N, -1), 9, 2, axis=0).reshape(N, 2, 3)
sm = np.zeros((H // 2, W // 2), np.uint8); h2, w2 = sm.shape
for x0, y0, x1, y1 in [(0, 0, 1, .15), (0, .15, .22, .45), (.78, .15, 1, .45), (0, .8, 1, 1), (.35, .12, .65, .22)]: sm[int(y0 * h2):int(y1 * h2), int(x0 * w2):int(x1 * w2)] = 255
Gs = [cv2.resize(g, (w2, h2), interpolation=cv2.INTER_AREA) for g in G]; scene = []; prev = np.eye(2, 3, dtype=np.float32)
for g in Gs:
    _, prev = cv2.findTransformECC(Gs[0], g, prev.copy(), cv2.MOTION_AFFINE, crit, sm, 5); A = prev.copy(); A[:, 2] *= 2; scene.append(A)
scene = np.array(scene)
ring = np.zeros((H, W), np.uint8); cv2.ellipse(ring, (MX, MY), (48, 41), 0, 0, 360, 255, -1); cv2.ellipse(ring, (MX, MY), (33, 26), 0, 0, 360, 0, -1)
base = F[0][ring > 0].astype(float).mean(0)
gain = np.array([(F[i][cv2.warpAffine(ring, mouth[i].astype(np.float32), (W, H), flags=cv2.INTER_NEAREST) > 0].astype(float).mean(0) / base).mean() for i in range(N)])
# 2) eased ping-pong timeline (24 fps): ease-in over R frames, 1x, ease-out, then the mirror image
R, Tn = 18, N - 1; f = []; t = 0.0
for n in range(R): f.append(t); t += 0.5 - 0.5 * np.cos(np.pi * (n + 0.5) / R)
while t < Tn - R / 2 - 1e-6: f.append(t); t += 1
for n in range(R): f.append(t); t += 0.5 + 0.5 * np.cos(np.pi * (n + 0.5) / R)
times = [min(Tn, max(0.0, x)) for x in f + [Tn - x for x in f]]
lerp = lambda arr, t: arr[int(t)] * (1 - (t - int(t))) + arr[min(len(arr) - 1, int(t) + 1)] * (t - int(t))
master = os.path.join(tmp, 'master.mkv')
p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', '24', '-i', '-', '-c:v', 'ffv1', master], stdin=subprocess.PIPE)
for t in times:
    i, w = int(t), t - int(t)
    im = F[i].astype(np.float32) if w < 1e-3 else F[i].astype(np.float32) * (1 - w) + F[min(N - 1, i + 1)].astype(np.float32) * w
    p.stdin.write(np.clip(im + 0.5, 0, 255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait()
X = f'keyint={len(times)}:min-keyint={len(times)}:scenecut=0:ipratio=1.15:zones={len(times) - 28},{len(times) - 1},b=3.0'   # one GOP; better last frames = no quality pop at the wrap
for name, vf, br, mr in [('1080', [], '4300k', '9000k'), ('720', ['-vf', 'scale=720:1270:flags=lanczos'], '2200k', '5000k')]:
    common = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', br, '-x264-params', X, '-pix_fmt', 'yuv420p', '-an', '-passlogfile', os.path.join(tmp, 'p' + name)]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, *vf, *common, '-pass', '1', '-f', 'null', '/dev/null'], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, *vf, *common, '-maxrate', mr, '-bufsize', '9000k', '-pass', '2', '-profile:v', 'high', '-movflags', '+faststart', os.path.join(OUT, f'mira2-idle-loop-{name}.mp4')], check=True)
# 3) mouth patches against frame 0
RX, RY, FE = 31, 24, 10; C0x, C0y, CW, CH = MX - 200, MY - 220, 400, 340
crop = lambda im: im[C0y:C0y + CH, C0x:C0x + CW]; B = crop(F[0]); GB = gray(B); mx, my = MX - C0x, MY - C0y
reg = np.zeros(GB.shape, np.uint8); reg[my - 170:my - 16, mx - 135:mx + 135] = 255; reg[my - 16:my + 44, mx - 135:mx - 52] = 255; reg[my - 16:my + 44, mx + 52:mx + 135] = 255; reg[my - 150:my - 95, :] = 0
def ell(rx, ry): e = np.zeros(GB.shape, np.float32); cv2.ellipse(e, (mx, my), (rx, ry), 0, 0, 360, 1, -1); return e
alpha = np.clip(1 - cv2.distanceTransform((1 - ell(RX, RY)).astype(np.uint8), cv2.DIST_L2, 5) / FE, 0, 1); alpha = alpha * alpha * (3 - 2 * alpha)
rg = (ell(RX + FE + 7, RY + FE + 7) - ell(RX + 2, RY + 2)) > 0
X0, Y0, X1, Y1 = mx - RX - FE - 4, my - RY - FE - 4, mx + RX + FE + 4, my + RY + FE + 4
for n in 'oea':
    m = cv2.imread(os.path.join(SRC, f'mouth-{n}.jpg')); m = crop(cv2.resize(m, (W, int(round(m.shape[0] * W / m.shape[1]))), interpolation=cv2.INTER_LANCZOS4))
    best = None
    for s in np.linspace(0.97, 1.03, 13):
        Wm = np.array([[s, 0, MX * (1 - s)], [0, s, MY * (1 - s) + 3.4]], np.float32); Wc = Wm.copy(); Wc[:, 2] += Wm[:, :2] @ np.array([C0x, C0y]) - np.array([C0x, C0y])
        try: cc, Wr = cv2.findTransformECC(GB, gray(m), Wc, cv2.MOTION_TRANSLATION, (3, 300, 1e-7), reg, 5)
        except cv2.error: continue
        if best is None or cc > best[0]: best = (cc, Wr)
    a = cv2.warpAffine(m, best[1], (CW, CH), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP).astype(np.float32); b = B.astype(np.float32); adj = a.copy()
    for c in range(3):
        mb, sb = b[..., c][rg].mean(), b[..., c][rg].std(); ma, sa = a[..., c][rg].mean(), a[..., c][rg].std(); adj[..., c] = (a[..., c] - ma) * (0.5 * sb / max(sa, 1e-3) + 0.5) + mb
    comp = np.clip(b * (1 - alpha[..., None]) + adj * alpha[..., None], 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, f'mira2v-mouth-{n}.png'), np.dstack([comp[Y0:Y1, X0:X1], (alpha[Y0:Y1, X0:X1] * 255).astype(np.uint8)]))
# closed lips of the first frame with the same alpha: held under the open shapes while she speaks
cv2.imwrite(os.path.join(OUT, 'mira2v-mouth-x.png'), np.dstack([B[Y0:Y1, X0:X1], (alpha[Y0:Y1, X0:X1] * 255).astype(np.uint8)]))
cv2.imwrite(os.path.join(OUT, 'mira2v-poster.jpg'), F[0], [cv2.IMWRITE_JPEG_QUALITY, 90])
# 4) track file
r5 = lambda a: [round(float(x), 5) for x in np.array(a).ravel()]
json.dump(dict(version=1, fps=24, frames=len(times), width=W, height=H, note='Per-frame affines [a00,a01,a02,a10,a11,a12] mapping loop-frame-0 video pixels to that frame.',
    mouthRect=dict(x=C0x + X0, y=C0y + Y0, w=X1 - X0, h=Y1 - Y0), points=dict(eyes=[[171.9, 1067.5], [220.9, 1059.8]], skull=[161.0, 1071.3], ball=[543.0, 1226.0], ballR=124.0),
    mouth=[r5(lerp(mouth, t)) for t in times], skull=[r5(lerp(skull, t)) for t in times], scene=[r5(lerp(scene, t)) for t in times], gain=[round(float(lerp(gain, t)), 4) for t in times]),
    open(os.path.join(OUT, 'mira2-idle-loop.track.json'), 'w'), separators=(',', ':'))
print('done', len(times), 'loop frames')
