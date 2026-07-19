# Phase 4b implementation report

## 2026-07-19 — scope and architecture checkpoint

- Scope accepted: front-door redesign, Duna and Cascade, Gun Game map
  rotation/pinning, protocol bump, render-style live-switch P0, render/network
  fate isolation, and dev-panel cleanup.
- Normative inputs read: `docs/SPEC.md` sections 3.3, 3.4, and 3.6 plus
  `docs/maps-brief.md` Maps 3 and 4. No files under `docs/` or `deploy/` will be
  changed.
- Protocol plan: version 4 carries an immutable room map preference in `Hello`
  and the authoritative current map in `Welcome` and snapshot mode state. This
  is required for Foundry → Duna → Cascade rotation to remain server-owned.
- Render diagnosis from source: style changes currently mutate one live
  `RenderPipeline.outputNode` after disposing the active rig. The fix will
  reconstruct the post-processing pipeline transactionally, retain the last
  working style on failure, and keep/re-arm the animation loop independently
  of the existing setTimeout-driven sim/network tick.

Verification evidence at this checkpoint:

```text
pwd
/Volumes/SD/gungame

rg -n "^### 3\\.3|^### 3\\.4|^### 3\\.6|Duna|Cascade" docs/SPEC.md docs/maps-brief.md
docs/maps-brief.md:57:## Map 3 — "Duna" ...
docs/maps-brief.md:74:## Map 4 — "Cascade" ...
docs/SPEC.md:87:### 3.3 Client / rendering
docs/SPEC.md:96:### 3.4 Server & deploy ...
docs/SPEC.md:116:### 3.6 Game feel ...
```

Material caveats at this checkpoint: implementation and end-to-end validation
are still in progress; no completion claim yet.

Next action: land the pure front-door state model and unit tests, then wire its
DOM/CSS and server state handling.

## 2026-07-19 — front door, protocol, maps, and render-isolation checkpoint

- Rebuilt the front door as one 420 px-max card with 20 px padding/14 px gaps,
  strict border-box sizing, the specified palette/type hierarchy, live name
  filtering and localStorage persistence, one PLAY action, disclosure-driven
  segmented room controls, conditional Ladder, ARSENAL → Scoutz taste pairing,
  map auto/pinning, and all required in-card connection states.
- Added the live Foundry spectator background at 15 m with a 60 s orbit and the
  `#0e131b` unloaded/error fallback. The menu no longer paints a void over the
  canvas and contains no development-parameter footer.
- Bumped protocol 3 → 4. `Hello` now carries `mapPreference`; `Welcome` and
  snapshot mode state carry authoritative `mapId` so between-match map changes
  are server-owned and observable by every client.
- Added strict Duna/Cascade programmatic generators and validator contracts.
  Duna bakes the broken-arch Mid slit, measured 70 m Long/dogleg/surf route,
  elevated Short/drop, 4 m tunnels, two plazas, 0.4 m movement texture, and the
  crate-chain graffiti room. Cascade bakes 48 loop segments (3 waves per
  quarter with quarter downhill rhythm), a complete 50° surf rim, two offset
  crossing bridges at 6/9 m, three interrupted terraces, the Well, tangential
  spawns, and waterfall-notch strafe chain.
- Replaced live `RenderPipeline.outputNode` mutation with candidate pipeline
  reconstruction. A candidate must render successfully before the old pipeline
  and visual rig are disposed; failure logs the backend error and restores the
  prior working style. The outer frame boundary explicitly re-arms the renderer
  after any uncaught frame exception.
- Extracted the 64 Hz sim/command driver into `OffRenderTickDriver`, which is
  setTimeout-driven and independent of renderer/rAF. Added a deterministic
  3-second render-death regression that observes 190–192 command ticks while
  the fake connection remains active.
- Dev panel is hidden by default, toggled with Backquote, and remembers its
  state in localStorage. Its duplicate SPEED readout was removed; the product
  HUD remains authoritative.

Verification evidence at this checkpoint:

```text
pnpm --filter @gungame/protocol typecheck && pnpm --filter @gungame/protocol test
Test Files  4 passed (4)
Tests       17 passed (17)

pnpm mappipe:phase4
spire: 344 triangles, 24 spawns, 1 kill volumes, 1 secrets
foundry: 445 triangles, 16 spawns, 1 kill volumes, 1 secrets
duna: 367 triangles, 16 spawns, 1 kill volumes, 1 secrets
cascade: 1773 triangles, 16 spawns, 2 kill volumes, 1 secrets

pnpm --filter @gungame/client typecheck
> tsc -p tsconfig.json
(exit 0)

pnpm --filter @gungame/client test
> vitest run
(exit 0; exact aggregate retained for the final full-repo gate below)
```

Material caveats at this checkpoint: full monorepo gates, browser width matrix,
authoritative rotation tests, and live scripted bot matches are still pending.

