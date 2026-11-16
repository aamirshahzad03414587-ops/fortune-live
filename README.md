# 🔮 Fortune Live: TikTok LIVE numerology fortune-teller

An interactive TikTok LIVE show hosted by **Mystic Mira**, an animated anime fortune-teller who **talks out loud**.

* **Readings (in the comments):** viewers just comment their **name and birth date**, plus an optional question and optional mother/father names, e.g. `Sara 12/05/1998 mother Hina father Ali will I travel this year?`. Mira lays her hand on her skull, its eyes glow purple, and she **speaks** a short prediction (15–25 s): their Life Path, their Personal Year 2026 and an answer to their question themed by their numbers. Their name, date and question show in the caption bubble. No form, no codes, no gift needed (for now): one reading per viewer per LIVE, a queue cap for free readings, and gifters jump the queue (bigger gift = longer reading). Every ~75 s she reminds people how to ask.
* **Chat:** Mira **answers comments one by one** with a real voice, thanks gifters, welcomes followers, and asks the audience questions when chat goes quiet. Readings always come first.

> **For entertainment only.** Numerology is a traditional practice, not science. The overlay, form and report all say so. Keep it that way on TikTok.

---

## What's inside

| Part | Where | What it does |
|---|---|---|
| Numerology engine | `src/numerology.js`, `src/meanings.js` | Traditional Pythagorean numerology: Life Path (keeps 11/22/33), Expression/Destiny, Soul Urge (vowels), Personality (consonants), Birthday, Maturity, Personal Year 2026, plus mother/father name numbers ("family influence"). Fixed traditional meanings, nothing random, so the same input always gives the same result. |
| Viewer form | `http://YOUR-SITE/` | Private form with a consent checkbox and an auto-delete option. Gives the viewer a code and a private report link. |
| Private report | `http://YOUR-SITE/r/<secret>` | Full styled report with save-as-PDF and a "Delete my data now" button. |
| LIVE overlay | `/overlay` (1080×1920) and `/overlay?layout=landscape` (1920×1080) | Animated Mira (a looping generated idle video with a face-tracked lip-sync mouth driven by her real voice, plus a skull "prophecy" reveal; a still-picture mode is kept as a fallback), her voice, subtitles, comment bubble, queue, hearts, gift and follow messages, and the "for entertainment" footer. |
| Mira's voice | `src/tts.js` | Free Microsoft Edge neural voices (en-US-AvaNeural at +2% speed, +6% pitch by default: a bright young-adult woman, median pitch about 216 Hz; Urdu ur-PK-UzmaNeural). The server makes an MP3 and the overlay plays it, so it **works inside OBS**. |
| Mira's brain | `src/chat.js` | Comment filters (spam, links, swear words), built-in reply engine (greetings, love, money, career, health, birthdays, thanks, "who are you", Roman Urdu), or optional AI replies with any OpenAI-compatible API key. |
| Control panel | `/admin` | TikFinity setup, simulator, queue controls (pause/skip/clear), limits editor, delete all data. |
| LIVE events | `src/tiktok.js`, `public/tikfinity.js` | **Direct** (default when `TIKTOK_USERNAME` is set): the server reads the LIVE itself with `tiktok-live-connector`, so no PC app is needed. **TikFinity**: the overlay listens to the TikFinity desktop app (`ws://127.0.0.1:21213/`). **Both**: the same event from both sources is counted once. |
| Limits | `config.json` (or the control panel) | Trigger gift, minimum coins, tiers, per-viewer limits, queue size, seconds on screen, data retention. |

---

## Setup on a Windows PC (step by step)

1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** version (22 or newer) and install it with the default options.
2. **Unzip** `fortune-live.zip`, for example to `C:\fortune-live`.
3. Open the folder, click the address bar, type `cmd` and press Enter. A black Command Prompt window opens in that folder.
4. Install the packages (one time only):
   ```
   npm install
   ```
5. Start it:
   ```
   npm start
   ```
   The window prints your links. Leave it open while you stream.
6. Open **http://localhost:3000/admin** in Chrome. This is your control panel.

