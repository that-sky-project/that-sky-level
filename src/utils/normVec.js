const { Vec4 } = require("./vector.js");

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function map(x) { return (x + 1) / 2; }

class R8G8B8A8_UNORM extends Vec4 {
  constructor(x = 0, y = 0, z = 0, w = 0) {
    super(x, y, z, w);
  }

  fromStream(stream) {
    var v = stream.readUint32();

    this.x = (v & 0xFF) / 255;
    this.y = ((v >> 8) & 0xFF) / 255;
    this.z = ((v >> 16) & 0xFF) / 255;
    this.w = ((v >> 24) & 0xFF) / 255;
  }

  toStream(stream) {
    var x = (255 * clamp(this.x, 0, 1)) | 0
      , y = (255 * clamp(this.y, 0, 1)) | 0
      , z = (255 * clamp(this.z, 0, 1)) | 0
      , w = (255 * clamp(this.w, 0, 1)) | 0;

    stream.writeUint32(((w << 24) | (z << 16) | (y << 8) | x) >>> 0);
  }
}

class R8G8B8A8_SNORM extends Vec4 {
  constructor(x = 0, y = 0, z = 0, w = 0) {
    super(x, y, z, w);
  }

  fromStream(stream) {
    var v = stream.readUint32();

    var x = (v & 0xFF) << 24 >> 24
      , y = ((v >> 8) & 0xFF) << 24 >> 24
      , z = ((v >> 16) & 0xFF) << 24 >> 24
      , w = ((v >> 24) & 0xFF) << 24 >> 24;

    this.x = Math.max(x / 127.0, -1.0);
    this.y = Math.max(y / 127.0, -1.0);
    this.z = Math.max(z / 127.0, -1.0);
    this.w = Math.max(w / 127.0, -1.0);
  }

  toStream(stream) {
    var x = Math.round(clamp(this.x, -1, 1) * 127)
      , y = Math.round(clamp(this.y, -1, 1) * 127)
      , z = Math.round(clamp(this.z, -1, 1) * 127)
      , w = Math.round(clamp(this.w, -1, 1) * 127);

    x = clamp(x, -128, 127) & 0xFF;
    y = clamp(y, -128, 127) & 0xFF;
    z = clamp(z, -128, 127) & 0xFF;
    w = clamp(w, -128, 127) & 0xFF;

    stream.writeUint32(((w << 24) | (z << 16) | (y << 8) | x) >>> 0);
  }
}

module.exports = {
  R8G8B8A8_SNORM,
  R8G8B8A8_UNORM
};
