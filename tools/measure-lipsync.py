# Dev tool: python tools/measure-lipsync.py clip.mp3  (after render-lipsync-demo.mjs). Measures mouth openness from the rendered pixels vs the audio.
import json, subprocess, numpy as np, cv2, sys
d = json.load(open('/tmp/render/frames.json')); FPS = d['FPS']; LEAD = d['LEAD_IN']
mp3 = sys.argv[1]
raw = subprocess.run(['ffmpeg','-v','quiet','-i',mp3,'-f','f32le','-ac','1','-ar','24000','-'],capture_output=True).stdout
pcm = np.frombuffer(raw, np.float32); SR = 24000
S = 720/1080; cx, cy = 363, 445   # mouth centre in the 720x1280 frame
opens, rms = [], []
for f in d['frames']:
    im = cv2.imread(f"/tmp/render/f{f['i']:05d}.png")
    roi = im[cy-11:cy+14, cx-24:cx+24]   # lips + mouth interior only (nostrils excluded)
    v = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)[..., 2]
    opens.append(int((v < 60).sum()))   # very dark = open mouth interior (closed lips are never this dark)
    t = f['speechT']; s0 = int((t - 1/FPS/2) * SR); s1 = int((t + 1/FPS/2) * SR)
    if s1 <= 0 or s0 >= len(pcm): rms.append(0.0)
    else: seg = pcm[max(0,s0):min(len(pcm),s1)]; rms.append(float(np.sqrt((seg**2).mean())) if len(seg) else 0.0)
opens = np.array(opens, float); rms = np.array(rms)
base = np.median(opens[:int(LEAD*FPS)-2])             # closed mouth (before speech)
op = np.clip(opens - base, 0, None)
db = 20*np.log10(rms+1e-9); ref = np.percentile(db[db>-60], 95); loud = np.clip((db-(ref-30))/30, 0, 1)
pear = lambda a, b: float(np.corrcoef(a, b)[0, 1])
lags = {L: pear(op[max(0,L):len(op)+min(0,L)], loud[max(0,-L):len(loud)-max(0,L)]) for L in range(-4, 5)}
silent = np.array([all(db[j] < ref-35 for j in range(max(0,i-2), min(len(db),i+3))) for i in range(len(db))])
closed = op <= 0.15*op.max()
inspeech = (np.array([f['speechT'] for f in d['frames']]) >= 0) & (np.array([f['speechT'] for f in d['frames']]) <= d['duration'])
voiced = db > ref-25
res = dict(frames=len(op), fps=FPS, pixel_open_vs_rms_pearson=round(pear(op, rms),3), pixel_open_vs_loudness_pearson=round(pear(op, loud),3),
  best_lag_frames=max(lags, key=lags.get), lag_curve={k: round(v,3) for k,v in lags.items()},
  silent_frames=int(silent.sum()), silent_frames_mouth_closed_pct=round(100*float(closed[silent].mean()),1),
  silent_frames_inside_speech=int((silent & inspeech).sum()), closed_pct_in_pauses_inside_speech=round(100*float(closed[silent & inspeech].mean()),1) if (silent&inspeech).any() else None,
  voiced_frames_mouth_open_pct=round(100*float((~closed[voiced]).mean()),1),
  viseme_vs_pixels_pearson=round(pear(op, np.array([[0,.35,.85,1][f['v']] for f in d['frames']])),3))
print(json.dumps(res, indent=1)); json.dump(res, open('/tmp/render/sync-stats.json','w'), indent=1)
np.save('/tmp/render/series.npy', np.vstack([op, loud, rms]))
