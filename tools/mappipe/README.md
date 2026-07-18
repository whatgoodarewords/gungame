# Gungame map pipeline v1

`mappipe` bakes gameplay data from a Blender-exported JSON `.gltf`. The server
loads only the resulting blob; it never uses `GLTFLoader`.

## Node naming

- `col_<label>`: triangle mesh included in collision geometry.
- `spawn_<mode>_<team>_<label>`: spawn transform. `mode` and `team` are decimal
  `u8` ids. The node's world translation is the spawn position and its Y
  rotation is the yaw in radians.
- `bounds_<label>`: exactly one mesh whose world AABB defines map bounds. It is
  metadata only and is not collision geometry.
- `kill_<label>`: mesh whose world AABB becomes an axis-aligned kill volume.

Names without these prefixes are visual-only and ignored. Collision meshes must
use triangle primitives with float32 `POSITION` accessors and unsigned indices.
External `.bin` buffers and base64 data URIs are supported; `.glb`, sparse
accessors, Draco, and non-triangle collision primitives are outside v1.

## Commands

```sh
pnpm mappipe maps/greybox.gltf
pnpm mappipe validate maps/greybox.gltf
pnpm mappipe validate maps/greybox.blob
pnpm mappipe:greybox
```

The build command emits `maps/<name>.blob`, reloads it, and validates it. A map
needs at least one `col_` mesh, one `bounds_` node, and at least eight spawns for
every mode present in its spawn nodes.

## Blob layout

All integers and floats are little-endian. The 24-byte header is `GGMP`, version
`u32`, position-float count `u32`, index count `u32`, spawn count `u32`, and kill
volume count `u32`. It is followed by collision positions (`f32` xyz), indices
(`u32`), compact spawns (`mode u8`, `team u8`, position `f32x3`, yaw `f32`), the
map AABB (min/max `f32x3`), then kill-volume AABBs in the same form.