### Try it without going live (simulator)
* **Chat:** in the control panel (**3 · Simulator**), type a comment and click **💬 Send comment**, or click **▶ Chat demo (5 comments)**. Mira answers them one by one and skips the spam one.
* **Voice test:** in **6 · Voice & prophecy**, click **🔊 Mira says it**.
* In the control panel, click **▶ Run 3-viewer demo**. Three fake viewers submit the form, send gifts (Rose, Doughnut, Hand Hearts) and comment their codes. Watch the overlay in another tab: **http://localhost:3000/overlay**.
* Or open a second Command Prompt in the folder and run `npm run simulate` (or `npm run simulate -- 6` for 6 viewers).
* Or do it by hand: **Make demo form entry**, pick a gift, then click **Send gift** and **Comment code**.

### Add the overlay to OBS
1. OBS → **Sources** → **+** → **Browser**.
2. URL: `http://localhost:3000/overlay` (vertical) or `http://localhost:3000/overlay?layout=landscape`.
3. Width/Height: **1080 × 1920** for vertical (or 1920 × 1080 for landscape).
4. Tick **Control audio via OBS**. **This is needed for Mira's voice.** Then, in OBS's Audio Mixer, make sure the "Browser" source isn't muted (⚙ → Advanced Audio Properties → Audio Monitoring: "Monitor and Output" if you also want to hear her).
4b. Leave **Shutdown source when not visible** unticked, so she keeps her place in the queue.
5. Right-click the source → **Interact** → press **C** to open the overlay settings (layout, voice on/off, chime, queue, test reveal and test talk, plus live video diagnostics).
6. Open the overlay in **only one** place with sound (OBS), so her voice doesn't play twice. If you also open it in a Chrome tab, untick "Play Mira's voice" there (press C).

### TikTok LIVE Studio
Add a source → **Link / Browser source** (the name varies by version) → paste the overlay URL and set the size to **1080 × 1920**. If your LIVE Studio version has no browser source, stream from OBS instead (window capture or virtual camera). Go live only from LIVE Studio — don't stream to TikTok with a stream key from another tool.

#### If the overlay goes black or reloads in LIVE Studio
Use **`https://your-app.onrender.com/overlay?primary=1`** (no key needed) as the Link / Browser source, at 1080 × 1920.
* `primary=1` makes this window Mira's only voice. If the overlay is also open somewhere else, such as a phone preview or a second tab, that copy stays silent but still animates. Without `primary=1`, a desktop window takes priority over a phone, and the window opened first wins.
* Android phones, devices that report 4 GB of memory or less, and any browser that had a WebGL reset in the last 24 hours get a lighter WebGL version automatically. (`lite=1` and iPhones / iPads get phone mode instead; see below.) This lighter version: Mira stays at her painting's full resolution (941 × 1672, so she stays sharp) and runs at 24 fps. It drops the sparkles, smoke and 1080p video, uses a plain background and fewer full-screen layers, and frees the picture copies once they are uploaded. Total canvas is about 2.7 MP on an iPhone. Phones, devices that report 4 GB of memory or less, and any browser that had a WebGL reset in the last 24 hours switch to it automatically. Use `lite=0` to force full quality.
* The rig draws at most 30 fps (`fps=` to change it) and never at more pixels than her painting has (941 × 1672).
* If the GPU resets, Mira's still picture shows at once and the rig rebuilds itself when the browser restores WebGL. If WebGL doesn't come back within 4 s, the overlay stays on the still picture instead of going black.
* **Phone mode (iPhone / iPad, any iOS browser, `lite=1`, `mode=phone`)** has no WebGL at all. iOS Safari closed the tab ("A problem repeatedly occurred") even with the lighter WebGL rig. Phone mode works like the fight game, which runs fine on the same phones. Mira is one 2D canvas sized to the screen's real pixels, never more than 780 × 1387. She is drawn from small baked sprites in `public/assets/phone/v1|v2/`: a 780 px room/table picture, her upper body (which breathes, sways and bows about her hips) and small eyelid and mouth patches for blinks and lip sync. That is about 10 MB of decoded pictures plus the canvas. There are no glows, smoke, mist, sparkles, background video, blur, backdrop or blend-mode layers, and no TikFinity socket. She still lip-syncs to the voice and bows on greetings and gifts (the old character too). `phone=0` turns it off and `phone=1` forces it. Rebuild the sprites with `node tools/build-phone-sprites.mjs && python tools/build-phone-sprites.py` (server running).
* **Diagnostics:** the overlay sends a small report to `/diag` every 30 s, when it is hidden or closed, and at start. The start report includes the previous session's last report if that session ended without closing normally, which probably means a crash. The report contains the mode, screen and canvas size, a decoded-picture estimate, DOM counts, the last events and errors. It never includes URLs, keys or names. Look for `[diag]` lines in the Render logs. `diag=0` turns it off.
* The page never reloads itself. If it still reloads, it's LIVE Studio restarting a crashed browser source, so try `lite=1`.
* Check it with `npm run soak` (`tools/soak.mjs`: 15 min of simulated LIVE events while it logs memory, GPU process size, blobs, sockets, context losses and reloads).

