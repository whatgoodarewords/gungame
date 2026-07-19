# Phase 4c — hardening, UX details, and assets

Progressive implementation report for the Codex GPT-5.6 lane started
2026-07-19. Normative inputs: `docs/SPEC.md`, the complete
`docs/ux-details.md` punch list, `docs/assets-plan.md`, and
`docs/arsenal-ladder.md`.

## Baseline

- Repository instructions and normative inputs read in full.
- Scope fences observed: no Git operations; no changes under `docs/` or
  `deploy/`.
- Baseline `pnpm -r typecheck && pnpm -r test` started before implementation;
  completed green: protocol 17 tests, sim 34 tests, client 27 tests, server 22
  tests, all map validators green, netsim fixture snapshot mean/max 223 B and
  aggregate tick p95 0.990 ms.

## Part A — verified review findings

- P1-1: command consumption now sheds recovered burst backlog to the two-tick
  jitter target while advancing `lastProcessedCmdSeq`; the 150 ms burst
  regression asserts queue depth returns to zero inside four ticks.
- P1-2: airborne unduck now requires the standing capsule to fit at the current
  origin. Vent blocking and the existing jumpbug behavior are both covered.
- P1-3: snapshot size probes no longer trip `MAX_FRAME_BYTES`. Packing keeps
  self/all players mandatory, prioritizes projectile lifecycle and combat
  events, reports deferrals, and records only represented entity/event state in
  ack baselines so deferred content is retried.
- P1-4: command-window interpolation-target monotonicity is no longer fatal;
  regressed adaptive targets reach `validateFireTarget` and clamp to the server
  estimate.
- P1-5: server epochs retain the installed plus pending chain through refocus
  races. Duplicate and superseded acknowledgements for actually-sent pairs are
  idempotent; never-sent values remain errors.
- P2-6: a fifth owner projectile evicts the oldest live projectile as a
  lifetime detonation and the new shot spawns.
- P2-7: client event dedupe advances a monotonic low-water mark and prunes
  contiguous IDs instead of retaining them forever.
- P2-8: uncounted kills during freeze or after attacker departure preserve the
  real `suicide` flag and return `counted: false`.
- P2-9: iteration-exhausted grazing capsule casts register within
  `radius + 2*skin`; a source-verified numeric grazing fixture covers the path.

Focused verification after the first implementation pass:

```text
pnpm --filter @gungame/protocol typecheck
pnpm --filter @gungame/sim typecheck
pnpm --filter @gungame/server typecheck
→ all exited 0

pnpm --filter @gungame/protocol test
→ 4 files, 23 tests passed
pnpm --filter @gungame/sim test
→ 7 files, 37 tests passed
pnpm --filter @gungame/server test
→ 4 files, 22 tests passed
```

## Part B — complete UX punch list

- Input now defaults duck to left Shift with C/left Ctrl alternates, accepts
  wheel-down jump, persists conflict-safe rebinding, preserves the first shot
  used to acquire pointer lock, and clears held input on lock/background loss.
- Pointer-lock resume, adaptive four-line crosshair with center dot and
  spread/FOV projection, scoped collapse, DPR-stable stroke, hit/kill flashes,
  damage numbers/direction, weapon-type icons, tracers, impact puffs, and
  projectile-specific presence are wired through the live render loop.
- Fresh spawns have server-authoritative 1.5-second protection. The first-match
  controls toast, death detail/countdown, self-emphasized killfeed, tier and
  demotion banners, sorted scoreboard metadata, reconnect countdown/retry,
  background resume, AFK warning, and ping color thresholds are implemented.
- Persisted FOV, crosshair, volume, and mute settings are available from the
  always-reachable settings control. Audio unlocks only from a user gesture.
- Own/enemy footsteps, landing weight, streak pitch, tier/endgame stings,
  enemy rim/nameplates with wall occlusion, spawn shimmer, 200 ms self respawn
  fade, one-second death orbit, procedural recoil/equip/reload/sway, live title
  and favicon, touch-only gate, and distinct refusal recovery actions are in
  place. Product copy is lowercase and terse.

Focused UX verification:

```text
pnpm --filter @gungame/client typecheck
→ exited 0
pnpm --filter @gungame/client test
→ initial suite remained green; Phase 4c control/settings/reconnect/visual
  regressions added afterward for the final pass
pnpm --filter @gungame/server test
→ 4 files, 23 tests passed (includes spawn-protection contract)
```

