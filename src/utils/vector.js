const { IBinarying } = require("./helperClasses.js");

class Vec3 extends IBinarying {
  static get ZERO() {
    return new Vec3();
  }

  static equal(a, b) {
    return a.x == b.x && a.y == b.y && a.z == b.z;
  }

  static broadcast(a) {
    return new Vec3(a, a, a);
  }

  constructor(x = 0, y = 0, z = 0) {
    super();

    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * @param {Vec3} v 
   * @returns {Vec3}
   */
  add(v) {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  /**
   * @param {Vec3} v 
   * @returns {Vec3}
   */
  sub(v) {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /**
   * @param {Vec3} v 
   * @returns {Vec3}
   */
  mul(v) {
    return new Vec3(this.x * v.x, this.y * v.y, this.z * v.z);
  }

  /**
   * @param {Vec3} v 
   * @returns {Vec3}
   */
  div(v) {
    return new Vec3(this.x / v.x, this.y / v.y, this.z / v.z);
  }

  /**
   * @param {number} a 
   * @returns {Vec3}
   */
  scale(a) {
    return new Vec3(this.x * a, this.y * a, this.z * a);
  }

  /**
   * @param {Vec3} v 
   * @returns {number}
   */
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * @returns {number}
   */
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }

  /**
   * @param {Vec3} v 
   * @returns {number}
   */
  dist(v) {
    return this.sub(v).length();
  }

  fromStream(stream) {
    this.x = stream.readFloat();
    this.y = stream.readFloat();
    this.z = stream.readFloat();
  }

  toStream(stream) {
    stream.writeFloat(this.x);
    stream.writeFloat(this.y);
    stream.writeFloat(this.z);
  }

  toString() {
    return "(" + this.x + "," + this.y + "," + this.z + ")";
  }
}

class Vec4 extends IBinarying {
  static get ZERO() {
    return new Vec4();
  }

  static equal(a, b) {
    return a.x == b.x && a.y == b.y && a.z == b.z && a.w == b.w;
  }

  constructor(x = 0, y = 0, z = 0, w = 0) {
    super();

    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * @param {Vec4} v 
   * @returns {Vec4}
   */
  add(v) {
    return new Vec4(
      this.x + v.x,
      this.y + v.y,
      this.z + v.z,
      this.w + v.w
    );
  }

  /**
   * @param {Vec4} v 
   * @returns {Vec4}
   */
  sub(v) {
    return new Vec4(
      this.x - v.x,
      this.y - v.y,
      this.z - v.z,
      this.w - v.w
    );
  }

  /**
   * @param {Vec4} v 
   * @returns {Vec4}
   */
  mul(v) {
    return new Vec4(
      this.x * v.x,
      this.y * v.y,
      this.z * v.z,
      this.w * v.w
    );
  }

  /**
   * @param {Vec4} v 
   * @returns {Vec4}
   */
  div(v) {
    return new Vec4(
      this.x / v.x,
      this.y / v.y,
      this.z / v.z,
      this.w / v.w
    );
  }

  /**
   * @param {number} a
   * @returns {Vec4}
   */
  scale(a) {
    return new Vec4(
      this.x * a,
      this.y * a,
      this.z * a,
      this.w * a
    );
  }

  /**
   * @param {Vec4} v 
   * @returns {number}
   */
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  /**
   * @returns {number}
   */
  length() {
    return Math.hypot(this.x, this.y, this.z, this.w);
  }

  /**
   * @param {Vec4} v 
   * @returns {number}
   */
  dist(v) {
    return this.sub(v).length();
  }

  fromStream(stream) {
    this.x = stream.readFloat();
    this.y = stream.readFloat();
    this.z = stream.readFloat();
    this.w = stream.readFloat();
  }

  toStream(stream) {
    stream.writeFloat(this.x);
    stream.writeFloat(this.y);
    stream.writeFloat(this.z);
    stream.writeFloat(this.w);
  }

  toString() {
    return "(" + this.x + "," + this.y + "," + this.z + ")";
  }
}

module.exports = {
  Vec3,
  Vec4
};
