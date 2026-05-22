const NBT = require("parsenbt-js");
const { ReadOnlyBinaryStream, WritableBinaryStream } = require("../../utils/binaryStream.js");
const { IBinarying } = require("../../utils/helperClasses.js");
const { LevelGeo } = require("./levelGeo.js");
const { LevelLod } = require("./levelLod.js");
const { LevelToc, LevelTocSegment } = require("./levelToc.js");
const { Vec3 } = require("../../utils/vector.js");

function toArrayBuffer(buf) {
  var ab = new ArrayBuffer(buf.length);
  (new Uint8Array(ab)).set(buf);
  return ab;
}

class LevelDesc extends IBinarying {
  constructor() {
    super();

    this.timeStamp = 0;
    this.editor = "that-sky-level";
    this.editorVersion = [1, 0, 0];
    this.engineVersion = [0, 32, 2];
  }

  fromStream(stream) {
    var buffer = stream.readBytes(stream.getRemain())
      , nbt = NBT.Reader(toArrayBuffer(buffer), { littleEndian: true });

    this.timeStamp = nbt["u32>timeStamp"];
    this.editor = nbt["str>editor"];
    this.editorVersion = nbt["list>editorVersion"].slice(1, 4);
    this.engineVersion = nbt["list>engineVersion"].slice(1, 4);
  }

  toStream(stream) {
    var nbt = NBT.create(false);

    nbt["u32>timeStamp"] = this.timeStamp;
    nbt["str>editor"] = this.editor;
    nbt["list>editorVersion"] = ["i32"].concat(this.editorVersion);
    nbt["list>engineVersion"] = ["i32"].concat(this.engineVersion);

    stream.writeBytes(Buffer.from(NBT.Writer(nbt, { littleEndian: true })));
  }
}

class LevelMeshes {
  // magicNum, fileVersion, toc, padding, maxPos, minPos
  static kHeaderLength = 4 + 4 + 100 + 4 + 12 + 12;

  constructor() {
    this.fileVersion = 0x3C;
    this.desc = new LevelDesc();
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

    if (toc.LOD0)
      this.lod = toc.LOD0.fromFileBuffer(buffer).readType(LevelLod);
    else
      throw new Error("level did not baked lod.");

    if (toc.GEO0)
      this.geo = toc.GEO0.fromFileBuffer(buffer).readType(LevelGeo);
    if (toc.DESC)
      this.desc = toc.DESC.fromFileBuffer(buffer).readType(LevelDesc);
  }

  toFileBuffer() {
    var levelStream = new WritableBinaryStream();
    levelStream.writeUint32(0x304C564C);
    levelStream.writeUint32(this.fileVersion);

    var toc = new LevelToc()
      , contentStream = new WritableBinaryStream()
      , contentCursor = contentStream.getLength();

    // Write DESC segment.
    contentStream.writeType(this.desc);
    toc.segments.set("DESC", new LevelTocSegment(
      contentCursor + LevelMeshes.kHeaderLength,
      contentStream.getLength() - contentCursor
    ));
    contentCursor = contentStream.getLength();

    // Write LOD0 segment.
    contentStream.writeType(this.lod);
    toc.segments.set("LOD0", new LevelTocSegment(
      contentCursor + LevelMeshes.kHeaderLength,
      contentStream.getLength() - contentCursor
    ));
    contentCursor = contentStream.getLength();

    // Write GEO0 segment.
    contentStream.writeType(this.geo);
    toc.segments.set("GEO0", new LevelTocSegment(
      contentCursor + LevelMeshes.kHeaderLength,
      contentStream.getLength() - contentCursor
    ));
    contentCursor = contentStream.getLength();

    // Complete file header.
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
