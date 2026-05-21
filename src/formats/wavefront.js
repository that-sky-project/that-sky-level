const { Vec3 } = require("../utils/vector");
const {
  TriangleMesh,
  TriangleMeshVertex,
  TriangleMeshMaterial,
  TriangleMeshFace
} = require("./triangleMesh.js");

/**
 * Parse a Wavefront OBJ string into vertices, indices, and per-triangle
 * material names. Only vertex positions and face indices are extracted.
 * Returns an object with vertices (array of [x, y, z]), indices
 * (flattened triangle index list), and materials (material name per
 * triangle). If no usemtl is given, "" is used.
 * 
 * @param {string} objStr 
 */
function parseObj(objStr) {
  // Split the file content into lines.
  var lines = objStr.split("\n")
    // Storage for raw vertex positions and normals.
    , positions = []
    , normals = []
    // Current material name, defaults to "".
    , currentMtl = ""
    // Map from combined position/normal keys to vertex indices.
    , vertexMap = {}
    // Output arrays.
    , vertices = []
    , faces = [];

  // Process every line.
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    // Skip empty lines and comments.
    if (line === "" || line.charAt(0) === "#")
      continue;

    var parts = line.split(/\s+/);
    var keyword = parts[0];

    if (keyword === "v") {
      // Store a vertex position.
      positions.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);
    } else if (keyword === "vn") {
      // Store a vertex normal.
      normals.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ]);
    } else if (keyword === "usemtl") {
      // Switch active material.
      currentMtl = parts[1] || "";
    } else if (keyword === "f") {
      // Parse a face definition.
      var faceIndices = [];
      var material = currentMtl;

      // Loop through each vertex reference in the face.
      for (var j = 1; j < parts.length; j++) {
        var token = parts[j];
        var subParts = token.split("/");
        var posIdx = parseInt(subParts[0], 10);
        var normIdx = null;

        // Extract normal index when available (third component).
        if (subParts.length >= 3 && subParts[2] !== "")
          normIdx = parseInt(subParts[2], 10);

        // Resolve negative indices relative to the end of the lists.
        if (posIdx < 0)
          posIdx = positions.length + 1 + posIdx;
        if (normIdx !== null && normIdx < 0)
          normIdx = normals.length + 1 + normIdx;

        // Build a unique key based on position and normal pair.
        var normKey = normIdx !== null
          ? normIdx
          : "none";
        var key = posIdx + "," + normKey;

        // Add a new vertex if the pair hasn"t been seen.
        if (!vertexMap.hasOwnProperty(key)) {
          var pos = positions[posIdx - 1] || [0, 0, 0];
          var norm = (normIdx !== null && normals[normIdx - 1])
            ? normals[normIdx - 1]
            : [0, 0, 0];
          vertexMap[key] = vertices.length;
          vertices.push({ position: pos, normal: norm });
        }
        // Record the index for the face.
        faceIndices.push(vertexMap[key]);
      }
      // Store the face with its material.
      faces.push({ material: material, indices: faceIndices });
    }
    // Other OBJ keywords (vt, g, o, s, mtllib, etc.) are ignored.
  }

  // Return the assembled vertices and indexed faces.
  return { vertices: vertices, faces: faces };
}

class WavefrontObj extends TriangleMesh {
  constructor() {
    super();
  }

  /**
   * @param {Buffer} fileBuffer 
   */
  fromFileBuffer(fileBuffer) {
    var raw = parseObj(fileBuffer)
      , self = this;

    this.clear();

    this.vtxBuffer = raw.vertices.map(function (v) {
      return new TriangleMeshVertex(
        new Vec3(v.position[0], v.position[1], v.position[2]),
        new Vec3(v.normal[0], v.normal[1], v.normal[2])
      )
    });
    this.cmdBuffer = raw.faces.map(function (f) {
      var result = new TriangleMeshFace();
      result.indices = f.indices;
      result.materialRef = self.materials.tryAddMaterial(f.material);
      return result;
    });
  }
}

module.exports = {
  WavefrontObj
};
