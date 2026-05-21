const NBT = require("parsenbt-js");
const { ReadOnlyBinaryStream, WritableBinaryStream } = require("../utils/binaryStream.js");
const { IBinarying } = require("../utils/helperClasses.js");
const { LevelGeo } = require("./levelGeo.js");
const { LevelLod } = require("./levelLod.js");
const { LevelToc, LevelTocSegment } = require("./levelToc.js");
const { Vec3 } = require("../utils/vector.js");

class LevelDesc extends IBinarying {
  constructor() {
    super();

    this.timeStamp = 0;
    this.editor = "that-sky-level";
    this.engineVersion = [0, 32, 2];
  }

  fromStream(stream) {
    var buffer = stream.readBytes(stream.getRemain());
  }
}

class LevelMeshes {
  // magicNum, fileVersion, toc, padding, maxPos, minPos
  static kHeaderLength = 4 + 4 + 100 + 4 + 12 + 12;

  constructor() {
    this.fileVersion = 0x3C;
    this.lod = new LevelLod();
    this.geo = new LevelGeo();
  }

  fromFileBuffer(buffer) {
    var stream = new ReadOnlyBinaryStream(buffer);

    var magicNum = stream.readUint32();
    if (magicNum != 0x304C564C)
      throw new Error("magic number mismatch");

    this.fileVersion = stream.readUint32();
    if (this.fileVersion != 0x3C)
      throw new Error("file version mismatch");

    var toc = stream.readType(LevelToc);

    this.lod = toc.LOD0.fromFileBuffer(buffer).readType(LevelLod);
    this.geo = toc.GEO0.fromFileBuffer(buffer).readType(LevelGeo);
  }

  toFileBuffer() {
    var levelStream = new WritableBinaryStream();
    levelStream.writeUint32(0x304C564C);
    levelStream.writeUint32(this.fileVersion);

    var toc = new LevelToc()
      , contentStream = new WritableBinaryStream()
      , contentCursor = contentStream.getLength();

    contentStream.writeType(this.lod);
    toc.segments.set("LOD0", new LevelTocSegment(
      contentCursor + LevelMeshes.kHeaderLength,
      contentStream.getLength() - contentCursor
    ));
    contentCursor = contentStream.getLength();

    contentStream.writeType(this.geo);
    toc.segments.set("GEO0", new LevelTocSegment(
      contentCursor + LevelMeshes.kHeaderLength,
      contentStream.getLength() - contentCursor
    ));
    contentCursor = contentStream.getLength();

    levelStream.writeType(toc);
    levelStream.writeUint32(0);
    levelStream.writeType(new Vec3(3.402823466e+38, 3.402823466e+38, 3.402823466e+38));
    levelStream.writeType(new Vec3(-3.402823466e+38, -3.402823466e+38, -3.402823466e+38));
    levelStream.writeBytes(contentStream.data());

    return levelStream.data();
  }
}

module.exports = {
  LevelMeshes
};
