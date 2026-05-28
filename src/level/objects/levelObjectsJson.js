const { LevelObjects } = require("./levelObjects.js");

const kTypeTable = Object.freeze({
  1: "d08",
  2: "d16",
  4: "d32",
  8: "d64",
  12: "v3f",
  16: "v4f",
  64: "m44"
});

class LevelObjectsJson {
  static read(buffer) {
    function resolveRef(ref) {
      if (ref === null)
        return null;

      if (ref.length <= 8)
        throw new Error("invalid reference");

      var idx = Number.parseInt(ref.substring(8));
      if (Number.isNaN(idx))
        throw new Error("invalid reference");

      var obj = rawObjects[idx];
      if (!obj)
        throw new Error("invalid reference");

      return obj._type + ">" + obj._name;
    }

    var objects = new LevelObjects()
      , allClasses = {}
      , allObjects = {}
      , rawClasses
      , rawObjects;

    objects.fromFileBuffer(buffer);
    rawClasses = objects.types;
    rawObjects = objects.objects;

    // Set initial type & member variables table.
    for (var clazz of rawClasses) {
      var classDef = {};
      for (var i = clazz.firstMemVar; i < clazz.firstMemVar + clazz.numMemVars; i++) {
        var memVar = objects.memVars[i];
        if (memVar.varType === 0)
          classDef[memVar.name] = "raw>b" + memVar.size.toString().padStart(2, "0");
        else if (memVar.varType === 1)
          classDef[memVar.name] = "raw>str";
        else if (memVar.varType === 2)
          classDef[memVar.name] = "raw>ref";
        else if (memVar.varType === 3)
          classDef[memVar.name] = memVar.extra | 0;
      }
      allClasses[clazz.name] = classDef;
    }

    // Backpatch the name of array members.
    for (var clazz of rawClasses) {
      var className = clazz.name
        , classDef = allClasses[className];

      for (var memVar of Object.getOwnPropertyNames(classDef)) {
        var memVarTypeIdx = classDef[memVar];
        if (typeof memVarTypeIdx !== "number")
          // Only process arrays.
          continue;

        if (memVarTypeIdx === -1)
          // Object reference type, remain empty.
          classDef[memVar] = "arr>ref";
        else
          // Inlined sub-objects.
          classDef[memVar] = "arr>" + rawClasses[memVarTypeIdx].name;
      }
    }

    for (var object of rawObjects) {
      var objectDef = {}
        , classDef = allClasses[object._type];

      for (var key of Object.getOwnPropertyNames(object)) {
        if (key.startsWith("_"))
          continue;

        var value = object[key];
        if (classDef[key] === "raw>ref")
          objectDef[key] = resolveRef(value);
        else if (classDef[key] === "arr>ref")
          objectDef[key] = value.map(ref => resolveRef(ref));
        else
          objectDef[key] = value;
      }

      allObjects[object._type + ">" + object._name] = objectDef;
    }

    return {
      classes: allClasses,
      objects: allObjects
    };
  }

  static write(json) {
    function resolveRef(name) {
      if (name === null)
        return null;

      var idx = objectIndices[name];
      if (typeof idx === "undefined")
        throw new Error("unrecognized object name: " + name);

      return "@object_" + idx;
    }

    if (typeof json !== "object")
      return void 0;

    var rawClasses = json.classes || {}
      , rawObjects = json.objects || {}
      , classes = {}
      , objects = {}
      , result = new LevelObjects();

    // Build type indices.
    var classIndices = {}
      , i = 0;
    for (var className of Object.getOwnPropertyNames(rawClasses)) {
      if (typeof className !== "string")
        continue;
      classIndices[className] = i;
      i++;
    }

    // Build types and member variables.
    for (var className of Object.getOwnPropertyNames(rawClasses)) {
      if (typeof className !== "string")
        continue;

      var classDef = rawClasses[className]
        , memVars = [];
      for (var memVarName of Object.getOwnPropertyNames(classDef)) {
        if (typeof memVarName !== "string")
          continue;

        var memVarDef = classDef[memVarName];
        if (memVarDef === "raw>str") {
          // String type.
          memVars.push({
            "varType": 1,
            "name": memVarName,
            "size": 0,
            "extra": 0
          });
        } else if (memVarDef === "raw>ref") {
          // Object reference type.
          memVars.push({
            "varType": 2,
            "name": memVarName,
            "size": 0,
            "extra": 0
          });
        } else if (memVarDef.startsWith("raw>b")) {
          // Raw bytes type.
          var size = Number.parseInt(memVarDef.substring(5));
          if (Number.isNaN(size))
            throw new Error("unrecognized memvar type: " + memVarDef);
          memVars.push({
            "varType": 0,
            "name": memVarName,
            "size": size,
            "extra": 0
          });
        } else if (memVarDef.startsWith("arr>")) {
          // Array type.
          var type = memVarDef.substring(4)
            , extra = -1;
          if (type !== "ref") {
            extra = classIndices[type];
            if (typeof extra === "undefined")
              throw new Error("unrecognized memvar type: " + memVarDef);
          }
          memVars.push({
            "varType": 3,
            "name": memVarName,
            "size": 0,
            "extra": extra >>> 0
          });
        } else
          throw new Error("unrecognized memvar type: " + memVarDef);
      }

      result.types.push({
        "name": className,
        "firstMemVar": result.memVars.length,
        "numMemVars": memVars.length
      });
      result.memVars.push(...memVars);
    }

    var objectIndices = {}
      , check = new Set()
      , i = 0;
    for (var name of Object.getOwnPropertyNames(rawObjects)) {
      if (typeof name !== "string")
        continue;
      if (typeof objectIndices[name] !== "undefined")
        throw new Error("repeated name: " + name);
      objectIndices[name] = i;
      i++;
    }

    for (var name of Object.getOwnPropertyNames(rawObjects)) {
      if (typeof name !== "string")
        continue;

      var objectDef = rawObjects[name]
        , separator = name.indexOf(">")
      if (separator == -1)
        throw new Error("no separator \">\" found: " + name);

      var className = name.substring(0, separator)
        , classIndex = classIndices[className]
        , classDef = rawClasses[className];
      if (typeof classIndex === "undefined")
        throw new Error("unrecognized type: " + name.substring(0, separator));

      var o = {
        "_typeIndex": classIndex,
        "_name": name.substring(separator + 1)
      };
      for (var k of Object.getOwnPropertyNames(objectDef)) {
        if (classDef[k] === "raw>ref")
          o[k] = resolveRef(objectDef[k]);
        else if (classDef[k] === "arr>ref")
          o[k] = objectDef[k].map(ref => resolveRef(ref));
        else
          o[k] = objectDef[k];
      }

      result.objects.push(o);
    }

    result.header = {
      numRefs: 1000
    };

    return result.toFileBuffer();
  }
}

module.exports = {
  LevelObjectsJson
};
