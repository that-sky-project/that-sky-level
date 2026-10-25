/**
 * Spatially coherent breadth first chunk allocation.
 *
 * Chunks are grown from a seed over connected geometry, following Morton
 * (Z-order) keys so that faces close in space are also close in the vertex and
 * index buffers. After allocation, the chunks are ordered along a nearest
 * neighbor path of their bounding boxes, so that chunks adjacent in memory are
 * also adjacent in space.
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

// Number of bits per axis used by the Morton code. 10 bits per axis produce a
// 30-bit key, which stays within the range of safe integer bitwise operations.
const kSpatialBits = 10;
const kSpatialMask = (1 << kSpatialBits) - 1;

/**
 * Spread the lower bits of an integer so that each bit occupies every third
 * bit of the result.
 * @param {number} n
 * @returns {number}
 */
function spreadSpatialBits(n) {
  n &= kSpatialMask;
  n = (n ^ (n << 16)) & 0xff0000ff;
  n = (n ^ (n << 8)) & 0x0300f00f;
  n = (n ^ (n << 4)) & 0x030c30c3;
  n = (n ^ (n << 2)) & 0x09249249;
  return n >>> 0;
}

/**
 * Build a Morton (Z-order) key from quantized coordinates.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
function buildSpatialKey(x, y, z) {
  return (
    spreadSpatialBits(x)
    | (spreadSpatialBits(y) << 1)
    | (spreadSpatialBits(z) << 2)
  ) >>> 0;
}

/**
 * Quantize a coordinate into [0, kSpatialMask].
 * @param {number} v
 * @param {number} min
 * @param {number} size
 * @returns {number}
 */
function quantizeSpatial(v, min, size) {
  if (!(size > 0))
    return 0;

  var t = (v - min) / size;
  if (!(t > 0))
    return 0;
  if (t >= 1)
    return kSpatialMask;

  return Math.floor(t * (kSpatialMask + 1));
}

/**
 * Compare two vertices by their spatial key.
 * @param {LevelCvtAdjacencyVertex} a
 * @param {LevelCvtAdjacencyVertex} b
 * @returns {number}
 */
function compareSpatial(a, b) {
  return a.spatialKey - b.spatialKey;
}

/**
 * Check whether processing a vertex can still assign a face. A vertex only
 * triggers the assignment of faces near it, so once all of them are assigned
 * the vertex does not need to be visited anymore.
 * @param {LevelCvtAdjacencyVertex} vtx
 * @param {Set<LevelCvtAdjacencyFace>} visitedFace
 * @returns {boolean}
 */
function hasUnvisitedFace(vtx, visitedFace) {
  for (var v of vtx.nearby)
    for (var face of v.faces)
      if (!visitedFace.has(face))
        return true;

  return false;
}

/**
 * A uniform grid over mesh vertices. It is used to find the unprocessed
 * vertex closest to a given position when the next allocation region has to
 * be selected.
 */
class LevelCvtSpatialGrid {
  /**
   * @param {LevelCvtAdjacencyVertex[]} vertices
   */
  constructor(vertices) {
    var min = { x: Infinity, y: Infinity, z: Infinity }
      , max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (var vtx of vertices) {
      min.x = Math.min(min.x, vtx.pos.x);
      min.y = Math.min(min.y, vtx.pos.y);
      min.z = Math.min(min.z, vtx.pos.z);
      max.x = Math.max(max.x, vtx.pos.x);
      max.y = Math.max(max.y, vtx.pos.y);
      max.z = Math.max(max.z, vtx.pos.z);
    }

    this.min = min;

    // Use at most 32 cells along the longest axis. The exact size matters
    // little as long as nearby vertices tend to share a cell.
    this.cellSize = Math.max(
      max.x - min.x,
      max.y - min.y,
      max.z - min.z
    ) / 32;
    if (!(this.cellSize > 0))
      this.cellSize = 1;

    this.cells = new Map();
    for (var vtx of vertices) {
      var coords = this.cellCoords(vtx.pos)
        , key = this.cellKey(coords.x, coords.y, coords.z)
        , cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(vtx);
    }

    // Only look for a nearby region within a few cells. If nothing is found,
    // the caller falls back to the spatial order, which keeps the search
    // cheap even for meshes with many distant islands.
    this.maxRing = 8;
  }

