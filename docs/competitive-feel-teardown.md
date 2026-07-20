# Competitive feel teardown — Deadshot / Krunker / Venge / Shell Shockers

> **Purpose:** beat the top browser FPS titles on feel, crispness, and fun — no gimmicks.
> **Method:** four parallel web-research passes (2026-07-20): per-game player-discourse + parameter mining, native-benchmark source values, and load/perf practice measurement (including direct `curl` measurements of the live competitors' bundles and a deobfuscation pass on Deadshot's archived bundle).
> **Confidence legend:** **[S]** sourced (URL given) · **[M]** measured directly by us 2026-07-20 · **[I]** inferred/derived — flagged as such · **[NF]** not findable, do not treat as known.
> **Hard constraints shaping recommendations:** WebGL2 is the PRIMARY path; audience runs $250 school Chromebooks (UHD 600-class, 4 GB RAM); sub-3-second load; 60 fps on that hardware.

---

## 1. Deadshot.io — the current bar

Solo dev (Mathew Matakovic, "GoalieSave25"), custom JS engine on an inlined renamed **three.js r124** with Draco glTF — not Unity, despite portal claims **[M]** (decoded from the archived `final.js` bundle; also [webgamer.io](https://webgamer.io/en/g/deadshot-io)). ~2M MAU claimed via his [YC profile](https://www.ycombinator.com/companies/digipals); ~1,600 CCU today ([webgamedb](https://webgamedb.com/games/deadshot.io)). Community lore: "made by a Krunker fan" [S] (r/IoGames).

### What "crisp hit registration" concretely is

- **Transport: plain WSS (TCP), msgpack-serialized, client-side message batching** — `new WebSocket(...)`, zero WebRTC **[M]** (bundle decode). Matchmaker at `wss://matchmaking.deadshot.io/ws`, per-region game servers. So the breakout hit-reg game is on the *same transport we ship*. Crispness is not UDP.
- **Simple 2-part hitboxes (head + body only)**, no limbs [S] ([fandom Classes/Mechanics](https://deadshot-io.fandom.com)). Initially generous ("hitboxes are enormous… positioning matters more than aim" — r/deadshot_io), collider shrunk Dec 2024. Predictable hitboxes = shots land where they look like they land.
- **State-based accuracy, not recoil patterns**: hipfire is random bloom (community-measured on-crosshair odds: AR ~1/10, SMG ~1/40, sniper ~1/6), but **ADS AR = ~100% exactly-on-crosshair** [S] (fandom, community-tested). Dispersion modifiers are discrete states: ADS/crouch = major decrease, airborne = major increase, sliding = minor increase. "Crisp" = *when you do the right thing, the bullet goes exactly where the crosshair is.* No spray memorization.
- **Server-side hit validation** (changelog patches "Improved Hitreg" Jun 2023, "Improved Hit Detection" Dec 2023, "Shrunk Player Collider" Dec 2024, "Upgraded to Dedicated Servers" Jan 2025 [S] [changelog](https://deadshot.io/changelog.html)). Tickrate/interp/lag-comp values: **[NF]** — nobody has published them; no dev writeup exists.
- **One-request load**: the entire bootstrap is a single inline script — 1.18 MB HTML, **~340 KB over the wire**, zero external game scripts **[M]**. One request = playable shell; assets stream at runtime. This is the fastest first-play in the genre and part of why it *feels* instant/native.

### The "competitive movement tech" (named, with nerf history)

All from the community wiki + changelog [S]:

| Tech | Mechanics | Numbers |
|---|---|---|
| **Slide/dash** (Shift) | ground boost, momentum conserved into jump | cooldown ≈1 s from slide-anim end; slide-jump ≈ 2× walk speed; cancels on ≥30° wall hit |
| **D-bhop** | chained dash-jumps, cooldown resets "on the 2nd footstep" after landing | rhythm-timed by footstep audio |
| **Air strafing** (dev-added Feb 2023) | input + camera rotation rotates airborne momentum | rotation capped at 90° from input vector; A/D override W/S |
| **Shotgun jump** (Aug 2023) | shoot ≥45° downward with upward velocity → vertical boost | scales with look angle + upward velocity, not ground proximity |
| **Walldash** | dash into ~90° wall → immobilize → boosted redirect jump | "slightly faster than a full-speed jump"; wiki: "no one currently uses it" |

Wiki's own meta-verdict: movement mastery "noticeably rises the skill ceiling, while only being a light disadvantage for those who don't master it" — **that asymmetry is the design lesson**, not any specific move.

### Player verdicts

- Praise: "executed in a way that is so satisfying… **It's fun to simply move in this game**" ([r/gamereviews](https://reddit.com/r/gamereviews/comments/1eiftbn/)); guest-playable incl. private lobbies; recommended in r/KrunkerIO as Krunker's successor.
- Complaints: oversized hitboxes → "a game of who sees who first"; **movement nerfs drove away movement players** ("this was nerfed and it's one of the reasons i stopped playing" — shotgun-fly nerf, r/deadshot_io); shotgun/sniper cheaters; **Ranked launched Sep 2024, killed Nov 2024** ("negatively impacting playercounts and matchmaking… will not be coming back").

### Other parameters

Damage (community-tested, fandom, possibly stale): AR 28 head/14 body ×30 mag @6.5/s; SMG 24/12 ×40 @8.67/s; sniper 100/80 (1-tap head), sniper *players* get 85 HP; shotgun 13 pellets ×16/8. Headshot = 2× body. **Derived TTK [I]:** AR head ≈ 0.46 s, AR body ≈ 1.08 s, SMG head ≈ 0.46 s, shotgun point-blank 1-shot. FOV slider: none found (three.js default 50 + runtime `extraFOV`) **[NF]**; sensitivity = linear slider + zoom multiplier + **raw mouse input toggle**. SBMM added Nov 2023.

---

## 2. Krunker.io

Custom layer over **three.js** [S] ([HN](https://news.ycombinator.com/item?id=21580747)); Node/Go backend; sold to FRVR (~$40M reported). Entry module is a **2.3 KB wire** Vite loader; everything else dynamic-imports **[M]**.

- **Server tick ~10 Hz historically** [S-weak] (ioground history blog, now offline — treat as weakly sourced). In-game knobs confirm the low baseline: "High Send-Rate / HIGH TICKRATE" toggle ("Improves Hitreg… uses more Bandwidth"), *Network Rate (Hz)* setting, *Lag Compensation* slider, "Optimized Networking" toggle [S] ([Settings wiki](https://krunkerio.fandom.com/wiki/Settings)). 13 server regions.
- **Hit reg is the permanent #1 complaint** on r/KrunkerIO (archived threads: "hello hit reg?", "10/10 hit reg" sarcasm, lowerbody-reg-on-headshot reports); patches still shipping netcode fixes years in (v3.9.6 "Improvements to Net-Code & Hitreg"). Players call "Optimized Networking" "a weak cover up… essentially a server-side frame cap". **The lesson: exposing netcode knobs to players buys distrust, not feel.**
- **Slidehopping** — the signature: jump → press crouch *just before landing* (closer to ground = faster) → slide **<0.5 s** → jump as you release crouch. Overstaying the slide spikes friction and bleeds speed. Originally FPS-dependent (high-FPS players went faster); **fixed to FPS-independent in v2.8.4** [S] ([Slidehopping wiki](https://krunkerio.fandom.com/wiki/Slidehopping)). Class-gated wall-jumps (Runner unlimited). It is simultaneously the retention engine of the comp scene and the #1 cited new-player wall.
- Parameters: **FOV default 100** (live `settings.txt`: `fov,100`), range 60–175; sens = raw multiplier 0.1–15 with separate X/Y/ADS. Class speed multipliers 0.95–1.1. AR: 23 body/34.5 head @130 ms ROF → **TTK ≈ 0.52 s body / 0.26 s head [I]**; headshot mult 1.5× (1.25× shotgun); AR has "virtually non-existent recoil" → spread-based, no patterns [I from wiki descriptions].
- Durable: **map editor + custom games** (most-cited longevity driver), slidehop ceiling, instant load. Gimmick: **KR economy** — paid loot-wheel spins, marketplace with 10% tax, crypto purchases, third-party skin gambling ("walks right up to that line" — parent-facing review). Anti-cheat outsourced to community reports (KPD), widely hated.

---

## 3. Venge.io

**PlayCanvas** engine, 2-programmer Turkish studio (ONRUSH / Cem Demir), published by Poki, Overwatch/Paladins-inspired [S] ([Poki interview](https://medium.com/poki/meet-onrush-studio-3053ba5be600)). **Measured [M]:** engine 530 KB wire + 247 KB ammo.wasm; manifest lists 3,400 assets / 554 MB on CDN but only **94 files = 11.7 MB flagged `preload:true`**; `antialias` off unless opted in; `deviceTypes: ['webgl2','webgl1']`; `powerPreference: "high-performance"`.

- Depth lives in **hero abilities + card imbues** (4 heroes; grenade 25–125 AoE cd 10 s, grappling hook cd 5 s, dash on Shin), not movement physics. No slidehop/bhop tech documented.
- Only one full weapon stat block public (Sniper: 95 dmg body / 100 head instakill, 2.2 s reload, spread 120 hip / 7 focused). Recoil modeled as `Recoil Rate` + `Spread` params → **bloom, not pattern [I]**.
- Netcode: **[NF]** — no transport/tickrate/lag-comp statement anywhere; WebSocket inferred (Node.js + WebSockets confirmed for the studio's stack generally).
- Complaints: matchmaking, team identification ("hard to tell which team a character is on"), connectivity bugs. Cheater response = shadow-banning. Its audience discourse is skins/memes, not competitive integrity — a casual-lane game. **Lesson: abilities/cards are a retention system, not a feel system; nothing there to crib for gunfeel.**

---

## 4. Shell Shockers

**Babylon.js** (not three.js) [S] ([gamediscover deep-dive](https://newsletter.gamediscover.co/p/deep-dive-shell-shockers-multi-million), Wikipedia). One ~**2.7 MB wire** bundle with Babylon compiled in **[M]**. 300–350k peak DAU, 200M+ lifetime players, **39% of players on Chromebooks**, mostly age 10–15 during school hours; alternate domains ship to beat school URL blocks; 80–90% ad revenue [S] (gamediscover).

- **Netcode is the honest floor of the genre**: WebSockets; 7 Vultr regions; dev FAQ says outright "there is unfortunately **no way for the game to compensate** for [lag spikes]" — **no lag compensation**; ping ≤100 ms recommended; high ping causes "blanks" (non-fatal sniper hits) [S] (shellshock.io/faq, [Servers wiki](https://shellshockers.fandom.com/wiki/Servers)). Tickrate **[NF]**.
- **All weapons are projectiles** — even the sniper (bullet velocity is a per-weapon stat: Crackshot 17, EggK 1.5 wiki-units). You lead everything.
- **No headshots — center-of-egg damage zone**: dead-center Crackshot = 180 dmg (1-shot through most overheal), edge hits as low as 60. A novel hitbox model that doubles as the brand.
- Movement: floaty, simple, uniform — Space jump, **Shift is ADS not crouch**; air-strafe dodging; no tech tree. Deliberately casual.
- Weapon stats are public and precise (fandom mirrors internal params): EggK 30 dmg/30 mag, Whipper 600 RPM, Free Ranger 101 dmg semi-sniper; **short-vs-long reload mechanic** (reloading with 1 round left is meaningfully faster).
- Complaints: aimbots (Free Ranger + aimbot = auto egg-center 1-shots; no systemic anti-cheat), school-Chromebook lag threads; FAQ's own answer is "close tabs, wired, closer server."
- Durable: the egg gag (school-safe violence: "it's eggs not people" — Kapalka), school-network distribution, 60 fps on "frankly very underpowered" Chromebooks. **Lesson: Chromebook 60 fps is an acquisition strategy, not a nice-to-have — 39% of a 200M-player game runs on them.**

---

## 5. Native benchmarks — the source values browser games crib

Strongest citations in this doc; Q3 values read directly from id's GitHub source.

### Netcode

| Game | Sim/tick | Interp delay | Lag comp / rewind | Notes |
|---|---|---|---|---|
| CS2 | 64 Hz hardcoded + **sub-tick input timestamps** | (CS:GO default `cl_interp_ratio 2` = 31.25 ms; 128-tick ratio-1 = 7.8 ms) | `sv_maxunlag` **1.0 s** | Sub-tick fixes *timing quantization*, not update rate [S] [Valve wiki](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) |
| Source lineage | 66.67 (15 ms) | **100 ms default lerp** ("always two valid snapshots") | rewind = `now − latency − client interp`, players only, 1 s history | The formula every implementation copies [S] Valve wiki, verbatim |
| Valorant | 128 Hz (7.8125 ms; server frame budget **2.34 ms**) | buffering Min 7.8 / Mod 23.4 / Max 39.1 ms | rewind capped vs high ping (value NF) | Peeker's advantage: baseline model ~141 ms, optimizations "shave ~40 ms (28%)", **in-game 40–70 ms**, pros called 80 ms "fair" [S] [Riot 128-tick](https://www.riotgames.com/en/news/valorants-128-tick-servers), [Riot netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode) |
| Overwatch | 62.5 Hz cmd frames (16 ms) | ~20 ms after 2016 high-bandwidth update (was ~60) | favor-the-shooter rewind capped **250 ms** | GDC 2017 Tim Ford [S] |
| Apex | **20 Hz** ("50 ms world sim"), ~60 kB/s/client | — | value NF | Respawn's own math: 60 Hz = "triple the bandwidth… to save two frames" [S] [EA deep dive](https://www.ea.com/en/games/apex-legends/apex-legends/news/servers-netcode-developer-deep-dive) |
| QuakeWorld | 77 fps physics | — | — | Carmack Aug 1996: client prediction origin [S] [.plan](https://fabiensanglard.net/quakeSource/johnc-log.aug.htm) |

### Movement (Quake 3 from source; CS from cvar docs)

| Constant | Q3 (id GitHub, verbatim) | CS:GO/CS2 |
|---|---|---|
| Ground speed | `g_speed 320` u/s | 250 u/s (knife); AK 215; AWP 200 |
| Friction | `pm_friction 6.0` | `sv_friction 5.2` |
| Ground accel | `pm_accelerate 10.0` | `sv_accelerate 5.5` |
| Air accel | `pm_airaccelerate 1.0` | `sv_airaccelerate 12` + **`sv_air_max_wishspeed 30`** |
| Jump velocity | `JUMP_VELOCITY 270` | — |
| Gravity | `g_gravity 800` | 800 |
| Step | `STEPSIZE 18`, `OVERCLIP 1.001` | — |
| Stop speed | `pm_stopspeed 100` | — |
| Mouse | `m_yaw 0.022`°/count (cl_main.c:2330) | same 0.022 lineage |

- **The strafe-jump trick, precisely:** `PM_Accelerate` caps only the *projection* of velocity onto wishdir (`addspeed = wishspeed − v·wishdir`) — angling wishdir off velocity keeps adding speed past the cap [S] ([dimit.me](https://dimit.me/blog/2017/08/08/defrag-strafe-theory/), [adrianb.io](https://adrianb.io/2015/02/14/bunnyhop.html)). CS air gain at 64-tick = 12 × 250 × 0.015625 = **30 u/tick**.
- **CPM(A) air feel** (the "best-feeling air control ever shipped" claim rests on these): `airstopaccelerate 2.5`, `strafeaccelerate 70` (A/D-only), `maxairstrafespeed 30`, `aircontrol 150` (W/S-only turning) [S] verbatim in [Xonotic's CPM physics config](https://github.com/xonotic/xonotic-data.pk3dir/blob/master/physicsXDF.cfg); CPMA's own binary **[I]** same values.
- **Why 0.022°/count:** no primary rationale exists **[NF]** — it's id's original constant and everyone cloned it. Use it anyway: every FPS player's muscle memory is calibrated in it.
- TTK reference points: AK one-tap head vs helmet at all ranges (~109 dmg); Vandal **160 head, zero falloff**; Apex fastest gun ≈ 0.97 s — the two design poles (positioning-decides vs tracking-decides). FOV: CS2 locked 90, Valorant locked 103, Apex slider to 110.

---

## 6. Load & performance practices (measured + platform docs)

### Measured competitor payloads [M] (curl, 2026-07-20)

| Game | First-play payload | Pattern |
|---|---|---|
| **Deadshot** | **~340 KB wire** (1.18 MB single inline-script HTML) | one request = playable shell; assets at runtime; **best in genre** |
| **Krunker** | 2.3 KB wire entry loader + dynamic chunks | menu first, maps/skydomes on demand (changelog logs "optimized initial load" repeatedly) |
| **Shell Shockers** | 2.70 MB wire monolith (Babylon compiled in) | one bundle + lazy maps/skins |
| **Venge** | ~10–12 MB (94 preload-flagged files of 3,400; 554 MB total on CDN) | manifest-driven preload flags; heaviest of the four |

### Platform requirements [S]

- **Poki** ([sdk.poki.com/new-requirements](https://sdk.poki.com/new-requirements)): initial download **< 8 MB**; external requests blocked by default (self-host everything); must run with ad blockers.
- **CrazyGames** ([docs.crazygames.com](https://docs.crazygames.com/requirements/technical/)): initial download ≤ 50 MB (≤ 20 MB for mobile homepage), time-to-gameplay ≤ 20 s, **"Chromebook support requires smooth performance on 4 GB RAM devices"**; their loading guide prescribes first-level-first + background-load, Brotli, compressed GPU textures, Vorbis mono audio.

### Chromebook-class reality (UHD 600 / Celeron N4020, 4 GB)

- Native titles manage ~30 fps at 720p low; only very light games hold 60 [S] ([pcgamebenchmark](https://www.pcgamebenchmark.com/gpu/intel-uhd-graphics-600)).
- Draw-call budget on browser WebGL: **~50–100/frame** is the realistic ceiling on this class [S] ([game-developers.org](https://game-developers.org/why-draw-calls-matter-the-hidden-performance-killer-every-game-developer-must-understand)); three.js guidance <100, instancing/merging takes 300+ → <20 [S] ([utsubo 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)).
- **[I synthesis]:** budget like low-end mobile — ≤100 draw calls, <100k on-screen tris, internal render ≤720p with upscale, fill-rate (not vertex count) is the wall. What shipped games do: antialias off by default (Venge, measured), resolution-scale sliders (Krunker), flat shading, few materials.
- GC: at 60 fps, a 50 ms GC pause = 3 dropped frames; 200 allocs/frame fills the young gen every ~2 s [S] ([dev.to GC writeup](https://dev.to/helloashish99/javascript-gc-pauses-allocation-rate-frontend-jank-3jig)). (Spec already mandates zero per-frame allocation + GC smoke — this is why.)
- KTX2/Basis: stays compressed in VRAM, ~10× smaller in GPU memory than PNG [S] ([Khronos KTX guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md)) — we already ship it (and already shipped the base-path bug; the CI guard from live-findings §KTX2 covers the class).

### Transport reality for the school audience

- **Every competitor ships plain WSS over 443** — confirmed for Shell Shockers (FAQ) and Deadshot (bundle decode), strongly inferred for Krunker/Venge. None use WebRTC.
- UDP is commonly blocked on school/enterprise networks; WebRTC fails after a "successful" handshake there, and the fallback (TURN over TCP/443) puts you back on TCP anyway [S] ([addpipe](https://blog.addpipe.com/troubleshooting-webrtc-connection-issues/), [rtcquickstart](https://rtcquickstart.org/guide/multi/optimal-connectivity-firewalls.html)).
- WebTransport reached Baseline March 2026 (Safari 26.4) but QUIC/UDP is still blocked on exactly our audience's networks — **a WS path remains mandatory forever** [S] ([webrtc.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)). The spec's WS-first + evidence-gated-WT stance is exactly right; if 2b ever activates, WT is an *enhancement lane*, never the requirement.

---

## 7. Target parameters for gungame — match / beat table

"Beat" = a concrete, durable advantage no competitor ships. "Match" = genre table stakes. Spec refs point at SPEC.md §§.

| Parameter | Best competitor | Native reference | **Our target** | Verdict + reasoning |
|---|---|---|---|---|
| Server tick | Krunker ~10 Hz [S-weak]; others NF | CS2 64 / Valorant 128 / Apex 20 | **64 Hz** (§3.1 — already spec'd) | **BEAT, decisively.** 6× the genre incumbent. This alone, honestly shipped, out-crisps every competitor. 128 Hz buys nothing at our RTTs and costs 2× server CPU (Valve wiki: tickrate-100 ≈ 1.5× CPU of 66). |
| Sub-tick fire timing | none in genre | CS2 sub-tick | **`fireFraction` 8-bit** (§3.2 — spec'd) | **BEAT.** No browser FPS has it. This is the "flicks land where you clicked" receipt. |
| Lag compensation | Shell Shockers: **none** (dev-confirmed); others NF | Source 1 s / Overwatch 250 ms cap | **400 ms ring, 300 ms rewind clamp** (§3.2 — spec'd) | **BEAT.** Sits between Overwatch (250) and Source (1000); clamp degradation contract already tested. |
| Interp delay | NF genre-wide (Source-derived ~100 ms likely [I]) | Source 100 ms default; OW ~20 ms; Valorant 7.8–39 ms | **datagram 47 ms / WS 78 ms / ceiling 109 ms** (§3.2 — spec'd) | **BEAT** the 100 ms Source default everyone inherits. Do not chase Valorant's 7.8 ms — that needs 128 Hz + pristine networks our audience doesn't have. |
| Peeker's advantage | unmanaged genre-wide | Riot in-game 40–70 ms; 80 ms = "fair" per pros | **≤ 80 ms at 50 ms RTT** [I derived: our chain = RTT/2 + jitter buffer + interp]; measure in netsim, publish the number | **BEAT by measuring.** Nobody in the genre even states it. Add a netsim assertion + a HUD-visible honest number. |
| Transport | WSS everywhere | — | **WSS first, WT evidence-gated** (§3.2 — spec'd) | **MATCH.** School firewalls make WS the floor; competitors prove it's sufficient. Our one-slot backpressure policy is already ahead of genre practice. |
| Netcode knobs | Krunker exposes send-rate/lag-comp/"optimized networking" sliders → community distrust | consoles hide them | **Zero player-facing netcode knobs.** Perf HUD shows honest measurements instead | **BEAT via restraint.** Krunker's sliders are documented distrust-generators. Show truth (ping, tick, interp), sell no placebos. |
| Movement base | Deadshot slide-jump ≈ 2× walk; Krunker multipliers 0.95–1.1 | Q3 320 u/s ≈ 8 m/s; CS 250 u/s ≈ 4.8 m/s; Apex 7.4 m/s | **run 6.4 m/s** (spec'd); bhop chains open-ended (no cap, spec'd) | **MATCH speed, BEAT ceiling.** Real Q3 accelerate-projection math (spec'd) is deeper than Deadshot's 90°-capped momentum rotation and Krunker's timing-window slide. |
| Air control | Deadshot: rotate momentum ≤90° from input; Krunker slidehop | Q3 airaccel 1 + projection trick; CPM `strafeaccelerate 70`/`aircontrol 150`; CS airaccel 12 + wishspeed 30 | **airAccelerate 12 scoutz / 1.0 standard** (spec'd) — CS-style in scoutz, Q3-style base | **MATCH the source, BEAT the imitations.** Consider a CPM-style A/D-strafe accel dial in the Phase 1 playground; adopt only if it survives the feel gate. |
| Accessibility asymmetry | Deadshot wiki: mastery "rises the skill ceiling while only a light disadvantage" for non-masters | — | **80 ms jump-buffer** (spec'd), forgiving-not-auto; HUD speed readout | **MATCH the asymmetry principle.** It's the single best-articulated design idea in the genre discourse. Never nerf shipped movement tech (Deadshot's nerfs measurably shed its movement community). |
| Recoil model | Deadshot: state-based bloom, **ADS = 100% on-crosshair**; Krunker ~zero recoil; all bloom, no patterns | CS fixed patterns + inaccuracy; Valorant semi-fixed | **State-based accuracy, no spray patterns.** First shot from accurate states = exactly on crosshair. States: ADS/stationary accurate; airborne/sprint bloom | **MATCH Deadshot** (it's the right call for browser session lengths — pattern-learning is a 100-hour tax our audience won't pay). Scout zoom-accuracy model already spec'd fits this exactly. |
| Hitboxes | Deadshot 2-part head+body (shrunk once); Shell Shockers center-gradient egg | capsule + head standard | **Capsule + head sphere, 2× head multiplier, published sizes** | **MATCH simplicity, BEAT honesty**: render debug hitboxes in the dev panel; community-testable. Deadshot's arc (too big → shrunk) says start tight-ish; oversized hitboxes turn the game into "who sees first". |
| TTK band | Deadshot ~0.46 s head / 1.08 s body; Krunker 0.26–0.52 s | CS/Valorant 1-tap poles; Apex ~1 s pole | **Head-reward pole: ~0.3–0.5 s head, 0.8–1.2 s body** for autos; scout/Deadeye/Goldie = 1-tap tiers (spec'd) | **MATCH genre band.** Sub-0.3 s body TTK + generous hitboxes is what makes Deadshot "who sees first" — keep body TTK ≥0.8 s so movement matters, headshots decisive so aim matters. |
| FOV | Krunker default 100 (range 60–175); Deadshot none | CS 90 locked / Val 103 / Apex ≤110 | **Default 100, range 90–120** (spec range kept; default set) | **MATCH.** 120+ costs fill-rate on UHD 600; 175 (Krunker) is a fisheye gimmick. |
| Sensitivity | linear multipliers everywhere | 0.022°/count universal | **cm/360 first-class** (spec'd) **+ 0.022-based multiplier display** so Krunker/CS muscle memory transfers | **BEAT.** Nobody in the genre offers honest cm/360. Import path: "enter your Krunker sens" converter in settings. |
| Input pipeline | Deadshot has raw-input toggle; others basic | raw input default in Val/OW | **Pointer Lock `unadjustedMovement`, `pointerrawupdate`, zero smoothing** (spec'd + native-feel.md) | **BEAT.** Click-to-photon ≤35 ms budget in the HUD is beyond anything in the genre. |
| First-play payload | **Deadshot ~340 KB wire**; Krunker ~KB-scale loader; Shell 2.7 MB; Venge 10–12 MB | — | **≤ 1.5 MB wire to first controllable frame; ≤ 3.0 s cold on school wifi** (tighten spec §4's <5 s / <3 MB) | **MATCH Deadshot's pattern** (playable shell in one request, stream the rest), accept we won't beat 340 KB with three.js (~150 KB gz alone [I]) — but sub-3 s is achievable: shell+sim first, map GLTF + audio streamed, KTX2, Brotli. |
| 60 fps on $250 Chromebook | Shell Shockers holds it (39% of its players); Deadshot/Krunker degrade gracefully | — | **≤ 100 draw calls (tighten spec's 150), <100k tris, internal-res auto-scale to 720p, AA off by default on weak GPUs, WebGL2 as the *verified* path** | **MATCH Shell Shockers.** Add a UHD-600-class device to the Phase 6 manual matrix — M1 Air is not the floor our audience owns. WebGL2 must be the primary tested path (constraint), WebGPU the bonus. |
| Server honesty | Shell Shockers admits no lag comp; Krunker community distrusts | Riot publishes numbers | **Publish our numbers**: tick, interp, rewind clamp, measured peeker's advantage in docs + HUD | **BEAT.** In a genre where the incumbents hide or lack netcode, verifiable honesty is a moat (and the MIT repo makes it credible). |

---

## 8. Fad / gimmick flags (do not copy)

| Thing | Where | Why it's not feel |
|---|---|---|
| Loot wheels / marketplace / crypto KR | Krunker | Gambling-adjacent, parent-hostile, zero feel contribution; our audience is Shell Shockers' audience (10–15, school). |
| Hero abilities + card imbues | Venge | Retention system, not gunfeel; adds netcode surface and balance debt; Venge's own discourse is skins, not play. |
| Player-facing netcode sliders | Krunker | Documented distrust generators ("weak cover up"). Fix the netcode; don't outsource it. |
| Premature ranked mode | Deadshot (killed after 2 months: "negatively impacting playercounts") | Splits a small population; not v1 material. Spec already excludes it. |
| Engagement-flavored SBMM | Deadshot (player-suspected) | Even the *suspicion* poisons trust. Quickplay + honest rooms. |
| FPS-dependent movement | Krunker pre-v2.8.4 | Physics bugs as skill expression; our fixed 64 Hz tick makes the class impossible — keep it that way. |
| FOV >130 | Krunker (to 175) | Fisheye novelty; fill-rate cost on our floor hardware. |
| Nerfing shipped movement tech | Deadshot shotgun-fly | Measurably sheds the movement community that evangelizes the game. Dial-tune, never remove (rocket-jump = spec'd feature, keep it sacred). |
| Netcode-free projectile "leading" as depth | Shell Shockers | It's charming there but is a consequence of having no lag comp; our A1 projectiles are server-simulated with prediction — the honest version. |

**Durable (steal freely):** movement-mastery asymmetry (Deadshot), simple state-based accuracy (Deadshot), one-request playable shell (Deadshot), map-editor-driven longevity (Krunker — post-v1), school-safe aesthetic + Chromebook 60 fps as acquisition (Shell Shockers), preload-flag manifest loading (Venge), audio-timed movement rhythm (Deadshot's footstep-timed d-bhop — our wind/footstep audio already points here).

## 9. Deltas this implies for SPEC.md (proposed, not applied)

1. **§4 cold load: < 5 s → < 3.0 s** to first controllable frame (school-wifi throttle profile), with an intermediate gate: playable shell (menu + input live) < 1.5 s. Bundle gate < 3 MB gz stays; add "critical path ≤ 1.5 MB wire".
2. **§3.3 draw-call budget: ≤150 → ≤100** on the WebGL2/Chromebook profile (150 stays acceptable on M-series); add internal-resolution auto-scale (≥720p floor) + AA-off default on weak GPUs.
3. **§4 client frame matrix:** add "60 fps @ UHD 600-class Chromebook, 1366×768, WebGL2" as a first-class row (constraint says this is the *real* audience; Iris Xe / M1 Air is not the floor).
4. **WebGL2 is the primary verified backend** for all perf gates; WebGPU remains shipped but is the bonus path (aligns §3.3's fallback with the audience reality).
5. **Netsim: add a peeker's-advantage measurement** (ms from peek-start to first-damage-possible, both sides) with a published target ≤ 80 ms @ 50 ms RTT; surface the measured value in the perf HUD.
6. **Settings: sensitivity import** — cm/360 (already spec'd) plus converters from Krunker multiplier / CS-style 0.022 sens, so competitor muscle memory onboards in one paste.
7. **weapons.ts TTK guardrail:** autos keep body TTK ≥ 0.8 s and head TTK roughly half of body — encode as a unit test over the weapon table so balance patches can't drift into "who sees first".

---

*Compiled 2026-07-20 from four research passes. Key unknowns that stay unknowns: Deadshot/Shell Shockers/Venge tickrates, all competitor interp/lag-comp values (except Shell Shockers' admitted none), measured competitor peeker's advantage. Every competitor number above is community-wiki or measured-by-us provenance unless a primary source is linked; treat fandom-wiki weapon tables as one-patch-stale at worst.*
