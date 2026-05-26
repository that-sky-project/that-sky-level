const { kMaterial } = require("../enums/kMaterial.js");
const {
  TriangleMeshVertex,
  TriangleMeshFace,
  TriangleMeshMaterial,
  TriangleMesh
} = require("../formats/triangleMesh.js");
const {
  LevelGeo,
  LevelGeoMeshVertex,
  LevelGeoMeshVertexMaterial,
  LevelGeoChunk,
  LevelGeoSubchunk
} = require("./meshes/levelGeo.js");
const { R8G8B8A8_SNORM, R8G8B8A8_UNORM } = require("../utils/normVec.js");
const { Vec3 } = require("../utils/vector.js");

/**
 * Build a deduplication key from a vertex's geometry AND material.
 * Vertices with identical geometry but different materials are treated as
 * distinct entries, which places them in contiguous per-material ranges
 * inside each subchunk — exactly what the GEO format requires.
 *
 * @param {LevelCvtVertex} vtx
 * @returns {string}
 */
function vtxHash(vtx) {
  const { x, y, z } = vtx.pos;
  const { x: nx, y: ny, z: nz } = vtx.normal;
  const matName = vtx.materialRef ? vtx.materialRef.name : "";
  return `${x},${y},${z}|${nx},${ny},${nz}|${matName}`;
}

class LevelCvtVertex extends TriangleMeshVertex {
  /**
   * @param {TriangleMeshVertex} vtx
   */
  constructor(vtx) {
    super();
    this.pos = vtx.pos;
    this.normal = vtx.normal;
    this.materialRef = TriangleMeshMaterial.Null;
  }
}

class LevelCvtFace extends TriangleMeshFace {
  /**
   * @param {TriangleMeshFace} face
   */
  constructor(face) {
    super();
    this.materialRef = face.materialRef;
    this.indices = face.indices.slice(0, 3);
    this.vertices = [];
  }

  /**
   * Populate this.vertices with per-face copies of the referenced vertices,
   * each tagged with this face's material.
   *
   * Using copies (rather than mutating the shared vtxBuffer entry) prevents
   * later faces from overwriting the material of vertices assigned earlier.
   *
   * @param {LevelCvtVertex[]} vtxBuffer
   * @returns {this}
   */
  from(vtxBuffer) {
    const mat = this.materialRef;
    this.vertices = this.indices.map(function (idx) {
      const copy = new LevelCvtVertex(vtxBuffer[idx]);
      copy.materialRef = mat;
      return copy;
    });
    return this;
  }
}

class LevelCvtChunk extends LevelGeoChunk {
  constructor() {
    super();
    this.faces = [];
    /** @type {Map<string, { vtx: LevelCvtVertex, localIdx: number }>} */
    this.vertices = new Map(); // vtxKey → { vtx, provisional localIdx }
  }
}

class LevelCvt {
  /**
   * @param {TriangleMesh} mesh
   */
  constructor(mesh) {
    this.mesh = mesh;
    /** @type {LevelCvtVertex[]} */
    this.vtxBuffer = [];
    /** @type {LevelCvtFace[]} */
    this.faces = [];
    /** @type {LevelCvtChunk[]} */
    this.chunks = [];
  }

  initialize() {
    this.vtxBuffer = this.mesh.vtxBuffer.map(vtx => new LevelCvtVertex(vtx));
    this.faces = this.mesh.cmdBuffer
      .filter(face => face.indices.length >= 3)
      .map(face => new LevelCvtFace(face).from(this.vtxBuffer));
  }

  /**
   * Greedy linear sweep.
   *
   * Hard limits per chunk (all fields are uint8 in the binary format):
   *   • ≤ 255 triangles  (subchunk.triangleEnd must fit in u8)
   *   • ≤ 255 vertices   (chunk.vtxCount is u8; local indices are u8)
   *
   * Because vtxKey encodes the material, the same geometric vertex used by
   * two different materials contributes two separate entries — matching the
   * GEO layout where each subchunk owns a contiguous, non-overlapping slice
   * of the chunk's vertex buffer.
   */
  assignChunks() {
    this.chunks = [];
    let idxFace = 0;

    while (idxFace < this.faces.length) {
      const chunk = new LevelCvtChunk();

      while (idxFace < this.faces.length) {
        const face = this.faces[idxFace];

        // Count how many genuinely new (key-distinct) vertices this face adds.
        let newVtxCount = 0;
        for (const vtx of face.vertices) {
          if (!chunk.vertices.has(vtxHash(vtx))) newVtxCount++;
        }

        // Enforce per-chunk limits.
        if (chunk.faces.length >= 255 || chunk.vertices.size + newVtxCount > 255) break;

        // Commit the face and its vertices to the chunk.
        for (const vtx of face.vertices) {
          const key = vtxHash(vtx);
          if (!chunk.vertices.has(key)) {
            chunk.vertices.set(key, { vtx, localIdx: chunk.vertices.size });
          }
        }
        chunk.faces.push(face);
        idxFace++;
      }

      if (chunk.faces.length > 0) this.chunks.push(chunk);
    }
  }

