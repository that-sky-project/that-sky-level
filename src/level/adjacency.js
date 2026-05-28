/**
 * Simple breadth first chunk allocation.
 * 
 * Copyright (c) 2026 That Sky Project
 * 
 * This program is released under LGPL 2.1, Refer to LICENSE for further
 * informations.
 * 
 * TODO: Reduce the memory usage of the allocation.
 */

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

class LevelCvtAdjacencyVertex extends TriangleMeshVertex {
  /**
   * Create the vertex from another vertex.
   * @param {TriangleMeshVertex} vtx 
   */
  constructor(vtx) {
    super();

    this.normal = vtx.normal;
    this.pos = vtx.pos;
    this.materialRef = TriangleMeshMaterial.Null;
    this.faces = new Set();
    this.nearby = vtx.nearby;
  }

  /**
   * @param {LevelCvtAdjacencyFace} face 
   * @returns {this}
   */
  assign(face) {
    this.materialRef = face.materialRef;
    this.faces.add(face);
    return this;
  }
}

class LevelCvtAdjacencyFace extends TriangleMeshFace {
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
   * Assign vertices from given buffer.
   * @param {LevelCvtAdjacencyVertex[]} vtxBuffer 
   * @returns {this}
   */
  from(vtxBuffer) {
    var self = this;
    this.vertices = this.indices.map(function (idx) {
      // Assign a vertex to the face.
      return vtxBuffer[idx].assign(self);
    });
    return this;
  }

  /**
   * Check whether the face has a material.
   * @param {TriangleMeshMaterial} material 
   * @returns {boolean}
   */
  has(material) {
    return this.vertices.some((vtx) => vtx.materialRef == material);
  }
}

class LevelCvtAdjacencyChunk extends LevelGeoChunk {
  constructor() {
    super();

    this.vertices = new Map();
    this.materials = new Set();
    this.idxBuffer = [];
    this.vtxBuffer = [];
    this.subBuffer = [];
  }

  update() {
    this.idxCount = this.idxBuffer.length;
    this.vtxCount = this.vtxBuffer.length;
    this.subchunkCount = this.subBuffer.length;

    var min = new Vec3(Infinity, Infinity, Infinity)
      , max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (var vtx of this.vtxBuffer) {
      min.x = Math.min(min.x, vtx.pos.x);
      min.y = Math.min(min.y, vtx.pos.y);
      min.z = Math.min(min.z, vtx.pos.z);
      max.x = Math.max(max.x, vtx.pos.x);
      max.y = Math.max(max.y, vtx.pos.y);
      max.z = Math.max(max.z, vtx.pos.z);
    }
    this.min = min.sub(new Vec3(0.1, 0.1, 0.1));
    this.max = max.add(new Vec3(0.1, 0.1, 0.1));
  }

  /**
   * @param {LevelCvtAdjacencyFace} face 
   * @returns {boolean}
   */
  tryAddFace(face) {
    if (this.idxBuffer.length + 3 > 756)
      return false;

    var newVtxCount = [];
    for (var vtx of face.vertices)
      if (!this.vertices.has(vtx))
        newVtxCount++;

    if (this.vtxBuffer.length + newVtxCount > 252)
      return false;

    for (var vtx of face.vertices) {
      var idx;
      if (!this.vertices.has(vtx)) {
        idx = this.vtxBuffer.length;
        this.vertices.set(vtx, idx);
        this.vtxBuffer.push(vtx);
      } else {
        idx = this.vertices.get(vtx);
      }
      this.idxBuffer.push(idx);
      this.materials.add(vtx.materialRef);
    }

    return true;
  }
}

class LevelCvtAdjacencySubchunk extends LevelGeoSubchunk {
  constructor() {
    super();
  }
}

class LevelCvtAdjacency {
  constructor(mesh) {
    // - Mesh data.
    this.meshVtx = new Set();
    this.meshFaces = new Set();

    // - Conversion data.
    this.vtxBuffer = [];
    this.idxBuffer = [];
    this.chunks = [];
    this.subchunks = [];
  }

  /**
   * Initialize buffers.
   * @param {TriangleMesh} mesh 
   */
  initialize(mesh) {
    var self = this
      , cvtMap = new Map()
      , vtxBuffer;

    // Set vertex buffer.
    vtxBuffer = mesh.vtxBuffer.map(function (vtx) {
      var cvtVtx = new LevelCvtAdjacencyVertex(vtx);
      cvtMap.set(vtx, cvtVtx);
      return cvtVtx;
    });
    vtxBuffer.forEach(function (vtx) {
      var nearby = new Set();
      vtx.nearby.forEach(function (v) {
        nearby.add(cvtMap.get(v))
      });
      vtx.nearby = nearby;
    });
    this.meshVtx = new Set(vtxBuffer);

    // Set face buffer.
    this.meshFaces = new Set(mesh.cmdBuffer.map(function (face) {
      // Push vertices and set material of vertices.
      return new LevelCvtAdjacencyFace(face).from(vtxBuffer);
    }));
  }

