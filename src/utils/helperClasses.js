const NBT = require("parsenbt-js");

/**
 * Helper class for creating singletons.
 */
class ISingleton {
  /**
   * Stores the singleton instance.
   */
  static instance = null;

  /**
   * Get the singleton instance.
   */
  static singleton() {
    if (!this.instance)
      this.instance = new this();
    return this.instance;
  }
}

/**
 * Helper class for objects needs to be converted to JSON.
 * 
 * Subclasses must implement serialize() and deserialize() methods.
 */
class IJsonable {
  /**
   * Convert from JSON to an instance.
   */
  static deserialize(obj) {
    return new IJsonable();
  }

  /**
   * Convert the object to JSON.
   */
  serialize() {
    return {};
  }

  /**
   * Default JSON.stringify function.
   */
  toJSON() {
    return this.serialize();
  }
}

/**
 * Helper class for objects needs to be converted to NBT and JSON.
 * 
 * Subclasses must implement serialize() and deserialize() methods.
 */
class INbtify {
  /**
   * Convert from NBT to an instance.
   */
  static deserialize(obj) {
    return new INbtify();
  }

  /**
   * Convert from JSON to an instance.
   */
  static fromJSON(obj) {
    return new INbtify();
  }

  /**
   * Convert the object to an NBT object.
   */
  serialize() {
    return NBT.create(false);
  }

  /**
   * Default JSON.stringify function.
   */
  toJSON() {
    return {};
  }
}

/**
 * Helper class for objects needs to be converted to BinaryStream.
 * 
 * Subclasses must implement toStream() and fromStream() methods.
 */
class IBinarying {
  static deserialize(stream) {
    var result = new this();
    result.fromStream(stream);
    return result;
  }

  /**
   * 
   * @param {WritableBinaryStream} stream 
   */
  toStream(stream) { }

  /**
   * 
   * @param {ReadOnlyBinaryStream} stream 
   */
  fromStream(stream) { }
}

module.exports = { ISingleton, IJsonable, INbtify, IBinarying };
