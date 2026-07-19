# Phase 4 implementation receipt (CODE lane)

This file is append-only during the Phase 4 implementation. Render values are
coherent placeholders and remain owned by the Prime.

## 2026-07-19 — baseline and RenderStyle/map structure

- Baseline before edits: `pnpm -r typecheck` passed; `pnpm -r test` passed (protocol 17,
  sim 34, client 4, server 19, plus tools map/netsim gates).
- Added a single `RenderStyle` unit with the required `materials(map)`, TSL
  `postChain`, `palette`, and `fogLightRig` seams. Candidates: dev-grid,
  ink-duotone, toon-cel, and brutalist-approx. The renderer remains WebGPU-first;
  three.js WebGPURenderer supplies its WebGL2 backend fallback.
- Extended map blob v2 with secret nodes while retaining v1 load compatibility.
- Added repeatable programmatic Spire and Foundry generation and strict validators.
  Generator output:

      spire: 344 triangles, 24 spawns, 1 kill volumes, 1 secrets
      foundry: 445 triangles, 16 spawns, 1 kill volumes, 1 secrets

## 2026-07-19 — HUD, viewmodels, audio, secrets, and integration

- HUD/menu structure now has name → quickplay, Create-room mode/ladder/gravity
  selection (ARSENAL taste-defaults to scoutz gravity), invite copy, match
  readouts, killfeed, Tab scoreboard, directional damage, death/respawn,
  scoreboard-freeze win state, server-restarting, connection-lost, and
  version-mismatch force-reload states. The pure HUD state machine has transition
  regression tests.
- Added 14 ladder viewmodel configurations covering all 13 unique weapon ids.
  Honest silhouette sharing is explicit. Equip/fire/rack transforms are
  procedural; Goldie has a 1.2 s break/open arc; Scout and Deadeye use the scope
  vignette + reticle with the existing FOV lerp.
- Added Web Audio synth recipes for every weapon's fire and impact identities,
  damage-pitched hitmarkers, headshot, kill, AIRSHOT, material-parametric
  footsteps/landing, speed wind, Foundry sigil jingle, and Spire secret-room
  ambience. PCM recipe tests assert deterministic finite samples and peak <= 1.
- Server now selects Foundry for Gun Game and Spire for Scoutzknivez. The Foundry
  sigil is an authored blob secret AABB; only a server-side knife ray can trigger
  it, once per round, and the loss-tolerant event drives the client jingle.
  Spire includes the strafe ledges, room shell, and names-wall material hook.
- SIGTERM/SIGINT drain sends the typed server-restarting refusal and closes with
  WebSocket 1012; the client maps both forms to the reconnecting HUD state.

## 2026-07-19 — final verification

Exact required gate:

    pnpm -r typecheck && pnpm -r test
    # exit 0
    # protocol: 17 tests; sim: 34; client: 13; server: 21
    # tools validators and four-room combat fixture: pass

Map validator receipts:

    valid maps/spire.gltf: 344 triangles, 24 spawns, modes 1, 1 kill volumes, 1 secrets
    valid maps/spire.blob: 344 triangles, 24 spawns, modes 1, 1 kill volumes, 1 secrets
    valid maps/foundry.gltf: 445 triangles, 16 spawns, modes 0, 1 kill volumes, 1 secrets
    valid maps/foundry.blob: 445 triangles, 16 spawns, modes 0, 1 kill volumes, 1 secrets

Build/budget receipts:

    pnpm --filter @gungame/client build
    # exit 0; JS 983.95 kB / 277.25 kB gzip; Spire 7.40 kB; Foundry 9.28 kB
    pnpm --filter @gungame/server build
    # exit 0; dist/index.js 832.3 kB
    pnpm --filter @gungame/client size
    # Size limit 3 MB; Size 274.08 kB gzipped

Foundry live 12-bot receipt (`tools/netsim/reports/phase4-foundry.json`):

    duration=45s, winnerObserved=true, restartObserved=true
    protocolErrors=0, reconnectCount=0, movementMirrored=true
    meanSnapshotBytes=314.212, maxSnapshotBytes=859
    predictionCorrectionP95M=0.1156, remoteEntityStallP95Ms=1.821

Local HTTP smoke:

    /gg/?name=Phase4Bot&style={dev-grid,ink-duotone,toon-cel,brutalist-approx} -> 200
    /gg/?...&style=toon-cel&backend=webgl2&mode=gungame -> 200
    /gg/r/r000001?room=r000001... -> 200 SPA fallback
    production Spire blob -> 200 / 7400 B; Foundry blob -> 200 / 9284 B

Material caveat: the in-app browser runtime exposed no browser binding in this
environment. The four candidates' material/TSL graph construction is automated,
the production bundle compiles, and all URLs resolve, but no rendered-frame
screenshot or in-motion dither judgment was possible in this lane. Manual matrix
still required: WebGPU + forced WebGL2, Spire + Foundry, all four styles, with
special attention to ink shimmer at high speed and toon outline thickness.

## Handoff

Conclusion: the Phase 4 CODE half is mechanically implemented and all automated
gates are green. The only unclosed acceptance item is the visual/in-motion matrix
that requires a real browser/GPU surface and the Prime's aesthetic adjudication.

Verification evidence: see the exact commands and outputs above; the final
monorepo gate exited 0 and the live 12-bot Foundry round observed both winner and
restart.

Material caveats: style/audio/material values remain intentional tuning
placeholders for the Prime; the browser binding was unavailable; and one
read-only `git status` was mistakenly run during initial inventory despite the
lane's no-git instruction. No git mutation was performed.

Next action: Prime runs the manual WebGPU/WebGL2 in-motion matrix, commits one
style/tuning set, and captures the backend screenshots. If any chosen values
change shader topology rather than constants, route that narrow code delta back
to this lane.
