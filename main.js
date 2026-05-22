const fs = require("fs");
const pl = require("path");
const arg = require("arg");
const MeshoptDecoder = require("./src/meshopt/meshopt_decoder.js");
const MeshoptEncoder = require("./src/meshopt/meshopt_encoder.js");
const { WavefrontObj } = require("./src/formats/wavefront.js");
const { LevelCvt } = require("./src/level/convert.js");
const { LevelMeshes } = require("./src/level/meshes/level.js");

const kEngineVersion = [0, 32, 2];
const kEditorVersion = [1, 0, 0];

const argv = arg({
  "--help": Boolean,
  "--touch": Boolean,
  "--convert": Boolean,
  "-i": String,
  "-o": String,

  "-h": "--help",
  "-T": "--touch",
  "-C": "--convert",
}, { permissive: true });

function readModelFile(path) {
  var ext = pl.extname(path);
  if (ext === ".obj") {
    var raw = fs.readFileSync(path, "utf-8")
      , result = new WavefrontObj();
    result.fromFileBuffer(raw);
    return result;
  } else {
    throw new Error("unrecognized file format");
  }
}

function setDesc(desc, inputFile) {
  desc.fileName = inputFile;
  desc.timeStamp = Math.floor(new Date().getTime() / 1000);
  desc.editor = "that-sky-level";
  desc.editorVersion = kEditorVersion;
  desc.engineVersion = kEngineVersion;
}

!async function () {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  if (argv["--convert"]) {
    var input = argv["-i"]
      , output = argv["-o"] || "./BstBaked.meshes";

    if (!input)
      throw new Error("no input files");

    var rawMesh = readModelFile(input)
      , converter = new LevelCvt(rawMesh)
      , meshes = new LevelMeshes();

    meshes.geo = converter.convert();
    setDesc(meshes.desc, input);
    fs.writeFileSync(output, meshes.toFileBuffer());
    console.log("Converted:");
    console.log("  Chunks: " + meshes.geo.chunkCount);
    console.log("  Subchunks: " + meshes.geo.subchunkCount);
    console.log("  Vertices: " + meshes.geo.vertexCount);
    console.log("  Faces: " + meshes.geo.indexCount / 3);
    return;
  } else if (argv["--touch"]) {

  } else {
    console.log("that-sky-level");
    console.log("Copyright (c) 2026 That Sky Project");
    console.log("<https://www.github.com/that-sky-project/that-sky-level>");
    console.log(" - A Sky CotL level reader and writer.");
    console.log("");
    console.log("Usage:");
    console.log("  node main.js --touch -i <meshes>");
    console.log("  node main.js --convert -i <model> -o <meshes> [-m <material_map>]");
    console.log("  node main.js --help");
    return;
  }
}().catch(e => console.error(e));
