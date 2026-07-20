# Native-feel spec — "NOT a browser game" (owner directive 2026-07-20)

The tells that read "browser game" are enumerable. Each gets a lever, a measure,
and a budget. Binding on lane 6.6.

## 1. Input latency chain (the #1 tell)
- `pointerrawupdate` events for mouse (bypasses rAF-aligned mousemove batching;
  Chromium ships it — feature-detect, fall back to mousemove).
- Canvas context `{ desynchronized: true }` where the backend allows — skips
  the compositor queue on Chromium; measure, keep only if tear-free.
- Frame-pacing governor: render loop targets the display's actual refresh
  (measure via rAF deltas); NEVER queue >1 frame; drop-not-queue under load.
- **Measure end-to-end**: a click-to-photon estimator in the perf HUD
  (input timestamp → rAF present timestamp). Budget: ≤ 35 ms at 120 Hz on
  M-series. This number is the product; it goes in the panel permanently.

## 2. Fullscreen-first immersion
- PLAY enters fullscreen (Fullscreen API) by default (setting to opt out);
  Esc shows the pause card, not raw browser chrome. Title flow already good.
- Zero page scroll ever; zero selection artifacts; overscroll-behavior none.

## 3. Frame-time discipline (jitter kills feel before average fps does)
- Frame-time p99 in the HUD breakdown; budget p99 ≤ 1.5× median.
- Zero per-frame allocation already specced — enforce via the GC smoke.
- Style post-chains must not exceed their ms budgets on WebGL2 either.

## 4. Audio punch & latency
- AudioContext `{ latencyHint: "interactive" }`, all buffers pre-decoded at
  join (no first-shot decode hitch), fire sound triggered from the PRESENTATION
  queue (same frame as the visual kick, never the network echo).
- The compressor bus stays; add a subtle <80 Hz thump layer on fire.

## 5. Feel affordances that natives have
- Kill-confirm within 1 frame of the server event; hitmarker audio pitch
  already spec'd — verify sub-frame scheduling.
- Weapon switch/equip cancels reload state visually with zero dead frames.
- 120/144 Hz displays first-class: input + interp verified at high refresh
  (the pulse-latch already fixed the core; add a 144 Hz e2e assertion).

## 6. The desktop wrapper (the paid product, later)
- Tauri shell over the SAME client: true exclusive fullscreen, OS-level raw
  input, instant boot. This is the Mindustry-convenience SKU — the native-feel
  work above IS its foundation.

Measures land in the perf HUD; budgets join §4 of the spec; regressions fail CI
where automatable (frame-pacing + allocation), manual matrix otherwise.
