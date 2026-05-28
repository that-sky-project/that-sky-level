const { kMaterial } = require("../level/enums/kMaterial.js");
const { Vec3 } = require("../utils/vector.js");

class TriangleMeshVertex {
  constructor(pos, normal) {
    this.pos = pos || new Vec3();
    this.normal = normal || new Vec3();
    /** A list of vertices considered adjacent to the current vertex. */
    this.nearby = new Set();
  }
}

class TriangleMeshMaterial {
  static Null = new TriangleMeshMaterial();
  static Default = new TriangleMeshMaterial("kMaterial_Cliff");

  static isNull(mat) {
    return mat == TriangleMeshMaterial.Null;
  }

  constructor(name) {
    this.name = name || "";
  }

  getId() {
    if (this.name.substring(0, 10) !== "kMaterial_")
      return 0;
    return kMaterial[this.name.substring(10)];
  }
}

class TriangleMeshMaterialBarn {
  constructor() {
    this.materials = new Map();
  }

  initialize() {
    this.materials.clear();
    this.materials.set("", TriangleMeshMaterial.Null);
  }

  tryAddMaterial(name) {
    if (this.materials.has(name))
      return this.materials.get(name);

    var result = new TriangleMeshMaterial(name);
    this.materials.set(name, result);

    return result;
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
    this.materials = new TriangleMeshMaterialBarn();

    this.clear();
  }

  clear() {
    this.cmdBuffer = [];
    this.vtxBuffer = [];
    this.materials.initialize();
  }
}

module.exports = {
  TriangleMeshVertex,
  TriangleMeshMaterial,
  TriangleMeshMaterialBarn,
  TriangleMeshFace,
  TriangleMesh
};