  /**
   * Build the key of a cell. Cell coordinates are within [0, 32] because the
   * grid has at most 32 cells along each axis; the offset keeps negative
   * coordinates from a position slightly outside the bounds collision free.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  cellKey(x, y, z) {
    return (x + 1) + (y + 1) * 64 + (z + 1) * 4096;
  }

  /**
   * Get the cell coordinates of a position.
   * @param {{x: number, y: number, z: number}} pos
   * @returns {{x: number, y: number, z: number}}
   */
  cellCoords(pos) {
    return {
      x: Math.floor((pos.x - this.min.x) / this.cellSize),
      y: Math.floor((pos.y - this.min.y) / this.cellSize),
      z: Math.floor((pos.z - this.min.z) / this.cellSize)
    };
  }

  /**
   * Find the closest candidate vertex to the given position.
   * @param {{x: number, y: number, z: number}} pos
   * @param {Set<LevelCvtAdjacencyVertex>} candidates
   * @param {(vtx: LevelCvtAdjacencyVertex) => boolean} [isValid]
   * @returns {LevelCvtAdjacencyVertex | null}
   */
  nearest(pos, candidates, isValid) {
    var center = this.cellCoords(pos)
      , best = null
      , bestDist2 = Infinity;

    // Search the cells in expanding Chebyshev rings. Once the best distance is
    // smaller than the closest possible distance of the next ring, no closer
    // vertex can exist.
    for (var r = 0; r <= this.maxRing; r++) {
      if (best !== null) {
        var minDist = (r - 1) * this.cellSize;
        if (minDist > 0 && minDist * minDist > bestDist2)
          break;
      }

      for (var x = center.x - r; x <= center.x + r; x++)
        for (var y = center.y - r; y <= center.y + r; y++)
          for (var z = center.z - r; z <= center.z + r; z++) {
            if (Math.max(
              Math.abs(x - center.x),
              Math.abs(y - center.y),
              Math.abs(z - center.z)
            ) !== r)
              continue;

            var cell = this.cells.get(this.cellKey(x, y, z));
            if (!cell)
              continue;

            for (var vtx of cell) {
              if (!candidates.has(vtx))
                continue;
              if (isValid && !isValid(vtx))
                continue;

              var dx = vtx.pos.x - pos.x
                , dy = vtx.pos.y - pos.y
                , dz = vtx.pos.z - pos.z
                , dist2 = dx * dx + dy * dy + dz * dz;
              if (dist2 < bestDist2) {
                bestDist2 = dist2;
                best = vtx;
              }
            }
          }
    }

    return best;
  }
}

// Maximum number of chunks for which a greedy nearest neighbor ordering is
// cheap enough. Larger meshes fall back to a Morton ordering.
const kGreedyOrderLimit = 4096;

/**
 * Get the distance between the bounding boxes of two chunks. It is zero when
 * the boxes overlap or touch.
 * @param {LevelGeoChunk} a
 * @param {LevelGeoChunk} b
 * @returns {number}
 */
function chunkGap(a, b) {
  var dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x)
    , dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y)
    , dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Order chunks so that chunks next to each other in memory are also close in
 * space.
 * @param {LevelGeoChunk[]} chunks
 * @returns {LevelGeoChunk[]}
 */