Next action: complete room-rotation/pinning coverage, validate all map formats,
then run local server bot matches on Duna and Cascade.

## 2026-07-19 — final verification and hand-off

### Conclusion

Phase 4b Parts A, B, and C are implemented. The front door follows the supplied
card hierarchy and palette, runs over a live 15 m/60 s arena orbit, persists and
filters names, exposes the required segmented create flow/map pinning, and keeps
all transient connection UI inside the card. Protocol v4 and the authoritative
room now support map preferences plus live map ids; auto Gun Game rooms rotate
Foundry → Duna → Cascade while pins remain fixed and Scoutz stays Spire. Duna
and Cascade are generated through mappipe with strict validators. Render-style
switches reconstruct the TSL pipeline transactionally, roll back on failure,
re-arm after uncaught frames, and cannot starve the independently scheduled
sim/network command driver. The dev panel is hidden/persisted behind Backquote
and no longer duplicates SPEED.

The requested responsive matrix is encoded and unit-asserted as follows:

| viewport width | asserted outer card width | content width after 20 px padding | containment |
|---:|---:|---:|---|
| 360 px | 328 px | 288 px | 16 px viewport gutters |
| 768 px | 420 px | 380 px | centered, max-width held |
| 1440 px | 420 px | 380 px | centered, max-width held |

The CSS also caps card height to `calc(100vh - 32px)` and scrolls internally,
so expanded controls remain inside the single card boundary.

### Verification evidence

```text
pnpm -r typecheck && pnpm -r test
(exit 0)

protocol: 4 files passed, 17 tests passed
sim:      7 files passed, 34 tests passed
server:   4 files passed, 22 tests passed
client:   6 files passed, 27 tests passed

valid maps/spire.gltf:    344 triangles, 24 spawns, 1 kill volume, 1 secret
valid maps/spire.blob:    344 triangles, 24 spawns, 1 kill volume, 1 secret
valid maps/foundry.gltf:  445 triangles, 16 spawns, 1 kill volume, 1 secret
valid maps/foundry.blob:  445 triangles, 16 spawns, 1 kill volume, 1 secret
valid maps/duna.gltf:     367 triangles, 16 spawns, 1 kill volume, 1 secret
valid maps/duna.blob:     367 triangles, 16 spawns, 1 kill volume, 1 secret
valid maps/cascade.gltf: 1773 triangles, 16 spawns, 2 kill volumes, 1 secret
valid maps/cascade.blob: 1773 triangles, 16 spawns, 2 kill volumes, 1 secret

fixture: snapshot mean 223 B, max 223 B; aggregate tick p95 2.612 ms;
         max room tick p95 0.687 ms

pnpm --filter @gungame/client build && pnpm --filter @gungame/server build
(exit 0)
client JS: 992.39 kB / 279.78 kB gzip; Duna blob 7.72 kB;
Cascade blob 35.87 kB; server bundle 834.8 kB

Duna pinned live run: 12 bots × 60 s; 45,564 snapshots; mean 297.62 B;
max 936 B; 0 reconnects; 0 protocol errors; movement mirrored;
winnerObserved=true; restartObserved=true

Cascade pinned live run: 12 bots × 60 s; 43,102 snapshots; mean 283.58 B;
max 955 B; 0 reconnects; 0 protocol errors; movement mirrored;
winnerObserved=true; restartObserved=true
```

Bot receipts are retained at
`tools/netsim/reports/phase4b-duna-long.json` and
`tools/netsim/reports/phase4b-cascade-long.json`.

### Material caveats

- The browser-control runtime exposed no browser (`agent.browsers.list()` was
  empty), so an actual visual/computed-style browser pass at the three viewport
  widths could not be performed here. The exact width/containment model is unit
  tested and the production CSS/build are green, but a human visual matrix is
  still the one outstanding acceptance observation.
- For the same reason, WebGPU error capture and WebGL2 live switching were
  exercised at the graph/reconstruction/error-boundary unit layer, not in a
  real GPU browser context. Every style × declared backend boundary is covered
  by rollback tests, and every TSL graph/material/rig constructs, but live GPU
  driver behavior remains a manual check.
- The long local bot receipts show prediction-correction p95 of 0.209 m (Duna)
  and 0.213 m (Cascade), above the spec's impairment-gate target of 0.15 m.
  They were local functional match runs rather than the pinned impairment gate;
  snapshot size, stalls, reconnects, protocol integrity, winner, and restart
  passed. The long-lived server PTY also printed catch-up debt warnings while
  other tool processes paused/resumed; the isolated fixture remained well
  inside its tick thresholds.

### Next action

Run the 360/768/1440 visual matrix and live style-switch matrix in an attached
WebGPU/WebGL2 browser. If those are clean, this phase is ready for owner review;
the correction p95 should be re-measured under the canonical impairment harness
before treating it as a networking gate result.
