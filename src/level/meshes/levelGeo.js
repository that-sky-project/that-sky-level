const MeshoptDecoder = require("../../meshopt/meshopt_decoder.js");
const MeshoptEncoder = require("../../meshopt/meshopt_encoder.js");
const { WritableBinaryStream, ReadOnlyBinaryStream } = require("../../utils/binaryStream.js");
const { IBinarying } = require("../../utils/helperClasses.js");
const { R8G8B8A8_SNORM, R8G8B8A8_UNORM } = require("../../utils/normVec.js");
const { Vec3 } = require("../../utils/vector.js");

class LevelGeoMeshVertexMaterial extends IBinarying {
  constructor() {
    super();
    this.materials = [];
    this.weights = [];
  }

  setMaterial(material, weight) {
    this.materials[0] = material || 0;
    this.weights[0] = weight || 0;
  }

  fromStream(stream) {
    this.materials = [];
    this.weights = [];
    for (var i = 0; i < 4; i++)
      this.materials[i] = stream.readUint8();
    for (var i = 0; i < 4; i++)
      this.weights[i] = stream.readUint8() / 255;
  }

  toStream(stream) {
    for (var i = 0; i < 4; i++)
      stream.writeUint8(this.materials[i] || 0);
    for (var i = 0; i < 4; i++)
      stream.writeUint8((this.weights[i] || 0) * 255);
  }
}

// A vertex can hold up to 4 different materials.
class LevelGeoMeshVertex extends IBinarying {
  constructor() {
    super();
    this.pos = new Vec3();
    this.normal = new R8G8B8A8_SNORM();
    this.material = new LevelGeoMeshVertexMaterial();
    this.input2 = new R8G8B8A8_UNORM();
    this.input3 = new R8G8B8A8_UNORM();
    this.input4 = new R8G8B8A8_UNORM();
  }

  fromStream(stream) {
    this.pos = stream.readType(Vec3);
    this.normal = stream.readType(R8G8B8A8_SNORM);
    this.material = stream.readType(LevelGeoMeshVertexMaterial);
    this.input2 = stream.readType(R8G8B8A8_UNORM);
    this.input3 = stream.readType(R8G8B8A8_UNORM);
    this.input4 = stream.readType(R8G8B8A8_UNORM);
  }

  toStream(stream) {
    stream.writeType(this.pos);
    stream.writeType(this.normal);
    stream.writeType(this.material);
    stream.writeType(this.input2);
    stream.writeType(this.input3);
    stream.writeType(this.input4);
  }
}

// An subchunk represents a vertex range where all vertices share a certain material.
// The same vertex can appear in different subchunks if it has the material specified
// by that subchunk.
class LevelGeoSubchunk extends IBinarying {
  constructor() {
    super();

    this.materialId = 0;

    this.triangleCount = 0;
    this.vtxCount = 0;

    // Indices index / 3.
    this.triangleStart = 0;
    this.triangleEnd = 0;

    this.vtxStart = 0;
    this.vtxEnd = 0;
  }

  fromStream(stream) {
    this.materialId = stream.readUint8();

    this.triangleCount = stream.readUint8();
    this.vtxCount = stream.readUint8();

    this.triangleStart = stream.readUint8();
    this.triangleEnd = stream.readUint8();

    this.vtxStart = stream.readUint8();
    this.vtxEnd = stream.readUint8();

    stream.readUint8();
  }

  toStream(stream) {
    stream.writeUint8(this.materialId);

    stream.writeUint8(this.triangleCount);
    stream.writeUint8(this.vtxCount);

    stream.writeUint8(this.triangleStart);
    stream.writeUint8(this.triangleEnd);

    stream.writeUint8(this.vtxStart);
    stream.writeUint8(this.vtxEnd);

    stream.writeUint8(0);
  }
}