function orderChunks(chunks) {
  if (chunks.length < 2)
    return chunks;

  var entries = chunks.map(function (chunk) {
    return {
      chunk: chunk,
      pos: {
        x: (chunk.min.x + chunk.max.x) / 2,
        y: (chunk.min.y + chunk.max.y) / 2,
        z: (chunk.min.z + chunk.max.z) / 2
      }
    };
  });

  if (entries.length > kGreedyOrderLimit) {
    // For very large meshes, use a Morton ordering of the chunk centers
    // instead of the quadratic greedy path.
    var min = { x: Infinity, y: Infinity, z: Infinity }
      , max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (var entry of entries) {
      min.x = Math.min(min.x, entry.pos.x);
      min.y = Math.min(min.y, entry.pos.y);
      min.z = Math.min(min.z, entry.pos.z);
      max.x = Math.max(max.x, entry.pos.x);
      max.y = Math.max(max.y, entry.pos.y);
      max.z = Math.max(max.z, entry.pos.z);
    }

    var size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z
    };

    for (var entry of entries) {
      entry.spatialKey = buildSpatialKey(
        quantizeSpatial(entry.pos.x, min.x, size.x),
        quantizeSpatial(entry.pos.y, min.y, size.y),
        quantizeSpatial(entry.pos.z, min.z, size.z)
      );
    }

    entries.sort(compareSpatial);
    return entries.map(function (entry) {
      return entry.chunk;
    });
  }

  var remaining = new Set(entries)
    , result = []
    , current = entries[0];

  remaining.delete(current);
  result.push(current.chunk);

  while (remaining.size) {
    // Prefer a chunk whose bounding box touches (or is closest to) the
    // current one, using the distance between the centers as a tie breaker.
    var nearest = null
      , nearestGap = Infinity
      , nearestDist2 = Infinity;

    for (var entry of remaining) {
      var gap = chunkGap(current.chunk, entry.chunk)
        , dx = entry.pos.x - current.pos.x
        , dy = entry.pos.y - current.pos.y
        , dz = entry.pos.z - current.pos.z
        , dist2 = dx * dx + dy * dy + dz * dz;
      if (
        gap < nearestGap
        || (gap == nearestGap && dist2 < nearestDist2)
      ) {
        nearestGap = gap;
        nearestDist2 = dist2;
        nearest = entry;
      }
    }

    remaining.delete(nearest);
    result.push(nearest.chunk);
    current = nearest;
  }

  return result;
}

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
    this.spatialKey = 0;
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

    // The position of the last vertex assigned to this chunk, used to pick the
    // seed of the next chunk.
    this.lastPos = null;
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

    var newVtxCount = [];
    for (var vtx of face.vertices)
      if (!this.vertices.has(vtx))
        newVtxCount++;

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

    // Calculate the spatial key of each vertex, so that the allocation can
    // follow the geometry instead of the order of the input file.
    this.assignSpatialKeys(vtxBuffer);

    // Set face buffer.
    this.meshFaces = new Set(mesh.cmdBuffer.map(function (face) {
      // Push vertices and set material of vertices.
      return new LevelCvtAdjacencyFace(face).from(vtxBuffer);
    }));
  }

  /**
   * Assign Morton (Z-order) keys to vertices based on the mesh bounds.
   * @param {LevelCvtAdjacencyVertex[]} vtxBuffer
   */
  assignSpatialKeys(vtxBuffer) {
    var min = new Vec3(Infinity, Infinity, Infinity)
      , max = new Vec3(-Infinity, -Infinity, -Infinity);

    for (var vtx of vtxBuffer) {
      min.x = Math.min(min.x, vtx.pos.x);
      min.y = Math.min(min.y, vtx.pos.y);
      min.z = Math.min(min.z, vtx.pos.z);
      max.x = Math.max(max.x, vtx.pos.x);
      max.y = Math.max(max.y, vtx.pos.y);
      max.z = Math.max(max.z, vtx.pos.z);
    }

    var size = max.sub(min);
    for (var vtx of vtxBuffer) {
      vtx.spatialKey = buildSpatialKey(
        quantizeSpatial(vtx.pos.x, min.x, size.x),
        quantizeSpatial(vtx.pos.y, min.y, size.y),
        quantizeSpatial(vtx.pos.z, min.z, size.z)
      );
    }
  }

  /**
   * Assign vertices into chunks.
   */
  convert() {
    // Sort vertices by spatial key, so that the first seed and tie-breaking
    // are deterministic. Vertices that are not used by any face cannot be
    // allocated and would otherwise be picked forever.
    var meshVtx = Array.from(this.meshVtx)
        .filter(function (vtx) {
          return vtx.faces.size;
        })
        .sort(compareSpatial)
      , unprocessedVtx = new Set(meshVtx)
      , spatialGrid = new LevelCvtSpatialGrid(meshVtx)
      , visitedFace = new Set()
      , loop = new Set()
      , cursor = meshVtx.length ? meshVtx[0].pos : null
      , geo = new LevelGeo();

    function isValidSeed(vtx) {
      return hasUnvisitedFace(vtx, visitedFace);
    }

    while (unprocessedVtx.size) {
      if (!loop.size) {
        // Start a new region from the unprocessed vertex closest to the
        // previous chunk, so that chunks next to each other in memory are
        // also next to each other in space.
        var seed = cursor
          ? spatialGrid.nearest(cursor, unprocessedVtx, isValidSeed)
          : null;

        if (!seed) {
          // No nearby cell contains a usable vertex. Take any remaining
          // vertex that can still assign a face.
          for (var vtx of unprocessedVtx)
            if (isValidSeed(vtx)) {
              seed = vtx;
              break;
            }
        }

        if (!seed) {
          // All remaining vertices belong to faces that have already been
          // assigned, so there is nothing left to allocate.
          unprocessedVtx.clear();
          break;
        }

        loop.add(seed);
      }

      var chunk = this.assignChunk(loop, unprocessedVtx, visitedFace, cursor);

      if (!chunk.idxBuffer.length)
        // All faces of the selected vertices were assigned to previous
        // chunks, so there is nothing to emit for this chunk.
        continue;

      //this.assignSubChunk(chunk);
      chunk.done();
      this.chunks.push(chunk);

      cursor = chunk.lastPos || {
        x: (chunk.min.x + chunk.max.x) / 2,
        y: (chunk.min.y + chunk.max.y) / 2,
        z: (chunk.min.z + chunk.max.z) / 2
      };
    }

    // Reorder the chunks along a spatial path, so that chunks which are
    // adjacent in memory are also adjacent in space.
    this.chunks = orderChunks(this.chunks);

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
   * @param {Set<LevelCvtAdjacencyVertex>} start
   * @param {Set<LevelCvtAdjacencyVertex>} unprocessedVtx
   * @param {Set<LevelCvtAdjacencyFace>} visitedFace
   * @param {{x: number, y: number, z: number}} [focus] Position used to pick
   *   the next seed from the frontier.
   * @returns {LevelCvtAdjacencyChunk}
   */
  assignChunk(start, unprocessedVtx, visitedFace, focus) {
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

    // Grow the chunk from a single seed. The rest of the frontier, if any,
    // remains unprocessed and is picked up again by the caller, which keeps
    // each chunk compact instead of wrapping around the previous one.
    var recursiveVtx = new Set()
      , chunk = new LevelCvtAdjacencyChunk()
      , lastPos = null
      , done = false;

    if (start.size) {
      var seed = null
        , seedDist2 = Infinity;

      for (var v of start) {
        if (!hasUnvisitedFace(v, visitedFace)) {
          // The faces near this vertex have all been assigned, so visiting it
          // again cannot produce a face anymore.
          unprocessedVtx.delete(v);
          continue;
        }

        if (!focus) {
          if (seed === null || v.spatialKey < seed.spatialKey)
            seed = v;
          continue;
        }

        var dx = v.pos.x - focus.x
          , dy = v.pos.y - focus.y
          , dz = v.pos.z - focus.z
          , dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 < seedDist2) {
          seedDist2 = dist2;
          seed = v;
        }
      }

      if (seed)
        recursiveVtx.add(seed);
    }

    // The first loop, iterates until the current chunk is fully allocated or
    // the connected region it belongs to is exhausted.
    while (!done && recursiveVtx.size) {
      // Record the vertices selected when entering the loop this time (with
      // any vertices left over from an interrupted wave).
      var nextLoopVtx = new Set();

      // Visit the current wave in spatial order, so that the faces added by
      // this chunk and the frontier left for the next chunk stay close in
      // space as well.
      var waveVtx = Array.from(recursiveVtx).sort(compareSpatial);

      // The second loop, iterates over the currently selected vertices.
      for (var vtx of waveVtx) {
        if (!unprocessedVtx.has(vtx))
          // Skip processed vertices.
          continue;

        // The vertex is assigned, remove from the set.
        unprocessedVtx.delete(vtx);
        lastPos = vtx.pos;

        // The third loop, select all faces associated with a vertex (and all
        // vertices sharing the same coordinates).
        for (var face of selectFace(vtx)) {
          if (visitedFace.has(face))
            // Skip visited faces.
            continue;

          if (!chunk.tryAddFace(face)) {
            // The face does not fit into this chunk. Keep its unprocessed
            // vertices for the next chunk, so that allocation continues from
            // the same place instead of losing the frontier.
            updateNextLoop(nextLoopVtx, face);
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

      if (done) {
        // The chunk is full in the middle of a wave. Keep the vertices that
        // were not visited yet, otherwise the next chunk would start from an
        // unrelated part of the mesh.
        for (var v of waveVtx)
          if (unprocessedVtx.has(v))
            nextLoopVtx.add(v);
      } else if (!nextLoopVtx.size) {
        // The chunk is not fully allocated, but there are no more contiguous
        // vertices available. Finish the chunk here instead of pulling faces
        // from a distant region into it, keeping each chunk spatially
        // continuous and its bounding box small.
        done = true;
      }

      // Update the vertex list for the next iteration.
      recursiveVtx = nextLoopVtx;
    }

    // Select the starting vertices for the next chunk. When the connected
    // region is exhausted, leave the set empty; the caller will pick the
    // unprocessed vertex closest to this chunk.
    start.clear();
    if (recursiveVtx.size)
      for (var v of recursiveVtx)
        start.add(v);

    chunk.lastPos = lastPos;

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