  /**
   * Build and return a fully populated LevelGeo from the chunked face list.
   *
   * Inside each chunk, faces are first grouped by material.  Vertices are
   * emitted material-by-material so that every subchunk's vtxStart/vtxEnd
   * describes a contiguous slice — exactly the invariant the runtime expects.
   *
   * @returns {LevelGeo}
   */
  toGeo() {
    const geo = new LevelGeo();

    let globalVtxOffset = 0;
    let globalIdxOffset = 0;
    let globalSubchunkOffset = 0;

    for (const chunk of this.chunks) {
      // Group faces by material (preserve encounter order).
      /** @type {Map<string, { mat: TriangleMeshMaterial, faces: LevelCvtFace[] }>} */
      const byMaterial = new Map();
      for (const face of chunk.faces) {
        const matKey = face.materialRef ? face.materialRef.name : "";
        if (!byMaterial.has(matKey)) {
          byMaterial.set(matKey, { mat: face.materialRef, faces: [] });
        }
        byMaterial.get(matKey).faces.push(face);
      }

      // Per-chunk build buffers.
      /** @type {LevelGeoMeshVertex[]} */
      const chunkVerts = [];
      /** @type {number[]} */  // uint8 local indices
      const chunkIndices = [];
      /** @type {LevelGeoSubchunk[]} */
      const chunkSubchunks = [];

      // vtxKey to chunk-local index (across all materials in this chunk).
      const localVtxMap = new Map();

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      // Iterate by material
      for (const { mat, faces } of byMaterial.values()) {
        const matId = mat ? (mat.getId() || kMaterial.Cliff) : kMaterial.Cliff;

        // Subchunk vertex range starts at current end of chunkVerts.
        const subVtxStart = chunkVerts.length;

        // Emit vertices for this material group.
        // Because vtxKey encodes the material, no entry added here can
        // collide with an entry from a different material, guaranteeing
        // a contiguous vertex range for this subchunk.
        for (const face of faces) {
          for (const vtx of face.vertices) {
            const key = vtxHash(vtx);
            if (localVtxMap.has(key)) continue;

            const localIdx = chunkVerts.length;
            localVtxMap.set(key, localIdx);

            // Build LevelGeoMeshVertex.
            const geoVtx = new LevelGeoMeshVertex();

            geoVtx.pos = vtx.pos;
            geoVtx.normal = new R8G8B8A8_SNORM(vtx.normal.x, vtx.normal.y, vtx.normal.z, 0);

            const geoMat = new LevelGeoMeshVertexMaterial();
            geoMat.materials[0] = matId;
            // Full weight for primary material.
            geoMat.weights[0] = 1.0;
            geoVtx.material = geoMat;

            // input2/3/4 are currently unknown, use default values instead.
            geoVtx.input2 = new R8G8B8A8_UNORM(0.99, 0.1, 0.99, 0.99);
            geoVtx.input3 = new R8G8B8A8_UNORM(0.5, 0.5, 0.5, 0.5);
            geoVtx.input4 = new R8G8B8A8_UNORM(0.04, 0.004, 0.004, 0.004);

            chunkVerts.push(geoVtx);

            // Grow AABB.
            const { x, y, z } = vtx.pos;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
        }

        const subVtxEnd = chunkVerts.length - 1;

        // Subchunk triangle range starts at current triangle count.
        // (triangleStart / triangleEnd) count full triangles, not raw indices.
        const subTriStart = chunkIndices.length / 3;

        // Emit local indices for this material's triangles.
        for (const face of faces) {
          for (const vtx of face.vertices) {
            chunkIndices.push(localVtxMap.get(vtxHash(vtx)));
          }
        }

        const subTriEnd = chunkIndices.length / 3 - 1;

        // Build subchunk descriptor.
        const subchunk = new LevelGeoSubchunk();
        subchunk.materialId = matId;
        subchunk.vtxStart = subVtxStart;
        subchunk.vtxEnd = subVtxEnd;
        subchunk.vtxCount = subVtxEnd - subVtxStart + 1;
        subchunk.triangleStart = subTriStart;
        subchunk.triangleEnd = subTriEnd;
        subchunk.triangleCount = faces.length;
        chunkSubchunks.push(subchunk);
      }

      // Build chunk descriptor.
      const geoChunk = new LevelGeoChunk();
      geoChunk.vtxStart = globalVtxOffset;
      geoChunk.idxStart = globalIdxOffset;
      geoChunk.subchunkStart = globalSubchunkOffset;
      geoChunk.vtxCount = chunkVerts.length;
      geoChunk.idxCount = chunkIndices.length;
      geoChunk.subchunkCount = chunkSubchunks.length;
      geoChunk.min = new Vec3(minX, minY, minZ);
      geoChunk.max = new Vec3(maxX, maxY, maxZ);

      // Append to global buffers.
      for (const v of chunkVerts) geo.vertices.push(v);
      for (const i of chunkIndices) geo.localIndices.push(i);
      for (const sc of chunkSubchunks) geo.subchunks.push(sc);
      geo.chunks.push(geoChunk);

      globalVtxOffset += chunkVerts.length;
      globalIdxOffset += chunkIndices.length;
      globalSubchunkOffset += chunkSubchunks.length;
    }

    // Fill top-level counts.
    geo.vertexCount = geo.vertices.length;
    geo.indexCount = geo.localIndices.length;
    geo.chunkCount = geo.chunks.length;
    geo.cloudChunkCount = 0;
    geo.subchunkCount = geo.subchunks.length;

    return geo;
  }

  /**
   * Run all three phases and return the finished LevelGeo.
   * @returns {LevelGeo}
   */
  convert() {
    this.initialize();
    this.assignChunks();
    return this.toGeo();
  }
}

module.exports = {
  LevelCvtVertex,
  LevelCvtFace,
  LevelCvtChunk,
  LevelCvt
};