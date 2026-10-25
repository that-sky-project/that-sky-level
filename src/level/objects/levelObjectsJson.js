/**
 * Objects.level.bin JSON reader/writer, backed by SLDL.
 *
 * Copyright (c) 2026 That Sky Project
 *
 * This program is released under AGPL 3.0, Refer to LICENSE for further
 * informations.
 */

const { DeclarationGroup, JsonLevelObjects } = require("sldl-jsonify");
const { kLibStdSkyDecl } = require("sldl-headers");

class LevelObjectsJson {
  /**
   * Build a JSON level objects facade.
   * @param {Object} [decl] Extra declaration group to merge with the standard
   *   library declarations.
   * @returns {JsonLevelObjects}
   */
  static create(decl) {
    // Merge custom declarations over libstdsky, like SLDL's level builder.
    var declGroup = decl
      ? Object.assign({}, kLibStdSkyDecl, decl)
      : kLibStdSkyDecl;

    return new JsonLevelObjects(
      new DeclarationGroup(declGroup).parse()
    );
  }

  /**
   * Convert Objects.level.bin to JSON objects.
   * @param {Buffer} buffer
   * @param {Object} [decl] Extra declaration group.
   * @returns {Object} JSON objects with "O$name" keys.
   */
  static read(buffer, decl) {
    return LevelObjectsJson.create(decl).read(buffer);
  }

  /**
   * Convert JSON objects to Objects.level.bin.
   * @param {Object} json JSON objects with "O$name" keys.
   * @param {Object} [decl] Extra declaration group.
   * @returns {Buffer}
   */
  static write(json, decl) {
    return LevelObjectsJson.create(decl).write(json);
  }
}

module.exports = {
  LevelObjectsJson
};