### Direct mode: read the LIVE from the server (no TikFinity, works from a phone)

Set `TIKTOK_USERNAME` (Render → Environment) or type the username in **1 · LIVE events** in the control panel, then pick **Direct**. The server:
* connects by itself when the account goes LIVE, checking every 45 s while it is offline (`tiktok.retrySeconds`);
* reconnects 10 s after a dropped connection, and waits for the next LIVE after one ends;
* shows `connected / waiting / error` with the exact reason in the control panel and the Render logs (`[tiktok] direct @user: ...`).

If TikTok starts blocking unsigned connections (errors about signatures, captcha or 403), get a free key from eulerstream.com and set `SIGN_API_KEY`. Choose the source with `LIVE_SOURCE` = `direct`, `tikfinity` or `both` (with both, duplicates are counted once and likes come only from the direct connection).

**Render free plan:** the server sleeps after 15 minutes without HTTP requests, and a sleeping server can't read the LIVE. While the overlay page is open (in LIVE Studio, OBS or a phone browser) it pings `/healthz` every 4 minutes and keeps the server awake, so the direct connection keeps working. Open the overlay a minute before you go LIVE so the server is awake when the LIVE starts.

### Or connect TikFinity (optional)
With the TikFinity source, the server doesn't connect to TikTok. The overlay, running on your streaming PC, reads live events from the **TikFinity desktop app**.

1. Install the TikFinity **desktop app** from <https://tikfinity.zerody.one/> (the website alone is not enough).
2. Open it and connect by **username** — don't sign in with your TikTok password.
3. Go LIVE in TikTok LIVE Studio first, then click connect in TikFinity if it hasn't picked up the LIVE yet. Leave TikFinity open the whole time you stream.
4. Add the overlay as a Link source (see above). The control-panel badge turns green when the overlay can hear TikFinity.
5. Like or comment from your phone. If Mira reacts, everything works. If not, right-click the Link source and refresh it.
6. Click **Reset counters** in the control panel when you start a new LIVE (per-viewer reading counts reset).

Keep only one overlay running (LIVE Studio or a browser tab, not both with the same events), or gifts and comments will fire twice. The control-panel simulator still works without TikFinity, for testing Mira without going live.

Override the TikFinity address with `?tikfinity=ws://host:port/` on the overlay URL if you ever need to.

---

## Predictions from comments (default)

Settings live in `config.json` → `readings` (or **4b · Predictions from comments** in the control panel):

| Setting | Default | Meaning |
|---|---|---|
| `fromComments` | `true` | A comment with a full birth date becomes a reading. Comments without a date get normal chat answers. |
| `requireGift` | `false` | `true` = the viewer must send the trigger gift first (their date comment waits up to `giftCreditMinutes`). |
| `perViewerPerStream` | `1` | Readings per viewer per LIVE. |
| `maxQueue` | `10` | Max free readings waiting (gifters always get in). |
| `giftPriority` | `true` | Gifters go first; a gift after the comment moves them up and upgrades the tier. |
| `howToEverySeconds` | `75` | How often Mira says "Comment your name and birth date for your prediction!" (0 = off). |
| `privateForm` | `false` | Turn the old private form + codes back on. While off, `/` is a simple landing page and the form/report URLs return 404. |

