const { ReadOnlyBinaryStream } = require("../../utils/binaryStream.js");
const { IBinarying } = require("../../utils/helperClasses.js");

class LevelTocSegment {
  constructor(offset, byteLength) {
    this.offset = offset || 0;
    this.byteLength = byteLength || 0;
  }

  fromFileBuffer(buffer) {
    return new ReadOnlyBinaryStream(
      buffer.subarray(this.offset, this.offset + this.byteLength)
    );
  }
}

class LevelToc extends IBinarying {
  constructor() {
    super();

    this.segments = new Map();
  }

  clear() {
    this.segments.clear();
  }

  get LOD0() { return this.segments.get("LOD0"); }
  get GEO0() { return this.segments.get("GEO0"); }
  get METR() { return this.segments.get("METR"); }
  get DESC() { return this.segments.get("DESC"); }

  fromStream(stream) {
    var buffer = stream.readBytes(0x64)
      , tocStream = new ReadOnlyBinaryStream(buffer);
    this.clear();

    var count = tocStream.readUint32();
    for (var i = 0; i < count; i++) {
      var type = tocStream.readBytes(4).toString("ascii")
        , offset = tocStream.readUint32()
        , byteLength = tocStream.readUint32();

      this.segments.set(type, new LevelTocSegment(offset, byteLength));
    }
  }

  toStream(stream) {
    if (this.segments.size > 8)
      throw new Error("too many segments");

    var buffer = Buffer.alloc(0x60)
      , offset = 0;
    for (var kv of this.segments) {
      buffer.write(kv[0], offset, 4, "ascii");
      buffer.writeUint32LE(kv[1].offset, offset + 4);
      buffer.writeUint32LE(kv[1].byteLength, offset + 8);
      offset += 12;
    }

    stream.writeUint32(this.segments.size);
    stream.writeBytes(buffer);
  }
}

module.exports = {
  LevelTocSegment,
  LevelToc
};
