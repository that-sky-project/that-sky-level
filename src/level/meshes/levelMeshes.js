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
    this.fileName = "";
    this.editor = "that-sky-level";
    this.editorVersion = [1, 0, 0];
    this.engineVersion = [0, 32, 2];
  }

  fromStream(stream) {
    var buffer = stream.readBytes(stream.getRemain())
      , nbt = NBT.Reader(toArrayBuffer(buffer), { littleEndian: true });

    this.timeStamp = nbt["comp>"]?.["u32>timeStamp"] || 0;
    this.fileName = nbt["comp>"]?.["str>fileName"] || "";
    this.editor = nbt["comp>"]?.["str>editor"] || "";
    this.editorVersion = nbt["comp>"]["list>editorVersion"]?.slice(1, 4) || [0, 0, 0];
    this.engineVersion = nbt["comp>"]["list>engineVersion"]?.slice(1, 4) || [0, 0, 0];
  }

  toStream(stream) {
    var nbt = NBT.create(false);

    nbt["i32>timeStamp"] = this.timeStamp;
    nbt["str>fileName"] = this.fileName;
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
    this.lods = [new LevelLod()];
    this.geo = new LevelGeo();
  }

  fromFileBuffer(buffer) {
    var stream = new ReadOnlyBinaryStream(buffer);

    var magicNum = stream.readUint32();
    if (magicNum != 0x304C564C)
      throw new Error("magic number mismatch");

    this.fileVersion = stream.readUint32();
    // Accept 0x3C or 0x3D.
    if (this.fileVersion < 0x3C)
      throw new Error("file version mismatch");

    var toc = stream.readType(LevelToc);

    // Read all LOD segments (LOD0..LODn).
    this.lods = [];
    for (var i = 0; ; i++) {
      var lodSeg = toc.segments.get("LOD" + i);
      if (!lodSeg)
        break;
      this.lods.push(lodSeg.fromFileBuffer(buffer).readType(LevelLod));
    }
    if (!this.lods.length)
      throw new Error("level did not baked lod.");

    if (toc.GEO0) {
      this.geo = new LevelGeo();
      this.geo.fileVersion = this.fileVersion;
      this.geo.fromStream(toc.GEO0.fromFileBuffer(buffer));
    } else
      this.geo = void 0;

    if (toc.DESC)
      this.desc = toc.DESC.fromFileBuffer(buffer).readType(LevelDesc);
    else
      this.desc = void 0;
  }

  toFileBuffer() {
    var levelStream = new WritableBinaryStream();
    levelStream.writeUint32(0x304C564C);
    levelStream.writeUint32(this.fileVersion);

    var toc = new LevelToc()
      , contentStream = new WritableBinaryStream()
      , contentCursor = contentStream.getLength();

    // Write DESC segment.
    if (this.desc) {
      contentStream.writeType(this.desc);
      toc.segments.set("DESC", new LevelTocSegment(
        contentCursor + LevelMeshes.kHeaderLength,
        contentStream.getLength() - contentCursor
      ));
      contentCursor = contentStream.getLength();
    }

    // Write LOD segments (LOD0..LODn) consecutively so their TOC offsets are
    // contiguous (the loader validates each LOD start == prev start + prev len).
    for (var i = 0; i < this.lods.length; i++) {
      contentStream.writeType(this.lods[i]);
      toc.segments.set("LOD" + i, new LevelTocSegment(
        contentCursor + LevelMeshes.kHeaderLength,
        contentStream.getLength() - contentCursor
      ));
      contentCursor = contentStream.getLength();
    }

    // Write GEO0 segment.
    if (this.geo) {
      this.geo.fileVersion = this.fileVersion;
      contentStream.writeType(this.geo);
      toc.segments.set("GEO0", new LevelTocSegment(
        contentCursor + LevelMeshes.kHeaderLength,
        contentStream.getLength() - contentCursor
      ));
      contentCursor = contentStream.getLength();
    }

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
