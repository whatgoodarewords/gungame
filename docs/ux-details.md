# UX details punch list — "consider all details" (owner directive 2026-07-19)

Fable-authored, binding on the polish lane (4c). Every item is a detail a real
player hits in their first ten minutes. P0 = owner-reported or game-breaking.

## Input (P0 cluster)

1. **Crouch-jump on macOS is OS-eaten**: Ctrl+Space = system input-source
   shortcut → Space never reaches the page. Duck default becomes **ShiftLeft**
   (primary, shown in UI) + KeyC + ControlLeft all bound. Same audit for every
   combo we use: Cmd/Ctrl+W (close tab!) must never be near gameplay keys —
   no bindings on Q/W-adjacent modifier combos, ever.
2. Jump ALSO on mouse wheel-down (scroll-jump — bhop culture standard; wheel
   events while pointer-locked).
3. Key rebinding: minimal but present — a Controls section in the panel
   listing bindings with click-to-rebind, localStorage-persisted.
4. Pointer-lock UX: on lock loss (Esc), show a dim overlay "click to
   re-enter" instead of a dead cursor over a live game; pause local input
   cleanly (no stuck buttons — already zeroed on unlock, verify).
5. Fire on mouse-down must also register while pointer is NOT yet locked
   (first click = lock only, never a wasted shot — swallow it).

## Crosshair (P0 — owner: "trash")

6. Replace with a proper system: 4 short lines + optional center dot, gap
   that widens with actual spread state (scout unscoped = wide, scoped = dot
   only), 1.5 px hairline at devicePixelRatio, pure white with 1 px black
   outline (readable on any style), hit-flash: 60 ms accent tint on damage
   dealt, distinct X-flash on kill. Settings: size/gap/dot/color presets in
   panel. NEVER blocks the aim pixel.

## Projectiles & combat readability (P0 — owner: "not seeing any")

7. End-to-end projectile visibility audit: verify replication + render on
   Peacemaker/Discus in a live ARSENAL room (add a bot-vs-bot visual test
   that asserts projectile meshes exist while in flight). Regardless of the
   bug: projectiles need PRESENCE — emissive core + additive trail (rocket:
   smoke-puff line + point light; disc: flat glow ribbon), audible whoosh
   by proximity, and a muzzle report distinct from hitscan.
8. If the confusion was CLASSIC-has-no-projectiles: the ladder HUD tier chip
   shows the weapon's TYPE icon (hitscan/projectile/melee) so expectations
   are set per tier.
9. Tracers for hitscan every shot (bright, 40 ms), impact sparks + decal-less
   puff; beam weapons (Arc) render the beam every tick held.
10. Damage numbers: rise+fade 400 ms, crit/headshot in accent + larger; damage
    DIRECTION indicator arc already spec'd — verify it renders.

## First-session flow

11. The front door (4b) + THEN: first-spawn safe grace (1.5 s spawn
    protection vs spawn-camping, standard), a 3-line "how to play" toast on
    first ever spawn (localStorage): move/jump/duck keys, "hold SPACE to
    chain hops", tier goal. Dismiss on first kill.
12. Death screen: killer name + weapon + their remaining HP (the classic
    "they were one shot!" info), respawn countdown, tier context.
13. Kill confirmations: killfeed entry + your kill line emphasized + tier-up
    banner ("TIER 4 — PEACEMAKER") with 600 ms weapon-name flourish;
    demotion banner when knifed (red, humbling).
14. Scoreboard (Tab): sorted, you-row highlighted, ping column, tier column,
    match timer, room name + invite-copy button right on the board.

## Session robustness

15. Reconnect UX: auto-attempt with countdown ("reconnecting… 3") before
    surrendering to CONNECTION LOST + a REJOIN button (fresh join, name
    prefilled). Never a dead-end screen (owner hit this via the style bug).
16. Tab-out/return: freeze-frame + "click to resume" (state already handled
    server-side; the return must feel intentional, not broken).
17. AFK warning at 20 s ("move or be kicked in 10 s") before the 30 s kick.
18. Latency surface: small ping readout in HUD corner; turns amber >120 ms,
    red >200 ms. No graphs, no drama.

## Audio details

19. Master volume + mute in panel (persisted); audio CONTEXT resume on first
    gesture (browsers block autoplay — verify no silent-until-click bug).
20. Own-footsteps quieter than enemies'; landing thud scales with fall
    speed; tier-up sting; last-tier-opponent warning sting (someone reached
    Goldie/Knife — the "endgame is near" tension cue, subtle).
21. Kill-confirm pitch rises with streak (2+ in 10 s), resets on death —
    Quake lineage, restraint version.

## Visual polish floor

22. Enemy readability: enemies always carry the accent-emissive rim
    (style-independent rule — the ink style's core idea generalized);
    nameplates fade in <15 m, never through walls.
23. Respawn: 200 ms fade-in + brief invuln shimmer (reads as spawn
    protection); death: camera detaches to a 1 s orbit of your corpse
    position (no kill-cam, per no-theater — just closure).
24. Viewmodel: subtle fire recoil kick (rotational, 40 ms return), equip
    raise on tier change — no idle bob (no-theater clause holds).
25. FOV slider (90–120) in panel — already spec'd, verify present; zoom
    respects it proportionally.

## Copy & chrome

26. All UI copy lowercase-terse ("finding a room…", "you were knifed —
    demoted", "tier 6/8 — deadeye"); no exclamation marks anywhere (tone =
    dry confidence).
27. Page <title> = "gungame — {map}" live; favicon = the gg dot mark.
28. Mobile/touch visitors get one clean screen: "gungame needs a mouse +
    keyboard. grab a computer." — no broken half-render.
29. Room-full, room-not-found, version-mismatch: each a distinct, calm,
    in-card message with one obvious action (already partly spec'd — verify
    all three render).

Ship order: P0 cluster (1, 5, 6, 7, 15) → first-session flow → the rest.
