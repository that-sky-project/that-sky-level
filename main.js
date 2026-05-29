const ps = require("process");
const fs = require("fs");
const pl = require("path");
const arg = require("arg");
const MeshoptDecoder = require("./src/meshopt/meshopt_decoder.js");
const MeshoptEncoder = require("./src/meshopt/meshopt_encoder.js");
const { WavefrontObj } = require("./src/formats/wavefront.js");
const { LevelMeshes } = require("./src/level/meshes/levelMeshes.js");
const { LevelCvtAdjacency } = require("./src/level/adjacency.js");
const { LevelObjectsJson } = require("./src/level/objects/levelObjectsJson.js");
const { silence, printf } = require("./src/utils/logger.js");

const kEngineVersion = [0, 32, 2];
const kEditorVersion = [1, 0, 0];

const argv = arg({
  // Show helps.
  "--help": Boolean,
  // Convert from .meshes to .obj
  "--touch": Boolean,
  // Convert from .obj to .meshes
  "--convert": Boolean,
  // Convert from .level.json to .level.bin
  "--serialize": Boolean,
  // Convert from .level.bin to .level.json
  "--deserialize": Boolean,

  // Merge chunks to a single object.
  "-m": Boolean,
  // Input file.
  "-i": String,
  // Output file.
  "-o": String,
  // Silence mode.
  "-s": Boolean,

  "-h": "--help",
  "-T": "--touch",
  "-C": "--convert",
  "-S": "--serialize",
  "-D": "--deserialize",
}, { permissive: true });

function readModelFile(path) {
  var ext = pl.extname(path);
  if (ext === ".obj") {
    var raw = fs.readFileSync(path, "utf-8")
      , result = new WavefrontObj();
    result.fromFileBuffer(raw);
    return result;
  } else {
    throw new Error("unrecognized file extname");
  }
}

function readMeshesFile(path) {
  var ext = pl.extname(path);
  if (ext === ".meshes") {
    var raw = fs.readFileSync(path)
      , result = new LevelMeshes();
    result.fromFileBuffer(raw);
    return result;
  } else {
    throw new Error("unrecognized file extname");
  }
}

function setDesc(desc, inputFile) {
  desc.fileName = inputFile;
  desc.timeStamp = Math.floor(new Date().getTime() / 1000);
  desc.editor = "that-sky-level";
  desc.editorVersion = kEditorVersion;
  desc.engineVersion = kEngineVersion;
}

function touchObject(meshes, merge) {
  var geo = meshes.geo
    , obj = ""
    , totalIdx = 0;

  for (var vtx of geo.vertices)
    obj += `v ${vtx.pos.x} ${vtx.pos.y} ${vtx.pos.z}\n`;
  obj += "\n";

  for (var vtx of geo.vertices)
    obj += `vn ${vtx.normal.x} ${vtx.normal.y} ${vtx.normal.z}\n`;
  obj += "\n";

  if (merge)
    obj += "o Chunks" + "\n";
  for (var i = 0; i < geo.chunkCount; i++) {
    if (!merge)
      obj += "o Chunk_" + i + "\n";
    var chunk = geo.chunks[i];
    for (var j = 0; j < chunk.idxCount; j += 3) {
      var fileIdx;

      obj += "f ";
      fileIdx = chunk.vtxStart + geo.localIndices[chunk.idxStart + j] + 1;
      obj += `${fileIdx}//${fileIdx} `;
      fileIdx = chunk.vtxStart + geo.localIndices[chunk.idxStart + j + 1] + 1;
      obj += `${fileIdx}//${fileIdx} `;
      fileIdx = chunk.vtxStart + geo.localIndices[chunk.idxStart + j + 2] + 1;
      obj += `${fileIdx}//${fileIdx}\n`;

      totalIdx += 3;
    }
  }

  return {
    result: obj,
    totalVtx: geo.vertices.length,
    totalIdx: totalIdx
  };
}

!async function () {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  silence(argv["-s"]);

  if (argv["--convert"]) {
    var input = argv["-i"]
      , output = argv["-o"] || "./BstBaked.meshes";

    if (!input)
      throw new Error("no input file");

    var rawMesh = readModelFile(input)
      , converter = new LevelCvtAdjacency(rawMesh)
      , meshes = new LevelMeshes();

    converter.initialize(rawMesh);
    meshes.geo = converter.convert();
    setDesc(meshes.desc, input);
    fs.writeFileSync(output, meshes.toFileBuffer());
    printf("Converted:");
    printf("  Chunks: " + meshes.geo.chunkCount);
    printf("  Subchunks: " + meshes.geo.subchunkCount);
    printf("  Vertices: " + meshes.geo.vertexCount);
    printf("  Faces: " + meshes.geo.indexCount / 3);
    return;
  } else if (argv["--touch"]) {
    var input = argv["-i"]
      , output = argv["-o"];

    if (!input)
      throw new Error("no input file");

    var meshes = readMeshesFile(input);
    printf("File information:");
    printf("  Version: 0x" + meshes.fileVersion.toString(16));
    if (meshes.desc) {
      printf("  Editor: " + meshes.desc.editor);
      printf("  Editor version: " + meshes.desc.editorVersion);
      printf("  Timestamp: " + meshes.desc.timeStamp);
      printf("  Original file: " + meshes.desc.fileName);
    } else {
      printf("  Editor: -");
      printf("  Editor version: -");
      printf("  Timestamp: -");
      printf("  Original file: -");
    }

    if (!output)
      return;

    var result = touchObject(meshes, argv["-m"]);

    fs.writeFileSync(output, result.result);
    printf("\nConverted:");
    printf("  Vertices: " + result.totalVtx);
    printf("  Indices: " + result.totalIdx);
  } else if (argv["--serialize"]) {
    var input = argv["-i"]
      , output = argv["-o"] || "./Objects.level.bin";

    if (!input)
      throw new Error("no input file");

    var file = fs.readFileSync(input, "utf-8");
    fs.writeFileSync(output, LevelObjectsJson.write(JSON.parse(file)));
  } else if (argv["--deserialize"]) {
    var input = argv["-i"]
      , output = argv["-o"] || "./Objects.level.json";

    if (!input)
      throw new Error("no input file");

    var file = fs.readFileSync(input);
    fs.writeFileSync(output, JSON.stringify(LevelObjectsJson.read(file), null, 2));
  } else {
    printf("that-sky-level");
    printf("Copyright (c) 2026 That Sky Project");
    printf("<https://www.github.com/that-sky-project/that-sky-level>");
    printf(" - A Sky CotL level reader and writer.");
    printf("");
    printf("Usage:");
    printf("  node main.js --touch -i <meshes>");
    printf("  node main.js --convert -i <model> -o <meshes> [-m <material_map>] [-T]");
    printf("  node main.js --serialize -i <json> -o <objects>");
    printf("  node main.js --deserialize -i <objects> -o <json>");
    printf("  node main.js --help");
    printf("");
    printf("Options:");
    printf("  --touch, -T         Convert from .meshes to .obj");
    printf("  --convert, -C       Convert from .obj to .meshes");
    printf("  --serialize, -S     Convert from .level.json to .level.bin");
    printf("  --deserialize, -D   Convert from .level.v to .level.json");
    printf("  --help, -h          Show this help");
    printf("  -i <file>           Input file");
    printf("  -o <file>           Output file");
    printf("  -s                  Disable logger");
    printf("  -m                  Merge chunks when exporting to .obj");
    return;
  }
}().catch(e => {
  printf("tslevel: §c§lerror: §r%0", e.message || "" + e);
  ps.exit(1);
});
