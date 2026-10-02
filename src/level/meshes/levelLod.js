const MeshoptEncoder = require("../../meshopt/meshopt_encoder.js");
const { WritableBinaryStream, ReadOnlyBinaryStream } = require("../../utils/binaryStream.js");
const { IBinarying } = require("../../utils/helperClasses.js");
const lz4 = require("../../utils/lz4.js");

// Max size the game's loader will decompress a LOD segment into (12 MiB).
const kMaxDecompressed = 0xC00000;

/**
 * The LOD0 segment holds the geometry the game actually renders. Its payload
 * is a single raw LZ4 block that decompresses to:
 *
 *   u32 materialBindingCount           // section [A] (CPU-side material remap)
 *   ... (A entries)                    //   emitted as 0 by this writer
 *   u32 gateCount                      // section [B] (collision/portal gate)
 *   ... (B body if gateCount != 0)     //   emitted as 0 by this writer
 *   u32 submeshCount                   // section [C] — the render geometry
 *   repeat: u32 vtxCount; u32 vBlobLen; meshopt-vtx[vBlobLen] (0xA0, 36B stride)
 *           u32 idxCount; u32 iBlobLen; meshopt-idx[iBlobLen] (0xE0, 16-bit)
 *   u32 trailingCount                  // section [D] — emitted as 0
 *
 * Reading a real level keeps the original compressed segment verbatim (`raw`)
 * so it can be written back unchanged; the converter instead supplies
 * submeshes via setSubmeshes().
 */
class LevelLod extends IBinarying {
  constructor() {
    super();
    // { vtxCount, vertexBlob: Buffer, idxCount, indexBlob: Buffer }
    this.submeshes = [];
    // Original compressed segment, kept for verbatim passthrough on read.
    this.raw = null;
  }

  /**
   * Supply render submeshes from the converter and meshopt-encode them.
   * @param {{vtxCount:number, vertexRaw:Buffer, indices:Uint16Array}[]} list
   */
  setSubmeshes(list) {
    this.submeshes = list.map(function (sm) {
      var idxBytes = Buffer.from(sm.indices.buffer, sm.indices.byteOffset, sm.indices.byteLength);
      return {
        vtxCount: sm.vtxCount,
        vertexBlob: Buffer.from(MeshoptEncoder.encodeVertexBuffer(sm.vertexRaw, sm.vtxCount, 36)),
        idxCount: sm.indices.length,
        indexBlob: Buffer.from(MeshoptEncoder.encodeIndexBuffer(idxBytes, sm.indices.length, 2))
      };
    });
    this.raw = null;
  }

  /** Assemble the decompressed [A][B][C][D] stream from current submeshes. */
  _buildStream() {
    var s = new WritableBinaryStream();
    s.writeUint32(0);                       // [A] materialBindingCount
    s.writeUint32(0);                       // [B] gateCount
    s.writeUint32(this.submeshes.length);   // [C] submeshCount
    for (var sm of this.submeshes) {
      s.writeUint32(sm.vtxCount);
      s.writeUint32(sm.vertexBlob.length);
      s.writeBytes(sm.vertexBlob);
      s.writeUint32(sm.idxCount);
      s.writeUint32(sm.indexBlob.length);
      s.writeBytes(sm.indexBlob);
    }
    s.writeUint32(0);                       // [D] trailingCount
    return s.data();
  }

  toStream(stream) {
    if (this.submeshes.length) {
      stream.writeBytes(lz4.compressBlock(this._buildStream()));
    } else if (this.raw) {
      // Verbatim passthrough of a level read from disk.
      stream.writeBytes(this.raw);
    } else {
      // Empty but structurally valid LOD (no geometry).
      stream.writeBytes(lz4.compressBlock(this._buildStream()));
    }
  }

  fromStream(stream) {
    this.raw = stream.readBytes(stream.getRemain());
    this.submeshes = [];

    // Light-parse only the simple form this tool emits (empty [A]/[B]). Real
    // levels use a non-trivial material-binding section that is not decoded
    // here; their segment is preserved via `raw` for passthrough.
    try {
      var dec = lz4.decompressBlock(this.raw, kMaxDecompressed);
      var r = new ReadOnlyBinaryStream(dec);
      if (r.readUint32() !== 0 || r.readUint32() !== 0)
        return;
      var count = r.readUint32();
      for (var i = 0; i < count; i++) {
        var vtxCount = r.readUint32()
          , vBlobLen = r.readUint32()
          , vertexBlob = r.readBytes(vBlobLen)
          , idxCount = r.readUint32()
          , iBlobLen = r.readUint32()
          , indexBlob = r.readBytes(iBlobLen);
        this.submeshes.push({ vtxCount, vertexBlob, idxCount, indexBlob });
      }
    } catch (e) {
      this.submeshes = [];
    }
  }
}

module.exports = {
  LevelLod
};
