Implemented hotfix4 and finalized [HOTFIX4-REPORT.md](/Volumes/SD/gungame/client/HOTFIX4-REPORT.md).

### Conclusion

The most likely root cause was the manual ACES TSL path passing a `vec3` into three.js’s alpha-reading `ToneMappingNode`. It is corrected in [render-style.ts](/Volumes/SD/gungame/client/src/render-style.ts:181), with canonical ACES output configured in [main.ts](/Volumes/SD/gungame/client/src/main.ts:182).

Also delivered:

- Full → no-post → direct basic-material recovery ladder.
- Async WebGPU validation recovery within one frame per stage.
- Persistent “visual quality reduced” WebGL2 hint.
- Console errors plus settings-panel diagnostics.
- 0.15-intensity hemisphere safety fill in every style rig.
- Nonblocking KTX2 loading with basic-material fallback.
- Cubemap shape, mip, feature, and upload validation.
- WebGL2 spawn darkness test in [dark-frame.ts](/Volumes/SD/gungame/tools/e2e/dark-frame.ts:51).

### Verification evidence

`pnpm -r typecheck && pnpm -r test` exited successfully.

- Client: 12 files, 66 tests passed.
- Server: 6 files, 35 tests passed.
- Protocol: 4 files, 23 tests passed.
- Sim: 7 files, 39 tests passed.
- Tools validators, netsim, assets, and dark-frame step completed.
- Final client typecheck and tests passed again after the last diagnostics adjustment.

### Material caveat

Chromium pixel readback was explicitly skipped because this host denies Chromium’s Mach-port registration. Other browser or pixel failures remain fatal; browser-capable CI executes the >90%-dark assertion normally.

### Next action

Run the dark-frame test on browser-capable CI, then capture one real-hardware WebGPU screenshot with the settings panel open. No git operations or deploy/docs changes were made.