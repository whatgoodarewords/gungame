# Art direction — "it should feel good" (owner escalation 2026-07-19)

The bar: NOT Tron, NOT a 1980 shooter, NOT programmer-art. A modern, tactile,
stylized shooter — think Superhot/BONEWORKS-adjacent material honesty; low-poly
geometry is fine, flat-shaded default-lit geometry is not. All-stops-out within
the no-theater clause (considered ≠ busy).

## Rendering (lane 7 deliverables)

1. **Real lighting**: one Poly Haven HDRI per map as environment (IBL) + a sun
   directional with soft shadows (PCF); baked-feel AO via three's AO options
   per map chunk. Kill the flat HemisphereLight-only look everywhere.
2. **PBR materials**: Poly Haven concrete/metal/plaster sets, triplanar-mapped
   in the map materials (no UV authoring needed on generated geometry);
   roughness variation is what makes surfaces feel real. Accent emissives keep
   their role (they finally read once everything else is matte).
3. **Post chain**: ACES tonemapping, subtle bloom (emissives + muzzle flashes
   only), vignette barely-there. NO chromatic aberration, no film grain.
4. **Impact tactility**: hit sparks w/ 1-frame point light, surface-tinted
   puffs, decal-free scorch flash on rockets, muzzle flash light that
   illuminates the viewmodel arms, shell-casing ejects on hitscan weapons
   (brief, physicsless arcs — cheap, enormous feel).
5. **Viewmodel finish**: the CC0 arms+guns (see assets task) with proper
   materials, contact shadow under the gun, subtle breathing idle (2 mm, 3 s —
   the one permitted idle motion; still no walk-bob).
6. **Character presence**: Quaternius rigs with real materials + rim accent;
   footstep dust puffs at speed; death = ragdoll-lite (single-impulse rag pose
   fade, no physics sim).
7. **Map dressing pass**: each generated map gets a dressing layer from CC0
   kits (crates/pillars/rails — collision-true), so spaces read as PLACES.
   Fix the z-fighting finding (live-findings #3) in the same pass.

## Audio tactility

8. Layered gunshots (mechanical click + body + tail), surface-varied
   footsteps, landing whumps by fall speed, the near-miss set, room-tone per
   map (low ambience loop), UI sounds from the Kenney interface set. Master
   bus: gentle compressor so peaks feel punchy, not clippy.

## Asset acquisition (blocking, this week)

The marquee packs MUST land as real files (procedural fallbacks are why it
feels 1980): WRAD ARMS, Quaternius Animated Guns + Ultimate Guns + Universal
Characters + Animation Library, Kenney audio, Poly Haven textures/HDRIs.
Prime retries headless downloads; anything gated gets a 2-minute owner manual
download list (owner offered). NO authenticated services needed — all CC0
direct.

## Performance discipline (owner: "very, very performant and elegant in that way")

Perf is part of the aesthetic — a speed game that stutters is ugly. Every
visual feature above pays rent against these budgets, measured, or it's cut:

- **Frame budget** (unchanged, now feature-allocated): ≥120 fps M-series /
  ≥60 fps Iris-Xe-class. New-feature allocations at 1440p M-series:
  lighting+shadows ≤2.0 ms, post chain ≤1.0 ms, particles+casings ≤0.5 ms,
  characters ≤1.0 ms. The perf HUD (backtick panel) gains a frame-time
  breakdown row so regressions are visible the day they land.
- **Draw calls ≤150 holds**: dressing via BatchedMesh/instancing only;
  particles are ONE instanced system per effect type; casings pooled (max 32
  live, oldest recycled).
- **Shadows**: single directional cascade, tight frustum per map bounds,
  1024px default / 2048 on M-series — never per-light shadow maps.
- **Textures**: KTX2/Basis-compressed (toktx at build), 1K default sizes,
  mipped; total GPU texture budget 64 MB. HDRIs prefiltered offline to PMREM
  at build, not runtime.
- **Post**: one combined pass (ACES + bloom threshold + vignette in a single
  TSL chain) — no naive multi-pass stacking.
- **Zero per-frame allocation** in render + sim hot loops (reuse vectors,
  pooled objects); a CI smoke asserts no GC pressure growth over a 60 s bot
  match (heap delta < 5 MB).
- **Cold load stays < 5 s** on throttled 50 Mbps incl. all new assets:
  code-split the character/dressing packs to stream in AFTER first
  controllable frame (play first, pretty catches up within seconds — the
  correct order for a game about instant play).
- **Elegance clause**: prefer one system that does a thing well over three
  toggles; any effect that can't justify its milliseconds in feel terms is
  deleted, per the no-theater standing bar.
