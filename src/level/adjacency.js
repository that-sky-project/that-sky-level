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

const { kMaterial } = require("./enums/kMaterial.js");
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
const { WritableBinaryStream } = require("../utils/binaryStream.js");

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
    this.activeSubchunks = new Map();
    this.idxBuffer = [];
    this.vtxBuffer = [];
    this.subBuffer = [];
  }

  /**
   * @param {LevelCvtAdjacencySubchunk} subchunk 
   * @param {TriangleMeshMaterial} material 
   */
  beginSubchunk(subchunk, material) {
    subchunk.materialId = material.getId() || kMaterial.Cliff;
    subchunk.triangleStart = this.idxBuffer.length / 3;
    subchunk.triangleCount = 1;
    subchunk.vtxStart = 0;
  }

  /**
   * @param {LevelCvtAdjacencySubchunk} subchunk 
   */
  endSubchunk(subchunk) {
    subchunk.triangleEnd = subchunk.triangleStart + subchunk.triangleCount - 1;
    subchunk.vtxCount = this.vtxBuffer.length;
    subchunk.vtxEnd = subchunk.vtxStart + subchunk.vtxCount - 1;
  }

  /**
   * Mark the chunk as allocated.
   */
  done() {
    for (var subchunk of this.activeSubchunks.values()) {
      this.endSubchunk(subchunk);
      this.subBuffer.push(subchunk);
    }
    this.activeSubchunks.clear();

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
   * TODO: Support multi-material of single vertex.
   * @param {LevelCvtAdjacencyFace} face 
   * @returns {boolean}
   */
  tryAssignActiveSubchunk(face) {
    function addMaterial(material) {
      if (!self.activeSubchunks.has(material)) {
        var subchunk = new LevelCvtAdjacencySubchunk();
        self.beginSubchunk(subchunk, material);
        self.activeSubchunks.set(material, subchunk);
      }
    }

    var self = this;

    if (this.subBuffer.length + this.activeSubchunks.size > 252)
      return false;

    // Remove sub-chunks that specify materials not present on the current
    // face from active list.
    for (var m of this.activeSubchunks.keys()) {
      if (
        m != face.vertices[0].materialRef
        && m != face.vertices[1].materialRef
        && m != face.vertices[2].materialRef
      ) {
        var subchunk = this.activeSubchunks.get(m);
        this.endSubchunk(subchunk);
        this.subBuffer.push(subchunk);
        this.activeSubchunks.delete(m);
      } else {
        this.activeSubchunks.get(m).triangleCount++;
      }
    }

    addMaterial(face.vertices[0].materialRef);
    addMaterial(face.vertices[1].materialRef);
    addMaterial(face.vertices[2].materialRef);

    return true;
  }

  /**
   * @param {LevelCvtAdjacencyFace} face 
   * @returns {boolean}
   */
  tryAssignActiveSubchunk2(face) {
    function addMaterial(material) {
      if (!self.activeSubchunks.has(material)) {
        var subchunk = new LevelCvtAdjacencySubchunk();
        self.beginSubchunk(subchunk, material);
        self.activeSubchunks.set(material, subchunk);
      }
    }

    var self = this;

    // Remove sub-chunks that specify materials not present on the current
    // face from active list.
    for (var m of this.activeSubchunks.keys()) {
      if (
        m == face.vertices[0].materialRef
        || m == face.vertices[1].materialRef
        || m == face.vertices[2].materialRef
      ) {
        this.activeSubchunks.get(m).triangleCount++;
      }
    }

    addMaterial(face.vertices[0].materialRef);
    addMaterial(face.vertices[1].materialRef);
    addMaterial(face.vertices[2].materialRef);

    return true;
  }

  /**
   * @param {LevelCvtAdjacencyFace} face 
   * @returns {boolean}
   */
  tryAddFace(face) {
    if (this.idxBuffer.length + 3 > 756)
      return false;

    // Count how many of the face's vertices are not yet present in this chunk.
    // Deduplicate within the face so a degenerate triangle cannot overcount.
    var newVtx = null
      , newVtxCount = 0;
    for (var vtx of face.vertices) {
      if (this.vertices.has(vtx))
        continue;
      // Lazily allocate the per-face dedupe set only when needed.
      if (newVtxCount === 0) {
        newVtx = new Set();
        newVtx.add(vtx);
        newVtxCount = 1;
      } else if (!newVtx.has(vtx)) {
        newVtx.add(vtx);
        newVtxCount++;
      }
    }

    // A chunk addresses its vertices with 1-byte local indices, so it can hold
    // at most 256 unique vertices (the file stores vtxCount as u8).
    if (this.vtxBuffer.length + newVtxCount > 252)
      return false;

    if (!this.tryAssignActiveSubchunk(face))
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
    }

    //this.tryAssignActiveSubchunk2(face);

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
   * Build an output geometry vertex from a conversion vertex. Up to 4 weighted
   * materials are derived from the faces sharing the vertex, so a vertex on a
   * boundary between materials blends them. This matches the engine's per-vertex
   * splatting: vertex bytes +16..+19 are material indices and +20..+23 are their
   * weights (both uploaded as live stream-1 attributes).
   * @param {LevelCvtAdjacencyVertex} vtx
   * @param {number} [forcedMaterialId] when set, the vertex is emitted with
   *   this single material at full weight (used for per-material LOD submeshes,
   *   where every vertex of a submesh must share one primary material so the
   *   engine draws the submesh once; mixing materials in a submesh makes the
   *   engine draw it once per material, which z-fights).
   * @returns {LevelGeoMeshVertex}
   */
  buildVertex(vtx, forcedMaterialId) {
    var r = new LevelGeoMeshVertex();
    r.pos = vtx.pos;
    r.normal = vtx.normal;

    if (forcedMaterialId !== undefined) {
      r.material.setMaterial(forcedMaterialId, 1);
      r.input2 = new R8G8B8A8_UNORM(0.99, 0.99, 0.99, 0.99);
      r.input3 = new R8G8B8A8_UNORM(0.5, 0.5, 0.5, 0.5);
      r.input4 = new R8G8B8A8_UNORM(0.04, 0.004, 0.004, 0.004);
      return r;
    }

    // Tally material -> adjacent-face count for this vertex.
    var tally = new Map();
    if (vtx.faces && vtx.faces.size) {
      for (var face of vtx.faces) {
        var id = face.materialRef.getId() || 0;
        tally.set(id, (tally.get(id) || 0) + 1);
      }
    } else {
      tally.set(vtx.materialRef.getId() || 0, 1);
    }

    // Keep the 4 most-represented materials, weighted by face share.
    var ranked = Array.from(tally.entries()).sort(function (a, b) {
      return b[1] - a[1];
    }).slice(0, 4);
    var total = 0;
    for (var i = 0; i < ranked.length; i++) total += ranked[i][1];
    if (!total) total = 1;

    for (var i = 0; i < 4; i++) {
      if (i < ranked.length) {
        r.material.materials[i] = ranked[i][0];
        r.material.weights[i] = ranked[i][1] / total;
      } else {
        r.material.materials[i] = 0;
        r.material.weights[i] = 0;
      }
    }

    r.input2 = new R8G8B8A8_UNORM(0.99, 0.99, 0.99, 0.99);
    r.input3 = new R8G8B8A8_UNORM(0.5, 0.5, 0.5, 0.5);
    r.input4 = new R8G8B8A8_UNORM(0.04, 0.004, 0.004, 0.004);
    return r;
  }

  /**
   * Build render submeshes for the LOD0 segment. Faces are grouped by material
   * (one primary material per submesh) so the engine draws each submesh once;
   * within a material group, faces are packed into 16-bit-indexed submeshes of
   * <=65535 unique vertices.
   * @param {boolean} [flipWinding] reverse each triangle's winding ([0,2,1])
   * @returns {{vtxCount:number, vertexRaw:Buffer, indices:Uint16Array}[]}
   */
  buildLodSubmeshes(flipWinding) {
    return this._submeshesFromFaces(this.meshFaces, flipWinding);
  }

  /**
   * Group a face list by material (one primary material per submesh) and pack
   * each group into <=65535-vertex, 16-bit-indexed submeshes.
   * @param {LevelCvtAdjacencyFace[]} faces
   * @param {boolean} [flipWinding]
   * @returns {object[]}
   */
  _submeshesFromFaces(faces, flipWinding) {
    var byMaterial = new Map();
    for (var face of faces) {
      var matId = face.materialRef.getId() || 0;
      if (!byMaterial.has(matId))
        byMaterial.set(matId, []);
      byMaterial.get(matId).push(face);
    }

    var submeshes = [];
    for (var entry of byMaterial)
      this._packSubmeshes(entry[1], entry[0], submeshes, flipWinding);
    return submeshes;
  }

  /** Diagonal length of the mesh bounding box (for LOD cell sizing). */
  _bboxDiag() {
    var min = new Vec3(Infinity, Infinity, Infinity)
      , max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (var v of this.meshVtx) {
      min.x = Math.min(min.x, v.pos.x); max.x = Math.max(max.x, v.pos.x);
      min.y = Math.min(min.y, v.pos.y); max.y = Math.max(max.y, v.pos.y);
      min.z = Math.min(min.z, v.pos.z); max.z = Math.max(max.z, v.pos.z);
    }
    return max.sub(min).length() || 1;
  }

  /**
   * Grid-cluster vertices into cells of edge `cell` and rebuild faces against
   * one representative vertex per cell (dropping triangles that collapse). A
   * simple decimator for distant LODs (meshopt has no simplifier here).
   * @param {number} cell cell edge length
   * @returns {LevelCvtAdjacencyFace[]} pseudo-faces over representative verts
   */
  _decimate(cell) {
    var cellRep = new Map()   // cell key -> representative vertex
      , repOf = new Map();    // original vertex -> representative vertex

    function rep(v) {
      if (repOf.has(v))
        return repOf.get(v);
      var k = Math.round(v.pos.x / cell) + "_" + Math.round(v.pos.y / cell) + "_" + Math.round(v.pos.z / cell)
        , r = cellRep.get(k);
      if (!r) { r = v; cellRep.set(k, v); }
      repOf.set(v, r);
      return r;
    }

    var out = [];
    for (var face of this.meshFaces) {
      var a = rep(face.vertices[0])
        , b = rep(face.vertices[1])
        , c = rep(face.vertices[2]);
      if (a === b || b === c || a === c)
        continue; // collapsed triangle
      out.push({ vertices: [a, b, c], materialRef: face.materialRef });
    }
    return out;
  }

  /**
   * Build a chain of LOD submesh sets: LOD0 is full detail; each further level
   * is grid-decimated with a coarser cell. A level that collapses to nothing
   * reuses the previous level's geometry.
   * @param {number} count number of LODs (>=1)
   * @param {boolean} [flipWinding]
   * @returns {object[][]} array (per LOD) of submesh arrays
   */
  buildLodChain(count, flipWinding) {
    var chain = [this.buildLodSubmeshes(flipWinding)];
    var diag = this._bboxDiag();
    for (var k = 1; k < (count || 1); k++) {
      var cell = diag * 0.012 * Math.pow(2, k)
        , dfaces = this._decimate(cell)
        , sm = dfaces.length ? this._submeshesFromFaces(dfaces, flipWinding) : [];
      chain.push(sm.length ? sm : chain[chain.length - 1]);
    }
    return chain;
  }

  /**
   * Pack a material group's faces into <=65535-vertex, 16-bit-indexed submeshes.
   * @param {LevelCvtAdjacencyFace[]} faces
   * @param {number} matId primary material id for every vertex in these submeshes
   * @param {object[]} out submesh accumulator
   * @param {boolean} [flipWinding] reverse each triangle's winding
   */
  _packSubmeshes(faces, matId, out, flipWinding) {
    var self = this
      , curMap = new Map()
      , curVerts = []
      , curIdx = [];

    function flush() {
      if (!curIdx.length)
        return;
      var vraw = new WritableBinaryStream();
      for (var k = 0; k < curVerts.length; k++)
        self.buildVertex(curVerts[k], matId).toStream(vraw);
      out.push({
        vtxCount: curVerts.length,
        vertexRaw: vraw.data(),
        indices: Uint16Array.from(curIdx)
      });
      curMap = new Map();
      curVerts = [];
      curIdx = [];
    }

    for (var face of faces) {
      var newv = 0;
      for (var v of face.vertices)
        if (!curMap.has(v))
          newv++;
      if (curVerts.length + newv > 65535)
        flush();
      // Resolve the triangle's three local indices.
      var tri = [];
      for (var v of face.vertices) {
        var idx = curMap.get(v);
        if (idx === undefined) {
          idx = curVerts.length;
          curMap.set(v, idx);
          curVerts.push(v);
        }
        tri.push(idx);
      }
      // Reverse winding when requested (Sky's front-face convention may be the
      // opposite of Wavefront .obj's CCW); otherwise keep the .obj order.
      if (flipWinding)
        curIdx.push(tri[0], tri[2], tri[1]);
      else
        curIdx.push(tri[0], tri[1], tri[2]);
    }
    flush();
  }

  /**
   * Assign vertices into chunks and build the output geometry.
   */
  convert() {
    var geo = new LevelGeo();

    // Partition faces into regular terrain and cloud geometry. Cloud chunks are
    // stored as the trailing `cloudChunkCount` entries of the unified chunk
    // array (the loader allocates one array sized chunkCount + cloudChunkCount).
    var normalFaces = new Set()
      , cloudFaces = new Set();
    for (var face of this.meshFaces) {
      if ((face.materialRef.getId() || 0) === kMaterial.Cloud)
        cloudFaces.add(face);
      else
        normalFaces.add(face);
    }

    var normalChunks = this.allocateChunks(normalFaces)
      , cloudChunks = this.allocateChunks(cloudFaces);

    this.chunks = normalChunks.concat(cloudChunks);

    var localIndices = []
      , vertices = []
      , subchunks = [];

    for (var chunk of this.chunks) {
      chunk.idxStart = localIndices.length;
      chunk.vtxStart = vertices.length;
      chunk.subchunkStart = subchunks.length;

      // Append this chunk's data with explicit loops (avoid `push(...arr)`
      // spreading, which builds a call frame per element on big meshes).
      for (var i = 0; i < chunk.idxBuffer.length; i++)
        localIndices.push(chunk.idxBuffer[i]);
      for (var i = 0; i < chunk.vtxBuffer.length; i++)
        vertices.push(this.buildVertex(chunk.vtxBuffer[i]));
      for (var i = 0; i < chunk.subBuffer.length; i++)
        subchunks.push(chunk.subBuffer[i]);

      // Release the chunk's transient allocation buffers; toStream only needs
      // the start/count/bounds fields set by done(). Keeps peak memory
      // proportional to a single chunk rather than the whole mesh.
      chunk.vertices = null;
      chunk.activeSubchunks = null;
      chunk.idxBuffer = null;
      chunk.vtxBuffer = null;
      chunk.subBuffer = null;
    }

    geo.chunkCount = normalChunks.length;
    geo.cloudChunkCount = cloudChunks.length;
    geo.indexCount = localIndices.length;
    geo.vertexCount = vertices.length;
    geo.subchunkCount = subchunks.length;

    geo.localIndices = localIndices;
    geo.vertices = vertices;
    geo.chunks = this.chunks;
    geo.subchunks = subchunks;

    return geo;
  }

  /**
   * Breadth-first chunk allocation over a subset of faces. Only faces in
   * `faces` are pulled into chunks; vertices shared with other subsets are
   * duplicated into each subset's chunks (vertices are per-chunk anyway).
   * @param {Set<LevelCvtAdjacencyFace>} faces
   * @returns {LevelCvtAdjacencyChunk[]}
   */
  allocateChunks(faces) {
    var chunks = [];
    if (!faces.size)
      return chunks;

    // Vertices participating in this face subset, kept in mesh (parse) order so
    // allocation is deterministic and matches the single-group behaviour.
    var unprocessedVtx = new Set();
    for (var v of this.meshVtx) {
      for (var f of v.faces) {
        if (faces.has(f)) {
          unprocessedVtx.add(v);
          break;
        }
      }
    }
    if (!unprocessedVtx.size)
      return chunks;

    var loop = new Set()
      , visitedFace = new Set();
    loop.add(unprocessedVtx.values().next().value);

    while (unprocessedVtx.size) {
      var chunk = this.assignChunk(loop, unprocessedVtx, visitedFace, faces);
      chunk.done();
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * @param {Set<LevelCvtAdjacencyVertex>} start
   * @param {Set<LevelCvtAdjacencyVertex>} unprocessedVtx
   * @param {Set<LevelCvtAdjacencyFace>} visitedFace
   * @param {Set<LevelCvtAdjacencyFace>} allowedFaces faces eligible for this chunk group
   * @returns {LevelCvtAdjacencyChunk}
   */
  assignChunk(start, unprocessedVtx, visitedFace, allowedFaces) {
    function updateNextLoop(nextLoopVtx, face) {
      unprocessedVtx.has(face.vertices[0]) && nextLoopVtx.add(face.vertices[0]);
      unprocessedVtx.has(face.vertices[1]) && nextLoopVtx.add(face.vertices[1]);
      unprocessedVtx.has(face.vertices[2]) && nextLoopVtx.add(face.vertices[2]);
    }

    function selectFace(vtx) {
      var faces = new Set();
      for (var v of vtx.nearby)
        for (var f of v.faces)
          if (!allowedFaces || allowedFaces.has(f))
            faces.add(f);
      return faces;
    }

    var recursiveVtx = new Set(start)
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

      // Update the vertex list for the next iteration.
      recursiveVtx = nextLoopVtx;
    }

    if (nextLoopVtx.size) {
      // If contiguous vertices remain but the current chunk is fully allocated,
      // record them for the next chunk.
      start.clear();
      for (var v of nextLoopVtx)
        start.add(v);
    }

    return chunk;
  }
}

module.exports = {
  LevelCvtAdjacencyVertex,
  LevelCvtAdjacencyFace,
  LevelCvtAdjacencyChunk,
  LevelCvtAdjacencySubchunk,
  LevelCvtAdjacency
};
