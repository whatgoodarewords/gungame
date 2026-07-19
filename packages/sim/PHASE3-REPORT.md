# Phase 3 — Combat implementation report

## Progress receipt: shared dials and simulation primitives

Implemented the complete CLASSIC and ARSENAL weapon tables in
`packages/shared/src/weapons.ts`. Every combat dial is data: damage, head
modifiers, pellet count/spread, refire/reload, scoped accuracy/mobility, melee
range/cone/speed, projectile speed/radius/gravity/lifetime/live cap, splash
falloff, knockback, self-damage, and direct-hit bonus/radius.

Implemented pure combat primitives in `packages/sim`: health/damage, 128-tick
(2 s) death/respawn with generation increment, sub-tick shooter-eye
reconstruction, validated target-clock fallback, exact 300 ms rewind clamp,
alive/generation-fenced fractional hull rewind, capsule/head-sphere hitscan,
deterministic pellet spread, projectile lifecycle/splash/self impulse, and own
projectile matching by `(owner, fire cmd seq)`.

Implemented shared mode hooks for exactly Gun Game and Scoutzknivez.

Phase 3 rule decisions:

- Late join: one tier below the lowest current tier, clamped to tier 1
  ("trailing-parity minus one").
- Suicide (self-splash or kill volume): death/killfeed only; no advance and no
  demotion.
- Projectiles survive owner death, so posthumous kills advance normally.
- Disconnected-owner projectiles remain until impact/kill-volume/lifetime;
  their bounded lifetime and per-owner live cap prevent leaks.
- Scoutz teams are balanced immediately on join/leave; when a move is needed,
  the lowest-kill player on the larger team moves.

Verification evidence:

```text
$ pnpm --filter @gungame/shared typecheck && pnpm --filter @gungame/sim typecheck
@gungame/shared: tsc -p tsconfig.json
@gungame/sim: tsc -p tsconfig.json
exit 0

$ pnpm --filter @gungame/sim test
@gungame/sim: vitest run
exit 0
```

Material caveats at this checkpoint: these are the authoritative primitives;
protocol, room integration, client presentation, and bot/bench gates remain in
progress below.

## Progress receipt: protocol v3 combat schema

Bumped the protocol to version 3. Hello/welcome now carry ladder selection and
the player name. Snapshot entities discriminate player/projectile state;
players replicate health/tier/ammo and projectiles replicate owner, originating
fire command sequence, and weapon tuning id. Damage, kill, hit-confirm, and
AIRSHOT are enumerated repeated-event kinds with headshot/suicide/melee/direct/
posthumous flags. A compact optional mode block carries round freeze/winner,
restart countdown, team scores, and scoreboard rows.

The existing repeated-until-baseline-acked event journal remains the delivery
mechanism; no parallel reliable combat-event path was added.

Verification evidence:

```text
$ pnpm --filter @gungame/protocol typecheck
@gungame/protocol: tsc -p tsconfig.json
exit 0

$ pnpm --filter @gungame/protocol test
@gungame/protocol: vitest run
exit 0
```

The protocol suite includes round trips for player combat state, projectile
ownership matching fields, AIRSHOT event metadata, and compact mode/scoreboard
state. Server/client/tools call sites are the next integration checkpoint.

## Progress receipt: server modes, client wiring, and aggregate combat bench

Server rooms now execute the fire contract after each command's pmove, retain
sent-snapshot clocks for target validation, rewind from the existing 400 ms
hull rings, and apply the explicit 300 ms degradation clamp. Damage, deaths,
kill volumes, generation-fenced 2 s respawns, weapon cooldown/ammo, projectile
simulation, splash/self impulse, and repeated events are authoritative.

Both immutable room configurations are wired: Scoutzknivez TDM/team balance/
team spawns and Gun Game CLASSIC/ARSENAL advancement, melee demotion, final
melee win, 8 s freeze, and same-room restart. AFK, reconnect rotation/expiry,
supersede identity fencing, and server-side names are integrated.

The client now has mechanical Phase 3 presentation: validated name entry and
dev query params, health/tier/ammo HUD, Tab scoreboard, death/respawn overlay,
zoom FOV lerp/overlay, distinct placeholder weapon meshes, player/projectile
rendering, hitmarker/damage numbers/killfeed, tracers/impact flashes,
directional damage, and Web Audio stubs for damage-pitched hits, headshots,
kills, and AIRSHOT. Own projectile world detonation and self impulse are
replayed with unacked commands during reconciliation.

