const { Vec3 } = require("../utils/vector.js");

class TriangleMeshVertex {
  constructor(pos, normal) {
    this.pos = pos || new Vec3();
    this.normal = normal || new Vec3();
  }
}

class TriangleMeshMaterial {
  static Null = new TriangleMeshMaterial();

  static isNull(mat) {
    return mat == TriangleMeshMaterial.Null;
  }

  constructor(name) {
    this.name = name || "";
  }
}

class TriangleMeshFace {
  constructor() {
    this.materialRef = TriangleMeshMaterial.Null;
    this.indices = [];
  }
}

class TriangleMesh {
  constructor() {
    this.cmdBuffer = [];
    this.vtxBuffer = [];
    this.materials = new Map();

    this.clear();
  }

  tryAddMaterial(name) {
    if (this.materials.has(name))
      return this.materials.get(name);

    var result = new TriangleMeshMaterial(name);
    this.materials.set(name, result);

    return result;
  }

  clear() {
    this.cmdBuffer = [];
    this.vtxBuffer = [];
    this.materials.clear();
    this.materials.set("", TriangleMeshMaterial.Null);
  }
}

module.exports = {
  TriangleMeshVertex,
  TriangleMeshMaterial,
  TriangleMeshFace,
  TriangleMesh
};