Dates: `12/05/1998`, `12-5-1998`, `12.05.98`, `12 May 1998`, `12th of May, 1998`, `May 12 1998`, `1998-05-12`. Numbers are read day/month/year; when the second number is over 12 it is read month/day (`05/25/1990`). With no name in the comment, Mira uses the TikTok display name. Parents: `mother Sara`, `mom Sara`, `ammi Sara`, `father Ali`, `dad Ali`, `abbu Ali`.

## Old flow: viewers reach the form (link in bio, only with `readings.privateForm: true`)

`localhost` only works on your PC. Viewers need a public address. Pick one option.

**Option A: free hosting on Render (stable link, recommended)**
1. Put this folder in a GitHub repository. The included `.gitignore` already excludes `node_modules` and viewer data.
2. On <https://render.com>, choose **New → Blueprint**, pick the repo (it reads `render.yaml`), or choose **New → Web Service** with build `npm install` and start `npm start`.
3. In **Environment**, set `ADMIN_KEY` to a long secret, plus optionally `PUBLIC_URL` (your Render URL).
4. Your links become:
   * Form, for your bio: `https://your-app.onrender.com/`
   * Overlay, for LIVE Studio / OBS: `https://your-app.onrender.com/overlay (no key needed)`
   * Control panel: `https://your-app.onrender.com/admin?key=YOUR_ADMIN_KEY`

   The overlay still runs in LIVE Studio on your PC, so it can hear TikFinity at `ws://127.0.0.1:21213/`. The Render server never connects to TikTok.
5. Free-plan notes: the app sleeps after about 15 minutes with no visitors (the first visit then takes about 30–60 s to wake it, so open the overlay before you go live). Its disk is temporary, so stored forms are lost on restart. That's fine with 24-hour retention. Railway (<https://railway.app>) works the same way.

**Option B: run on your PC and use a free tunnel**
* Install Cloudflare Tunnel (`winget install Cloudflare.cloudflared`) and run `cloudflared tunnel --url http://localhost:3000`. It prints an `https://….trycloudflare.com` link. Put that link in your bio.
* Quick tunnels get a new link every time you run them. For a fixed link use a named Cloudflare tunnel (free with a domain) or Option A.
* **Set an `adminKey` in `config.json` first.** Without one, the admin and overlay pages only work on your own PC, which is the safe default, but set one anyway when you expose the app.

**Put the link in your TikTok bio:** Profile → **Edit profile** → **Website**. TikTok only shows the website field on some accounts (often 1,000+ followers or business accounts). If you don't have it, pin a comment during the LIVE, say the link out loud, use a short link (e.g. bit.ly) shown on the overlay (`"callToAction"` in `config.json`), or use a link-in-bio service linked from your Instagram.

---

## Limits and settings (`config.json`)

Change these in the control panel (**4 · Limits & triggers**; they apply immediately) or edit `config.json` and restart.

| Setting | Default | Meaning |
|---|---|---|
| `trigger.giftName` | `Rose` | The gift that unlocks a reading. |
| `trigger.minDiamonds` | `1` | Minimum coins the gift (or streak) must be worth. |
| `trigger.acceptOtherGifts` | `true` | Also accept any other gift worth at least the minimum. Set `false` to accept only the named gift. |
| `tiers` | 1 / 30 / 100 coins | Bigger gifts unlock longer readings: **Short** (Life Path + 2026 year, 20 s), **Extended** (adds Soul Urge + answer to their question, 30 s), **Destiny scroll** (adds Destiny + Maturity, 45 s). Edit coins, names and seconds freely. |
| `limits.readingsPerUserPerStream` | `1` | Readings each viewer can get per LIVE. |
| `limits.usesPerCode` | `1` | How many times a code can be shown. |
| `limits.maxQueueLength` | `30` | When the queue is full, new people get a "try again later" message. |
| `limits.giftCreditMinutes` | `10` | How long a gift stays valid while waiting for their code (works both ways: gift first or code first). |
| `limits.secondsBetweenReadings` | `3` | Pause between readings. |
| `limits.maxSubmissionsPerIpPerHour` | `10` | Anti-spam on the form. |
| `data.retentionHours` | `24` | Form data is auto-deleted after this. |
| `data.maxRetentionHoursIfUserOptsOut` | `168` | Used when a viewer unticks "auto-delete after 24h". |
| `overlay.character.*` | | `mode` (`video` or `still`), `video` (`src`, `src720`, `quality`: `auto`/`1080`/`720`, `track`, `poster`, `toneMatch`), `still` (picture), `breathing` (`enabled`, `amount`, `seconds`), `mouth` (`enabled`, `leadMs`, `fadeMs`), and the **prophecy** reveal (`enabled`, which `tiers` use it, `voiceOffset` = seconds before she starts speaking). Positions of the ball, candles, lanterns, incense and skull eyes can be overridden (in % of the picture). |
| `overlay.*` | | Title, call-to-action line, effects (sparkles, ball glow), queue, hearts, follow messages, chat bubble, browser-voice fallback. |
| `voice.*` | | Server voice on/off, `voice`, `urduVoice`, `hindiVoice`, `rate` (default `+2%`), `pitch` (default `+6%`). |
| `chat.*` | | Chat replies on/off, `mode`, cooldowns, queue size, comment age, idle questions, greetings. |
| `llm.*` | | Optional AI replies: `enabled`, `baseUrl`, `apiKey`, `model`, `temperature`, `maxTokens`, `timeoutMs`, `extraPersona` (extra instructions for her character). |
| `adminKey` | empty | Password for `/overlay` and `/admin` when hosted online. Empty means this PC only. |

