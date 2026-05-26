const { R8G8B8A8_SNORM } = require("../utils/normVec.js");
const { Vec3 } = require("../utils/vector");
const {
  TriangleMesh,
  TriangleMeshVertex,
  TriangleMeshMaterial,
  TriangleMeshMaterialBarn,
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
 * @param {TriangleMeshMaterialBarn} materialBarn 
 */
function parseObj(objStr, materialBarn) {
  // Split the file content into lines.
  var lines = objStr.split("\n")
    // Storage for raw vertex positions and normals.
    , positions = []
    , normals = []
    , positionRefs = []
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
      positionRefs[positions.length] = new Set();
      positions.push(new Vec3(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ));
    } else if (keyword === "vn") {
      // Store a vertex normal.
      normals.push(new R8G8B8A8_SNORM(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      ));
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

        // Add a new vertex if the pair hasn't been seen.
        if (!vertexMap.hasOwnProperty(key)) {
          if (posIdx - 1 > positions.length)
            throw new Error("encountered invalid vertex pos");
          if (normIdx - 1 > normals.length)
            throw new Error("encountered invalid vertex normal");

          var pos = positions[posIdx - 1]
            , posRef = positionRefs[posIdx - 1]
            , norm = (normIdx !== null && normals[normIdx - 1])
              ? normals[normIdx - 1]
              : [0, 1, 0];

          var vtx = new TriangleMeshVertex(pos, norm);
          vtx.nearby = posRef;

          vertexMap[key] = vertices.length;
          posRef.add(vtx);
          vertices.push(vtx);
        }
        // Record the index for the face.
        faceIndices.push(vertexMap[key]);
      }
      // Store the face with its material.
      var face = new TriangleMeshFace();
      face.indices = faceIndices;
      face.materialRef = materialBarn.tryAddMaterial(material);
      faces.push(face);
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
    this.clear();

    var raw = parseObj(fileBuffer.toString("uit-8"), this.materials);

    this.vtxBuffer = raw.vertices;
    this.cmdBuffer = raw.faces;
  }
}

module.exports = {
  WavefrontObj
};