  /**
   * Assign vertices into chunks.
   */
  convert() {
    var unprocessedVtx = new Set(this.meshVtx)
      , visitedFace = new Set()
      , geo = new LevelGeo();

    while (unprocessedVtx.size) {
      var chunk = this.assignChunk(unprocessedVtx.values().next().value, unprocessedVtx, visitedFace);
      this.assignSubChunk(chunk);
      chunk.update();
      this.chunks.push(chunk);
    }

    var localIndices = []
      , vertices = []
      , subchunks = [];

    for (var chunk of this.chunks) {
      chunk.idxStart = localIndices.length;
      chunk.vtxStart = vertices.length;
      chunk.subchunkStart = subchunks.length;

      localIndices.push(...chunk.idxBuffer);
      vertices.push(...chunk.vtxBuffer.map(function (vtx) {
        var r = new LevelGeoMeshVertex();
        r.pos = vtx.pos;
        r.normal = vtx.normal;
        r.material.setMaterial(vtx.materialRef.getId(), 1);
        r.input2 = new R8G8B8A8_UNORM(0.99, 0.99, 0.99, 0.99);
        r.input3 = new R8G8B8A8_UNORM(0.5, 0.5, 0.5, 0.5);
        r.input4 = new R8G8B8A8_UNORM(0.04, 0.004, 0.004, 0.004);
        return r;
      }));
      subchunks.push(...chunk.subBuffer);
    }

    geo.cloudChunkCount = 0;

    geo.indexCount = localIndices.length;
    geo.vertexCount = vertices.length;
    geo.chunkCount = this.chunks.length;
    geo.subchunkCount = subchunks.length;

    geo.localIndices = localIndices;
    geo.vertices = vertices;
    geo.chunks = this.chunks;
    geo.subchunks = subchunks;

    return geo;
  }

  /**
   * @param {LevelCvtAdjacencyVertex} start 
   * @param {Set<LevelCvtAdjacencyVertex>} unprocessedVtx 
   * @param {Set<LevelCvtAdjacencyFace>} visitedFace
   * @returns {LevelCvtAdjacencyChunk}
   */
  assignChunk(start, unprocessedVtx, visitedFace) {
    function updateNextLoop(nextLoopVtx, face) {
      unprocessedVtx.has(face.vertices[0]) && nextLoopVtx.add(face.vertices[0]);
      unprocessedVtx.has(face.vertices[1]) && nextLoopVtx.add(face.vertices[1]);
      unprocessedVtx.has(face.vertices[2]) && nextLoopVtx.add(face.vertices[2]);
    }

    function selectFace(vtx) {
      var faces = new Set();
      for (var v of vtx.nearby)
        for (var f of v.faces)
          faces.add(f);
      return faces;
    }

    var recursiveVtx = new Set([start])
      , chunk = new LevelCvtAdjacencyChunk()
      , done = false;

    // The first loop, iterates until the current chunk is fully allocated.
    while (!done) {
      // Record the vertices selected when entering the loop this time.
      var nextLoopVtx = new Set();

      // The second loop, iterates over the currently selected vertices.
      for (var vtx of recursiveVtx) {
        if (!unprocessedVtx.has(vtx))
          // Skip processed vertices.
          continue;

        // The vertex is assigned, remove from the set.
        unprocessedVtx.delete(vtx);

        // The third loop, select all faces associated with a vertex (and all
        // vertices sharing the same coordinates).
        for (var face of selectFace(vtx)) {
          if (visitedFace.has(face))
            // Skip visited faces.
            continue;

          if (!chunk.tryAddFace(face)) {
            done = true;
            break;
          }

          // The face is assigned in this chunk allocation.
          visitedFace.add(face);
          // Add unvisited vertices of the face to the next loop.
          updateNextLoop(nextLoopVtx, face);
        }

        if (done)
          // Break the loop if the chunk is done.
          break;
      }

      if (!done && !nextLoopVtx.size) {
        // If the chunk is not yet fully allocated but there are no more contiguous
        // vertices available for allocation, select a vertex from a new contiguous
        // patch.
        //
        // If all vertices have already been allocated, return immediately.
        if (!unprocessedVtx.size)
          done = true;
        else
          nextLoopVtx.add(unprocessedVtx.values().next().value);
      }

      recursiveVtx = nextLoopVtx;
    }

    return chunk;
  }

  /**
   * @param {LevelCvtAdjacencyChunk} chunk 
   */
  assignSubChunk(chunk) {
    for (var material of chunk.materials) {
      var subchunk = new LevelCvtAdjacencySubchunk()
        , materialId = kMaterial[material.name.substring(10)] || kMaterial.Cliff;

      subchunk.materialId = materialId;
      subchunk.triangleStart = 0;
      subchunk.triangleCount = chunk.idxBuffer.length / 3;
      subchunk.triangleEnd = subchunk.triangleCount - 1;
      subchunk.vtxStart = 0;
      subchunk.vtxCount = chunk.vtxBuffer.length;
      subchunk.vtxEnd = subchunk.vtxCount - 1;

      chunk.subBuffer.push(subchunk);
    }
  }
}

module.exports = {
  LevelCvtAdjacencyVertex,
  LevelCvtAdjacencyFace,
  LevelCvtAdjacencyChunk,
  LevelCvtAdjacencySubchunk,
  LevelCvtAdjacency
};