Gift streaks are added up: 30 Roses in a streak count as 30 coins and unlock the Extended reading.

---

### Phone layout (9:16, default)

The overlay is 1080×1920 (9:16) and grows taller on taller screens. It is built for how TikTok shows it on an iPhone: the 1080×1920 picture is cropped about 96 px on each side, TikTok's own bar covers the top ~14%, and comments and join messages cover the left ~70% from ~32% down to ~88%, with the input bar at the bottom. So:
* the title and the compact how-to box sit at 14–26%; during a reading, a card with the name, date, question and numbers replaces them;
* Mira is zoomed in, with her face at about 28–42%;
* her words show just under her face (43–55%), above most of the comments;
* the queue and gift messages are in the right column, where comments don't reach, and the disclaimer is a tiny vertical line on the right edge.

`SERVERS="before=http://localhost:3124,after=http://localhost:3123" node tools/layout-check.mjs` renders idle / reading / reply, crops them like an iPhone, draws TikTok's UI on top, reports overlaps and writes `screenshots/layout-phone-v2.png`.

## Mira: animation, voice and chat

### How she is animated (files in `public/assets/`)
**Live 2D rig (default, `overlay.character.mode: "rig"`).** Her own painting is turned into a real-time puppet that runs in the overlay with WebGL (`public/rig.js`), so she moves all the time and reacts to the chat. Nothing is a video loop and nothing is pasted on top of her face.

| File (`public/assets/rig/`) | Used for |
|---|---|
| `char-alpha.png` | Her silhouette (anime matte from rembg `isnet-anime`, cleaned up). |
| `bg.jpg` | The room with her painted out. It only shows in the few pixels she uncovers when she moves, so there are never holes. |
| `weights.png` | Where each motion applies: head + hair, side hair (sways), fringe. |
| `face/eye*-lid1/lid2/closed/happy.png` | Eyelids painted in her style: two half-closed steps, closed, and happy "^ ^" eyes. |
| `face/eye*-white/inner/mask/band.png` | Eye whites, her iris and the lash line, so her eyes can glance around. |
| `face/mouth-*.png` | Mouth shapes made from her own lips: rest, smile, small, E/I, A, O, U and a happy open smile. |

Every frame, the eyes, mouth and blush are drawn into a small face canvas, then one shader warps the whole picture. The face canvas goes through the same warp, so the mouth and eyes move with her head and jaw. The motions are:
* breathing (chest and shoulders) and a slow body sway; the table, hands and crystal ball stay still
* head tilt, turn and nod, with the nose, eyes and mouth moving more than the outline (parallax)
* hair on springs that swing after head moves, plus a soft draft
* jaw drop with the mouth opening, and brows that lift
* blinking every 2–6 s (sometimes twice), glances, and a smile now and then