// A chunk holds a series of triangle faces, representing a terrain chunk. Chunks
// contain AABB bounding boxes and chunks are the smallest unit for computing
// CollisionGeo.
class LevelGeoChunk extends IBinarying {
  constructor() {
    super();

    this.vtxStart = 0;
    this.idxStart = 0;
    this.subchunkStart = 0;

    this.idxCount = 0;
    this.vtxCount = 0;
    this.subchunkCount = 0;

    this.min = new Vec3();
    this.max = new Vec3();
  }

  fromStream(stream) {
    this.vtxStart = stream.readUint32();
    this.idxStart = stream.readUint32();
    this.subchunkStart = stream.readUint32();

    this.idxCount = stream.readUint16();
    this.vtxCount = stream.readUint8();
    this.subchunkCount = stream.readUint8();

    this.min = stream.readType(Vec3);
    this.max = stream.readType(Vec3);

    stream.readUint32();
    stream.readUint32();
    stream.readUint32();
    stream.readUint32();
  }

  toStream(stream) {
    stream.writeUint32(this.vtxStart);
    stream.writeUint32(this.idxStart);
    stream.writeUint32(this.subchunkStart);

    stream.writeUint16(this.idxCount);
    stream.writeUint8(this.vtxCount);
    stream.writeUint8(this.subchunkCount);

    stream.writeType(this.min);
    stream.writeType(this.max);

    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
  }
}

class LevelGeo extends IBinarying {
  constructor() {
    super();

    // Counts.
    this.indexCount = 0;
    this.vertexCount = 0;
    this.chunkCount = 0;
    this.cloudChunkCount = 0;
    this.subchunkCount = 0;

    this.localIndices = [];
    this.vertices = [];
    this.chunks = [];
    this.subchunks = [];
  }

  fromStream(stream) {
    this.indexCount = stream.readUint32()
    this.vertexCount = stream.readUint32()
    this.chunkCount = stream.readUint32()
    this.cloudChunkCount = stream.readUint32()
    this.subchunkCount = stream.readUint32();

    // Read vertices.
    this.vertices = [];
    if (this.vertexCount) {
      var compressedSize = stream.readUint32()
        , data = stream.readBytes(compressedSize);

      var t = Buffer.alloc(this.vertexCount * 36);
      MeshoptDecoder.decodeVertexBuffer(t, this.vertexCount, 36, data);

      var s = new ReadOnlyBinaryStream(t);
      for (var i = 0; i < this.vertexCount; i++)
        this.vertices.push(s.readType(LevelGeoMeshVertex));
    }

    // Read indices.
    this.localIndices = [];
    for (var i = 0; i < this.indexCount; i++)
      this.localIndices.push(stream.readUint8());

    // Read groups.
    this.chunks = [];
    for (var i = 0; i < this.chunkCount; i++)
      this.chunks.push(stream.readType(LevelGeoChunk));

    // Read areas.
    this.subchunks = [];
    for (var i = 0; i < this.subchunkCount; i++)
      this.subchunks.push(stream.readType(LevelGeoSubchunk));
  }

  toStream(stream) {
    stream.writeUint32(this.indexCount);
    stream.writeUint32(this.vertexCount);
    stream.writeUint32(this.chunkCount);
    stream.writeUint32(this.cloudChunkCount);
    stream.writeUint32(this.subchunkCount);

    // Write vertices.
    if (this.vertices.length) {
      var t = new WritableBinaryStream();
      for (var v of this.vertices)
        t.writeType(v);

      var data = MeshoptEncoder.encodeVertexBuffer(t.data(), this.vertices.length, 36);
      stream.writeUint32(data.byteLength);
      stream.writeBytes(data);
    }

    // Write indices.
    for (var idx of this.localIndices)
      stream.writeUint8(idx);

    // Write groups.
    for (var group of this.chunks)
      stream.writeType(group);

    // Write areas.
    for (var area of this.subchunks)
      stream.writeType(area);
  }
}

module.exports = {
  LevelGeoMeshVertexMaterial,
  LevelGeoMeshVertex,
  LevelGeoSubchunk,
  LevelGeoChunk,
  LevelGeo
};
