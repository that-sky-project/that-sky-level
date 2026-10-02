# That Sky Level
A simple level converter for Sky:CotL `BstBaked.meshes` version 0x3C or 0x3D, and a incomplete converter for `Objects.level.bin` version 0x01.

## TODO
1. ✅Optimize performance (memory usage, subchunk allocation) of the `.meshes` converter.
1. 🟡Support complex materials. (Per-vertex 4-material blend is written into GEO0 vertices and validated byte-exact against real assets; note the *visible* material comes from the LOD0 submeshes, which are not emitted yet — see below.)
1. 🟡Support cloud rendering and collision. (GEO0 collision/CPU-side data incl. cloud chunks is produced. True fluffy-cloud *rendering* is a separate volumetric `CloudData` subsystem — SDF voxel bins + a 20-byte cloud mesh — not GEO0 chunks, and is out of scope.)
2. ✅Support 0x3D version of `.meshes`.
3. ✅Fix incorrect object reference of `.level.bin`.

### Rendering — LOD0 geometry is now emitted
The game builds its rendered mesh from the **LOD0 segment** (per-LOD meshopt-compressed submeshes), not from GEO0 (which is CPU-side collision/streaming data). The converter now writes a real LOD0 block: the mesh is packed into 16-bit-indexed submeshes (≤65535 verts each), meshopt-encoded (vertex codec `0xA0`, index codec `0xE0`), and wrapped in a raw LZ4 block — the exact framing the loader expects. GEO0 is still emitted for collision.

Remaining caveats:
- **In-game visual confirmation pending.** The LOD0 structure and meshopt/LZ4 framing are validated against the real `CandleSpace/BstBaked.meshes` (LZ4 decode + codec headers match); the meshopt vertex codec is proven byte-compatible. The exact meaning of render-vertex bytes 12–35 (normal/uv/material/possibly bone indices) is reused from the GEO0 layout and not yet confirmed in-game.
- **Material binding not emitted.** `materialBindingCount` is written as 0, so LOD geometry renders with a default/engine material; per-material binding (the complex section-[A] remap table) is not reversed/emitted yet.
- **LZ4 is literal-only** (no match search), so LOD segments are not size-optimized. Functionally valid; real compression is a later optimization.

## Installation
```sh
npm i @that-sky-project/that-sky-level -g
```

## Usage
### Convert from `.obj` to `.meshes`
Before using the software, the Wavefront .obj file should be prepared. It's recommended to build files with Blender.

Most modeling formats use face materials, but `.meshes` stores data using vertex materials with weights. Therefore, this converter makes some simplifications when exporting to formats like `.obj` that do not support vertex colors, which may result in incorrect material output.

It is recommended to edit raw models with [Blender](https://www.blender.org/). Example operations are as follows:

![blender_edit_obj_model](./docs/img/blender_edit_obj_model.png)

The material name must start with `kMaterial_`. A complete material table can be found [here](./docs/materials.md).

While export the model as `Wavefront (.obj)` format, the model can be converted to `.meshes` with the command below.

```
node main.js --convert -i <model path> -o <output file>
```

The exported file defaults to version 0x3C, which may be incompatible with the latest version of the game.