Body language: she **nods** when she welcomes people, **tilts her head and raises her brows** while she reads a question (before answering), **smiles with happy eyes and a blush** when she thanks someone for a gift or a follow, and looks down at the ball for readings.
The mouth shape comes from her voice: the MP3 is analysed 100 times per second for loudness (how open) and spectrum (which shape). Low, dark vowels give O/U, bright ones and "s/sh" give E/I (teeth), open vowels give A, and silence closes the mouth. Rebuild the rig after changing the art with `python tools/build-rig.py` (needs `opencv-python-headless`, `numpy`, `pillow`, `rembg`).
If WebGL is not available, the overlay falls back to the still picture by itself.

**Mira v2, "Tarot Mistress" (preview, not the default).** Open the overlay with `?char=v2` (for example `/overlay?char=v2&key=YOUR_KEY`), or set `overlay.character.char: "v2"` in `config.json`. Without it, the original painting rig above is used. v2 is a new character drawn for animation, with rose-silver hair in a side ponytail, a plum hooded mantle and a tarot-card charm. Her rig is layered rather than one painting (`public/assets/rig-v2/`, built by `tools/build-rig-v2.py` from `src/char.png`, `src/room.jpg` and `src/table.png`):

| File (`public/assets/rig-v2/`) | Used for |
|---|---|
| `room.jpg` | The empty room behind her (static). |
| `body.png` | Her body and head, with the ponytail and charm cut out and the cloth under them painted in. |
| `tail.png`, `charm.png` | The ponytail (hanging from the ribbon) and the chain + tarot card, each a separate layer. The ponytail is a 2-link spring chain pinned to the ribbon knot. The charm is a pendulum pinned to the belt. |
| `table.png` | The velvet table, cards and crystal ball in front of her (static). |
| `weights.png` | Head + side hair (R), side-hair sway (G), fringe (B), body breathing/bow (A). |
| `face/eye*-…png` | Gaze (whites, iris, lash band), blink steps `lid1`/`lid2`/`closed`, and happy eyes. |
| `face/mouth-*.png` | Visemes from her own lips: rest, M/B/P, smile, small, I, E, F/V, A, O, U, happy. |
| `parts/` | Every part as a full-frame transparent layer (and `face-base.png` with the mouth painted out), for editing. |
| `rig.json` | All coordinates the renderer uses: face, eyes, mouth, pivots, brows, jaw, layer rects and anchors, crystal ball. |

Lip sync uses the same voice analysis with three extra shapes. **I** is a bright vowel with a narrow opening. **F/V** is a soft hiss with a small opening. **M/B/P** is a short stop between two voiced sounds, so the lips press together. The old rig, which has no drawings for these shapes, shows E / small / closed instead. Gestures: she gives a small **bow with a head tilt and a smile** when she greets someone, a **deeper bow with happy eyes** when she thanks someone for a gift, and a **listening tilt with raised brows** for questions. Her hands rest behind the table, so there are no arm or hand poses. She uses the same lite mode and context-loss handling as the old rig. On a phone the canvas is 1080x1920 (2 MP). A demo is in `screenshots/mira-v2-demo.mp4` (`node tools/render-v2-demo.mjs`).

**Video mode.** A generated idle clip of Mira (breathing, blinking, candles, crystal ball, smoke, mouth closed) loops underneath, and the lip-sync mouth is laid on top of her face and follows it frame by frame.