Scripted room tests completed CLASSIC, ARSENAL, and Scoutzknivez rounds through
win → scoreboard freeze → restart. The combat room suite also covers knife
demotion, posthumous rocket advancement, reconnect progress/expiry, names, AFK,
and deterministic 12-bot combat.

Local aggregate combat bench (4 × 12-player rooms; CLASSIC,
ARSENAL-scoutz, Scoutzknivez, ARSENAL-standard; 512 ticks):

```json
{"snapshotMeanBytes":223,"snapshotMaxBytes":223,"aggregateTickP95Ms":1.1620419999999285,"maxRoomTickP95Ms":0.2719169999991209,"roomTickP95Ms":[0.20779099999981554,0.2250000000003638,0.23149999999986903,0.2719169999991209],"combatRooms":["CLASSIC","ARSENAL-scoutz","Scoutzknivez","ARSENAL-standard"],"aggregateThresholdMs":18}
```

Evidence command:

```text
$ pnpm --filter @gungame/tools test
valid maps/greybox.gltf: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
valid maps/greybox.blob: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
{...metrics above...}
exit 0
```

This local bench is well below the 4 ms per-room and 9 ms aggregate targets;
the required target-box admission-limit rerun remains Prime-owned because this
lane has no deployment authority. The live 12-player ARSENAL netsim JSON gate
is next.

## Final handoff

### Conclusion

Phase 3 Combat is implemented across sim/shared, protocol v3, server rooms,
client presentation/prediction, and combat bots. The requested workspace gates,
scripted full matches for all three configurations, local multi-room combat
bench, production client build/size gate, and live local 12-bot ARSENAL metrics
run completed successfully. No git or deploy operation was performed.

### Verification evidence

```text
$ pnpm -r typecheck && pnpm -r test
typecheck: shared, protocol, sim, client, server, tools — all Done
protocol: 4 files, 17 tests passed
sim:      7 files, 34 tests passed
server:   4 files, 19 tests passed
client:   1 file, 4 tests passed
tools:    map validators passed; combat fixture passed
exit 0

$ pnpm --filter @gungame/client build && pnpm --filter @gungame/client size
98 modules transformed
dist/assets/index-BdJ-dbIm.js 882.42 kB (247.50 kB gzip)
size-limit: 244.65 kB gzipped / 3 MB
exit 0

$ pnpm --filter @gungame/server exec vitest run test/full-match.test.ts --reporter=verbose --no-file-parallelism
CLASSIC gun-game round: passed (win → restart)
ARSENAL gun-game round: passed (win → restart)
Scoutzknivez TDM: passed (50 → restart)
3/3 passed

$ pnpm --filter @gungame/tools test
snapshot mean/max: 223/223 B
aggregate p95: 0.725416 ms
max per-room p95: 0.145750 ms
rooms: CLASSIC, ARSENAL-scoutz, Scoutzknivez, ARSENAL-standard
exit 0

$ pnpm --filter @gungame/tools exec tsx netsim/run-bots.ts --bots 12 --duration 30 --profile steady --mode gungame --ladder arsenal --gravity scoutz --output netsim/reports/phase3-arsenal-steady.json
protocolErrors: 0
reconnectCount: 0
meanSnapshotBytes: 348.41514836022907
maxSnapshotBytes: 969
projectileCombatObserved: true
winnerObserved: true
restartObserved: true
exit 0
```

Metrics artifact: `tools/netsim/reports/phase3-arsenal-steady.json`.

### Material caveats

- The ARSENAL metrics process used the deterministic steady workload label on
  local loopback; it did not install the privileged dummynet/netem 150 ms + 2%
  packet profile. Its snapshot-size assertion is valid (348.42 B ≤ 400 B), but
  it is not presented as the packet-impairment verdict.
- Prediction correction p95 in that run was 0.22416 m. Projectile knockback is
  intentionally included by the existing metric, matching SPEC's instruction
  that Phase 6 must exclude/account for intentional impulse events. Remote stall
  p95 was 1.79071 ms.
- The aggregate timings above are local, not the dream-server neighbor-contention
  measurement used to revise production admission limits.
- Browser control reported no available browser backend, so the final visual UI
  smoke could not run in this lane. Typecheck, client unit tests, Vite production
  build, and size-limit all passed.
- Presentation is deliberately mechanical: colored weapon/projectile meshes,
  overlay, and Web Audio oscillators are Phase 3 stubs; Phase 4 owns real art/SFX.

### Next action

Prime should review/integrate the diff, run the privileged steady/burst packet
profiles and dream-server aggregate bench, visually smoke the name/HUD/zoom/
scoreboard flows in a browser, then own git and issue #6 closure.