## Part C — asset integration

- Ten CC0 Quaternius/CreativeTrio per-slot GLBs are vendored and mapped across
  both ladders. Arc, Peacemaker, and Discus retain deliberate procedural
  silhouettes; all viewmodels share code-driven arms, view-velocity sway,
  per-weapon kick, equip/rack tilt, and Goldie choreography.
- The remote box renderer was replaced with one shared, six-part instanced
  humanoid rig plus two instanced accent-rim meshes. Replicated velocity,
  grounded/alive/ducked state drives run, strafe, jump, death, crouch, and
  spawn-shimmer poses while holding the draw-call budget.
- Three original Kenney archives plus selected CC0 Ogg sources are retained for
  provenance. Selected fire/impact/footstep/UI fits are decoded on gesture and
  spatialized; AIRSHOT and tier stings remain distinctive synthesis recipes.
- `assets/vendor/LICENSES.md`, repeatable peak normalization, GLB/zip/Ogg magic
  and size validation, and a 4 MiB gzip media budget are checked in. Full source
  archives are not imported into the client bundle.

FLAG — WRAD ARMS resisted the documented headless itch.io path; procedural
capsule arms are shipped and the owner may manually replace them.

FLAG — Quaternius Universal Base Characters / Universal Animation Library
resisted its JavaScript-gated headless download; the shipped shared procedural
humanoid rig is the documented fallback.

FLAG — michorvath Freesound downloads require authentication; Kenney samples
and synthesis are the documented fallback.

Browser-verification caveat discovered during the pass: the Playwright test is
implemented at `tools/e2e/visual-and-style.ts`, but this macOS execution sandbox
denies both Playwright Chromium binaries at the Mach service boundary, and the
connected in-app browser advertised no available browser instance. The test
remains a separate `pnpm --filter @gungame/tools test:e2e` target so the normal
workspace regression suite is not made environment-dependent.

## Final verification and hand-off

Conclusion: the Phase 4c code, UX punch list, protocol/sim hardening, vendored
asset pipeline, visual systems, and regression coverage are implemented. No Git
operations were used and `docs/` / `deploy/` were not modified.

Verification evidence:

```text
pnpm -r typecheck
→ protocol, shared, sim, server, client, tools: all Done; exit 0

pnpm -r test
→ protocol: 4 files / 23 tests passed
→ sim: 7 files / 38 tests passed
→ server: 4 files / 23 tests passed
→ client: 7 files / 32 tests passed
→ all ten map validators passed
→ netsim: mean/max snapshot 223 B; aggregate tick p95 2.096 ms (<18 ms)
→ assets: 11 GLBs, 3 zips, 12 normalized Oggs; validation passed
→ exit 0

pnpm --filter @gungame/client build
→ 140 modules; production build completed in 9.44 s
→ cold command wall time 39.96 s (includes audio normalization)

pnpm --filter @gungame/client size
→ JavaScript 327.6 kB gzip / 3 MiB budget
→ vendored media 267.04 kB gzip / 4 MiB budget
→ dist on disk 1,920 KiB

pnpm --filter @gungame/tools assets:validate
→ client payload 290,770 B gzip / 4,194,304 B ceiling

ffmpeg volumedetect over all selected runtime Oggs
→ decoded peaks -6.0 to -6.3 dBFS; none exceeds the -6 dBFS ceiling
```

Material caveats:

- The three asset fallback FLAGs above are intentional outputs of the
  documented acquisition plan, not silent omissions.
- The proper bot-match/style-switch Playwright test exists and typechecks, but
  could not execute in this session: both Playwright browser binaries were
  rejected by the macOS Mach-service sandbox; the in-app browser had no
  available instance; Computer Use was not approved for Chrome or Safari.
  Unit-level backend style recovery tests and projectile/character presence
  tests are green, but they do not replace this final live-browser run.
- The first cold-build timing command returned a nonzero wrapper status after a
  successful Vite build because `/usr/bin/time -l` could not read
  `kern.clockrate` in the sandbox. The Vite build itself completed and the
  subsequent size command exited 0.

Next action: run `pnpm --filter @gungame/tools test:e2e` in a host or CI runner
that permits Playwright Chromium. If desired, manually download WRAD ARMS and
the Quaternius Universal character/animation packs to replace the shipped,
tested procedural fallbacks.