| File | Used for |
|---|---|
| `mira2-idle-loop-1080.mp4` (6.9 MB), `mira2-idle-loop-720.mp4` (3.6 MB) | The idle loop, 13.5 s, 24 fps, H.264. The source clip has a slow camera push-in, so its end never matches its start. It is turned into an eased ping-pong (forward, then backward, slowing to a stop at each turn), so there is no jump. `quality: auto` picks 720p when the overlay is drawn small (landscape, small browser sources). |
| `mira2-idle-loop.track.json` | For every loop frame: where her mouth is (position, scale, a tiny rotation), where the skull is, the camera move, and the skin brightness. Measured with sub-pixel image registration on the lips, nostrils and chin line. |
| `mira2v-mouth-o/e/a.png` | Mouth shapes cut against the video's first frame and colour-matched to it. |
| `mira2v-mouth-x.png` | The first frame's own closed lips. While she speaks, it sits under the open shapes, so her lips keep one shape for the whole sentence. |
| `mira2v-poster.jpg` | The first video frame, shown until the video starts (identical, so there's no jump). |

How it lines up: the overlay reads which video frame is on screen (`requestVideoFrameCallback`, or `currentTime` as a fallback) and moves the mouth patch with that frame's transform, plus a brightness match. In silence the patch is invisible, so you see the video's own closed mouth. While she speaks, the open shapes come from her voice (below). The skull's glowing eyes, mist and aura follow the skull track. The crystal-ball glow follows the camera.

**Still mode (fallback).** Set **Mira animation → Still picture** in the control panel (`overlay.character.mode: "still"`). It uses `mira2.jpg` and `mira2-mouth-o/e/a.png` with code-driven breathing, candle and lantern flicker, a crystal-ball swirl, incense smoke and sparkles. If the video or its track can't load, the overlay switches to still mode by itself.

Both modes:
* **Lip sync from the real voice.** The overlay downloads each MP3 once, decodes it, and measures loudness 100 times per second (`public/lipsync.js`). Quiet = mouth closed, louder = O, then E, then the wide A; "s/sh" sounds show teeth (E). A silence gate closes the mouth within ~40 ms in every pause, and each shape is held at least 50 ms so it never flickers. Shapes crossfade in 45 ms. The mouth follows the audio's own playback clock. `overlay.character.mouth.leadMs` (default 30) shows each shape slightly early, which looks natural.
* **Prophecy reveal** (readings): a purple flash, the room dims around the skull, its eye sockets pulse with purple light, mist rises from them, and the crystal ball blazes.
* Rebuild the assets if the art changes: `python tools/build-video-hybrid.py <folder with idle-v2.mp4 and mouth-*.jpg>` (video mode) and `python tools/build-mouth-patches.py <folder>` (still mode).

### Her voice
* The default is **free**, using Microsoft Edge's online neural voices (the `msedge-tts` package). Internet is required.
* Change the voice, speed and pitch in **6 · Voice & prophecy**. She is meant to sound like a bright 20-year-old woman (not a child). Tested choices: `en-US-AvaNeural` +2% / +6% (default), `en-US-EmmaNeural` +4% / +8%, `en-US-JennyNeural` +3% / +10%, `en-US-AriaNeural` +2% / +5%. Child voices (`en-US-AnaNeural`, `en-GB-MaisieNeural`) were removed from the list. Replies written in Urdu script automatically use `ur-PK-UzmaNeural`, and Hindi script uses `hi-IN-SwaraNeural`.
* If the voice service fails, the overlay uses the browser voice. If that doesn't work either, it just shows the subtitles. The show never stops.
* There's about a 1–2 second pause before each reply while the voice is generated.

### Chat replies (5 · Mira: chat replies)
* **One by one, in order.** Readings come first, then thank-yous for gifters and new followers (grouped, at most one every `greetCooldownSeconds`), then comments. A gifter who comments their code within `greetDelaySeconds` gets their reading instead of a thank-you.
* **Who she replies to:** everyone, followers only, gifters only, or followers or gifters.
* **Skipped automatically:** links, swear words (English and Urdu/Hindi), emoji-only, repeated spam, shouting, comments older than `maxCommentAgeSeconds`, anyone still in their `userCooldownSeconds`, and new comments when `maxQueue` is full.
* **Quiet chat:** after `idlePromptSeconds` with nothing happening, she asks the audience something (for example, to comment their birth day and month). Add your own questions in the box.
* Viewers who comment a birth day and month (for example "14 March" or "14/3/1996") get their Birthday number and Personal Year 2026 spoken back. With a year, they also get their Life Path number. She never asks for private details in public and points people to the private form.

### Optional AI replies (any OpenAI-compatible API)
Without a key, Mira uses her built-in reply engine, which is free, offline and doesn't repeat itself much. To give her fresh, smarter replies in any language:
1. Get an API key from a provider, for example xAI (`https://api.x.ai/v1`), OpenAI (`https://api.openai.com/v1`), OpenRouter (`https://openrouter.ai/api/v1`) or Groq (`https://api.groq.com/openai/v1`).
2. In the control panel → **7 · AI replies**: tick **Use AI replies**, pick the provider preset, type the model name from your provider's model list, paste the key, click **Test AI reply**, then **Save limits**.
   On Render/Railway you can instead set the environment variables `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`.
3. Her persona is built in: a warm, playful, mysterious fortune-teller who keeps it to 1–3 short sentences, says it's all for entertainment, never asks for private details in chat, politely refuses hateful or sexual requests, and answers in the viewer's language. If the AI fails or is slow (over 8 s), she uses the built-in replies.

**Cost note:** each reply is one small request (about 300 input + 60 output tokens). With a small or cheap model, 1,000 replies usually cost well under US $1. Check your provider's prices. A busy LIVE where she replies every ~8 seconds is about 450 replies per hour. The voice is free.

## How the numbers are calculated (Pythagorean)

* Letters: A J S = 1, B K T = 2, C L U = 3, D M V = 4, E N W = 5, F O X = 6, G P Y = 7, H Q Z = 8, I R = 9. Accents are removed.
* **Life Path:** month, day and year are each reduced, then added and reduced. 11, 22 and 33 are kept. Example: 14 May 1990 → 5 + 5 + 1 = **11**.
* **Expression/Destiny:** every letter of the full birth name. Each name is reduced separately, then the results are added (the traditional method).
* **Soul Urge:** vowels only (A E I O U, and Y when it has no vowel next to it, as in "Lynn" or "Mary"). **Personality:** consonants only.
* **Birthday:** the day of birth (11 and 22 kept). **Maturity:** Life Path + Expression.
* **Personal Year 2026:** birth month + birth day + 2026 (2+0+2+6), reduced to 1–9.
* **Family influence:** the Expression number of the mother's and father's names.
* An optional question is matched to a topic (love, career, money, health, travel, family, study, general) and answered with fixed guidance for their Personal Year.

Run the tests: `npm test` (71 tests, including the direct TikTok connection (mocked): connect, retry while offline, reconnect, de-duplication with TikFinity, including TikFinity event ingest: video track, video files and fallback, number calculations, every possible birth date, every meaning present, gift and code matching, limits, the reading queue, comment filters, chat queue order, cooldowns and modes, the reply engine, the AI fallback, voice fallback, idle questions, and lip sync: mouth shut in silences, open while speaking, no flicker, same result for quiet and loud audio, text fallback, patch sizes).

---

## Privacy

* Viewers never type personal details in public comments. Only the code is posted, and the overlay shows only their **first name**, TikTok handle, numbers and a short reading.
* Consent checkbox, data used only for the reading, auto-delete after 24 h (or the viewer's own "Delete now" button), and "Delete ALL viewer data" in the control panel.
* Report links are long random secrets, so the code alone can't open a report.
* Data is a simple JSON file at `data/submissions.json`.

## Good to know / limitations

* Live events come only from the TikFinity desktop app on the streaming PC. This app never opens a server-side TikTok connection (that kind of traffic is a common cause of "suspicious activity" warnings). Connect TikFinity by username, not with your TikTok password.
* TikTok does not always send every like on big streams. TikFinity only connects once the account is actually live, so start the stream first, then click connect if it doesn't pick up.
* Mira's voice uses Microsoft Edge's free online "Read Aloud" voices through the unofficial `msedge-tts` package. Microsoft could limit or change it. If that happens, the overlay falls back to the browser voice or subtitles only.
* Lip sync follows loudness, not exact phonemes, so an "m" or "b" may not close the lips perfectly. The mouth patches are small (about 90 px wide at 1080×1920).
* Video mode: the talking mouth is a patch from the mouth pictures, not generated video, so her jaw and cheeks don't move while she talks. The idle loop runs backward half the time. Blinks look the same either way, but the incense smoke drifts down during the backward half. There can be a one-frame sharpness flicker where the video loops. Chrome's `loop` may also pause for one frame at the wrap.
* With thousands of viewers she can't answer everyone. She answers one at a time and skips old comments, so use **followers only** or **gifters only** on very busy LIVEs.
* In a normal Chrome tab, Chrome blocks sound until you click the page once (a "Click once to enable Mira's voice" button appears). OBS has no such limit.
* TikTok's rules on fortune-telling and gifting can change. Keep the "for entertainment" labels visible and don't promise real predictions.
