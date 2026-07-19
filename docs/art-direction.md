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
