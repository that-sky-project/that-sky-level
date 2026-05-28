'use strict';

// ─── Variable type enum ───────────────────────────────────────────────────────

const VAR_TYPE = Object.freeze({
  NORMAL: 0,   // Numeric scalar / vector / matrix; width determined by `size`
  STRING: 1,   // Inline null-terminated UTF-8 string
  OBJECT_PTR: 2,   // int32LE index into the objects array; -1 = null
  ARRAY: 3    // uint32LE count, then elements (refs or inline sub-objects)
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Read a null-terminated UTF-8 string from `buf` starting at `pos`. */
function readCString(buf, pos) {
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  return { value: buf.slice(pos, end).toString('utf8'), bytesRead: end - pos + 1 };
}

/** Write a null-terminated UTF-8 string into a new Buffer. */
function writeCString(str) {
  const encoded = Buffer.from(str == null ? '' : String(str), 'utf8');
  const out = Buffer.allocUnsafe(encoded.length + 1);
  encoded.copy(out);
  out[encoded.length] = 0;
  return out;
}

/** Return true when a field name conventionally indicates a boolean. */
function isBoolName(name) {
  return (
    name.startsWith('is') ||
    name.startsWith('has') ||
    name === 'enabled' ||
    name === 'autoStart' ||
    name.includes('Enable') ||
    name.includes('Visible')
  );
}

/** Return true when a 4-byte NORMAL field should be treated as UInt32. */
function isUInt32Name(name) {
  return name === 'bstGuid' || name.endsWith('Id') || name.endsWith('Index');
}

/**
 * Decide whether a numeric JS value was originally stored as Float32 or Int32.
 *
 * The original parser stored a value as Float32 when the Float32 interpretation
 * was "reasonable" (abs in (1e-10, 1e10) or exactly 0), and as Int32 otherwise.
 * On write-back we must produce the same raw bytes.
 *
 * Strategy: write as Float32; check whether reading that Float32 back would
 * reproduce the same JS number. If yes → write float. If no (the stored JS
 * number was an integer that survived only as Int32), write Int32.
 */
function encode4ByteNormal(buf, offset, value) {
  const n = typeof value === 'number' ? value : 0;

  // Write tentatively as Float32 and read back.
  buf.writeFloatLE(n, offset);
  const roundTripped = buf.readFloatLE(offset);

  // If the float round-trip is exact (within float32 precision), we're done.
  if (roundTripped === n) return;

  // The value is an integer that cannot be exactly represented as float32 (or
  // is outside the "reasonable float" range). Write as Int32 instead so that
  // the parser's fallback branch picks it up correctly on re-read.
  buf.writeInt32LE(n | 0, offset);
}

// ─── Tgcl ─────────────────────────────────────────────────────────────────────

/**
 * Reader/writer for the TGCL binary level format.
 *
 * Data model after parsing:
 *
 *   tgcl.header    – raw header fields
 *   tgcl.types[]   – type descriptors { index, name, firstMemVar, numMemVars }
 *   tgcl.memVars[] – field descriptors { index, varType, name, size, extra }
 *   tgcl.objects[] – object instances  { _index, _type, _typeIndex, _name,
 *                                         _startPos, _nextPos, ...fields }
 *
 * All field values are plain JS primitives / objects:
 *   NORMAL 1B   → number | boolean
 *   NORMAL 4B   → number (UInt32 for *Id/*Index/bstGuid, else Float32/Int32)
 *   NORMAL 8B   → number (Float64)
 *   NORMAL 12B  → { x, y, z }
 *   NORMAL 16B  → { x, y, z, w }
 *   NORMAL 64B  → { matrix: number[4][4], pos: { x, y, z } }
 *   NORMAL else → hex string
 *   STRING      → string
 *   OBJECT_PTR  → "@object_N" | null
 *   ARRAY (refs)→ Array<"@object_N" | null>
 *   ARRAY (typed)→ Array<plain object>
 */
class Tgcl {
  constructor() {
    this._reset();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Clear the current state and populate it from a TGCL binary buffer.
   * @param {Buffer} buffer
   * @returns {this}
   */
  fromFileBuffer(buffer) {
    this._reset();
    this._buf = buffer;

    try {
      this._parseHeader();
      this._parseTypes();
      this._parseMemVars();
      this._parseObjects();
    } finally {
      this._buf = null; // release reference
    }

    return this;
  }

  /**
   * Serialise the current state to a TGCL binary buffer.
   *
   * Known limitation: ARRAY fields whose element-type index is both unknown
   * (≥ numTypes) and not 0xFFFFFFFF were not decoded during reading; their
   * element data is lost and the written array will have count = 0.
   *
   * @returns {Buffer}
   */
  toFileBuffer() {
    // ── 1. Data section (interned strings for type/field names) ──────────────
    const { dataBuf, offsetOf } = this._buildDataSection();

    // ── 2. Compute absolute file offsets ─────────────────────────────────────
    const HEADER_SIZE = 44;
    const typesSize = this.types.length * 12;
    const memVarsSize = this.memVars.length * 16;

    const typesOffset = HEADER_SIZE;
    const memVarsOffset = typesOffset + typesSize;
    const dataOffset = memVarsOffset + memVarsSize;
    const stringsOffset = dataOffset + dataBuf.length; // objects start here

    // ── 3. Types table ────────────────────────────────────────────────────────
    const typesBuf = Buffer.allocUnsafe(typesSize);
    for (let i = 0; i < this.types.length; i++) {
      const t = this.types[i];
      const off = i * 12;
      typesBuf.writeUInt32LE(offsetOf(t.name), off);
      typesBuf.writeUInt32LE(t.firstMemVar, off + 4);
      typesBuf.writeUInt32LE(t.numMemVars, off + 8);
    }

    // ── 4. MemVars table ──────────────────────────────────────────────────────
    const memVarsBuf = Buffer.allocUnsafe(memVarsSize);
    for (let i = 0; i < this.memVars.length; i++) {
      const mv = this.memVars[i];
      const off = i * 16;
      memVarsBuf.writeUInt32LE(mv.varType, off);
      memVarsBuf.writeUInt32LE(offsetOf(mv.name), off + 4);
      memVarsBuf.writeUInt32LE(mv.size, off + 8);
      memVarsBuf.writeUInt32LE(mv.extra, off + 12);
    }

    // ── 5. Objects section ────────────────────────────────────────────────────
    const objectParts = this.objects.map(obj => this._serializeObject(obj));
    const objectsBuf = Buffer.concat(objectParts);

    // ── 6. Header ─────────────────────────────────────────────────────────────
    const fileSize = stringsOffset + objectsBuf.length;
    const headerBuf = Buffer.allocUnsafe(HEADER_SIZE);

    headerBuf.write('TGCL', 0, 'ascii');
    headerBuf.writeUInt32LE(this.header?.version ?? 1, 4);
    headerBuf.writeUInt32LE(this.types.length, 8);
    headerBuf.writeUInt32LE(this.memVars.length, 12);
    headerBuf.writeUInt32LE(this.objects.length, 16);
    headerBuf.writeUInt32LE(this.header?.numRefs ?? 0, 20);
    headerBuf.writeUInt32LE(typesOffset, 24);
    headerBuf.writeUInt32LE(memVarsOffset, 28);
    headerBuf.writeUInt32LE(dataOffset, 32);
    headerBuf.writeUInt32LE(stringsOffset, 36);
    headerBuf.writeUInt32LE(fileSize, 40);

    return Buffer.concat([headerBuf, typesBuf, memVarsBuf, dataBuf, objectsBuf]);
  }

  // ── Private: reset ─────────────────────────────────────────────────────────

  _reset() {
    this.header = null;
    this.types = [];
    this.memVars = [];
    this.objects = [];
    this._buf = null;
  }

  // ── Private: read helpers ──────────────────────────────────────────────────

  /** Read a null-terminated string from the data section. */
  _readDataString(relativeOffset) {
    const abs = this.header.dataOffset + relativeOffset;
    const { value } = readCString(this._buf, abs);
    return value;
  }

  _parseHeader() {
    const buf = this._buf;
    const magic = buf.slice(0, 4).toString('ascii');
    if (magic !== 'TGCL') throw new Error(`[Tgcl] Invalid magic: "${magic}", expected "TGCL"`);

    this.header = {
      magic,
      version: buf.readUInt32LE(4),
      numTypes: buf.readUInt32LE(8),
      numMemVars: buf.readUInt32LE(12),
      numObjects: buf.readUInt32LE(16),
      numRefs: buf.readUInt32LE(20),
      typesOffset: buf.readUInt32LE(24),
      memVarsOffset: buf.readUInt32LE(28),
      dataOffset: buf.readUInt32LE(32),
      stringsOffset: buf.readUInt32LE(36),
      fileSize: buf.readUInt32LE(40)
    };

    if (this.header.fileSize !== buf.length) {
      console.warn(
        `[Tgcl] File size mismatch: header says ${this.header.fileSize}, ` +
        `buffer is ${buf.length} bytes`
      );
    }
  }

  _parseTypes() {
    const { typesOffset, numTypes } = this.header;
    const buf = this._buf;

    for (let i = 0; i < numTypes; i++) {
      const off = typesOffset + i * 12;
      this.types.push({
        index: i,
        name: this._readDataString(buf.readUInt32LE(off)),
        firstMemVar: buf.readUInt32LE(off + 4),
        numMemVars: buf.readUInt32LE(off + 8)
      });
    }
  }

  _parseMemVars() {
    const { memVarsOffset, numMemVars } = this.header;
    const buf = this._buf;

    for (let i = 0; i < numMemVars; i++) {
      const off = memVarsOffset + i * 16;
      this.memVars.push({
        index: i,
        varType: buf.readUInt32LE(off),
        name: this._readDataString(buf.readUInt32LE(off + 4)),
        size: buf.readUInt32LE(off + 8),
        extra: buf.readUInt32LE(off + 12)
      });
    }
  }

  /** Return the contiguous MemVar slice that belongs to `typeIndex`. */
  _getTypeMemVars(typeIndex) {
    const type = this.types[typeIndex];
    if (!type) return [];
    const end = type.firstMemVar + type.numMemVars;
    return this.memVars.slice(type.firstMemVar, end);
  }

  _parseObjects() {
    let pos = this.header.stringsOffset;
    const endPos = this.header.fileSize;

    for (let i = 0; i < this.header.numObjects && pos < endPos; i++) {
      try {
        const obj = this._parseObject(pos, i);
        this.objects.push(obj);
        pos = obj._nextPos;
      } catch (e) {
        console.error(`[Tgcl] Error parsing object ${i} at offset ${pos}:`, e.message);
        break;
      }
    }
  }

  _parseObject(pos, index) {
    const buf = this._buf;
    const startPos = pos;

    // Type index
    const typeIndex = buf.readUInt32LE(pos); pos += 4;

    // Object name (inline null-terminated string)
    const { value: name, bytesRead: nameBytes } = readCString(buf, pos);
    pos += nameBytes;

    const type = this.types[typeIndex];
    const obj = {
      _index: index,
      _type: type ? type.name : `unknown_type_${typeIndex}`,
      _typeIndex: typeIndex,
      _name: name,
      _startPos: startPos
    };

    if (type) {
      for (const mv of this._getTypeMemVars(typeIndex)) {
        try {
          const { value, bytesRead } = this._readValue(pos, mv);
          obj[mv.name] = value;
          pos += bytesRead;
        } catch (e) {
          console.warn(
            `[Tgcl] Error reading field "${type.name}.${mv.name}" at offset ${pos}:`,
            e.message
          );
          pos += mv.size || 4; // best-effort skip
        }
      }
    }

    obj._nextPos = pos;
    return obj;
  }

  // ── Private: value readers ─────────────────────────────────────────────────

  _readValue(pos, memVar) {
    const { varType } = memVar;

    switch (varType) {
      case VAR_TYPE.STRING:
        return this._readStringValue(pos);

      case VAR_TYPE.OBJECT_PTR:
        return this._readObjectPtrValue(pos);

      case VAR_TYPE.ARRAY:
        return this._readArrayValue(pos, memVar);

      case VAR_TYPE.NORMAL:
      default:
        return this._readNormalValue(pos, memVar.size, memVar.name);
    }
  }

  _readStringValue(pos) {
    const { value, bytesRead } = readCString(this._buf, pos);
    return { value, bytesRead };
  }

  _readObjectPtrValue(pos) {
    const idx = this._buf.readInt32LE(pos);
    return { value: idx === -1 ? null : `@object_${idx}`, bytesRead: 4 };
  }

  _readArrayValue(pos, memVar) {
    const buf = this._buf;
    const count = buf.readUInt32LE(pos);
    const elementTypeIdx = memVar.extra;

    // ── Ref array (0xFFFFFFFF) ───────────────────────────────────────────────
    if (elementTypeIdx === 0xFFFFFFFF) {
      const refs = [];
      for (let i = 0; i < count; i++) {
        const idx = buf.readInt32LE(pos + 4 + i * 4);
        refs.push(idx === -1 ? null : `@object_${idx}`);
      }
      return { value: refs, bytesRead: 4 + count * 4 };
    }

    // ── Inline typed sub-objects ─────────────────────────────────────────────
    if (elementTypeIdx < this.types.length) {
      const elemMemVars = this._getTypeMemVars(elementTypeIdx);
      const elements = [];
      let arrayPos = pos + 4;

      for (let i = 0; i < count; i++) {
        const elem = {};
        for (const emv of elemMemVars) {
          const { value, bytesRead } = this._readValue(arrayPos, emv);
          elem[emv.name] = value;
          arrayPos += bytesRead;
        }
        elements.push(elem);
      }

      return { value: elements, bytesRead: arrayPos - pos };
    }

    // ── Unknown element type – store sentinel, skip raw bytes ────────────────
    // Element size is stored in `extra` when it's not a type index.
    // Fall back to 4 if zero to avoid infinite loops.
    const elemSize = elementTypeIdx || 4;
    console.warn(
      `[Tgcl] Unknown ARRAY element type index ${elementTypeIdx}; ` +
      `skipping ${count} * ${elemSize} bytes. Data is NOT preserved.`
    );
    return {
      value: { _unknownArray: true, count, elementTypeIdx },
      bytesRead: 4 + count * elemSize
    };
  }

  _readNormalValue(pos, size, name) {
    const buf = this._buf;
    let value;

    switch (size) {
      case 1:
        value = buf.readUInt8(pos);
        if (isBoolName(name)) value = value !== 0;
        break;

      case 4:
        if (isUInt32Name(name)) {
          value = buf.readUInt32LE(pos);
        } else {
          const intVal = buf.readInt32LE(pos);
          const floatVal = buf.readFloatLE(pos);
          // Prefer float when the float interpretation is "reasonable".
          value =
            (Math.abs(floatVal) < 1e10 && Math.abs(floatVal) > 1e-10) ||
              floatVal === 0
              ? floatVal
              : intVal;
        }
        break;

      case 8:
        value = buf.readDoubleLE(pos);
        break;

      case 12:
        value = {
          x: buf.readFloatLE(pos),
          y: buf.readFloatLE(pos + 4),
          z: buf.readFloatLE(pos + 8)
        };
        break;

      case 16:
        value = {
          x: buf.readFloatLE(pos),
          y: buf.readFloatLE(pos + 4),
          z: buf.readFloatLE(pos + 8),
          w: buf.readFloatLE(pos + 12)
        };
        break;

      case 64:
        value = {
          matrix: [
            [buf.readFloatLE(pos), buf.readFloatLE(pos + 4), buf.readFloatLE(pos + 8), buf.readFloatLE(pos + 12)],
            [buf.readFloatLE(pos + 16), buf.readFloatLE(pos + 20), buf.readFloatLE(pos + 24), buf.readFloatLE(pos + 28)],
            [buf.readFloatLE(pos + 32), buf.readFloatLE(pos + 36), buf.readFloatLE(pos + 40), buf.readFloatLE(pos + 44)],
            [buf.readFloatLE(pos + 48), buf.readFloatLE(pos + 52), buf.readFloatLE(pos + 56), buf.readFloatLE(pos + 60)]
          ],
          pos: {
            x: buf.readFloatLE(pos + 48),
            y: buf.readFloatLE(pos + 52),
            z: buf.readFloatLE(pos + 56)
          }
        };
        break;

      default:
        value = buf.slice(pos, pos + size).toString('hex');
    }

    return { value, bytesRead: size };
  }

  // ── Private: write helpers ─────────────────────────────────────────────────

  /**
   * Intern all type/field name strings into a contiguous Data Section buffer.
   * Returns the buffer and a lookup function `offsetOf(name) → number`.
   */
  _buildDataSection() {
    const map = new Map(); // string → byte offset within data section
    const parts = [];
    let cursor = 0;

    const intern = (str) => {
      if (map.has(str)) return;
      const chunk = writeCString(str);
      map.set(str, cursor);
      parts.push(chunk);
      cursor += chunk.length;
    };

    for (const t of this.types) intern(t.name);
    for (const mv of this.memVars) intern(mv.name);

    return {
      dataBuf: Buffer.concat(parts),
      offsetOf: (str) => {
        const off = map.get(str);
        if (off === undefined)
          throw new Error(`[Tgcl] String "${str}" not found in data section`);
        return off;
      }
    };
  }

  _serializeObject(obj) {
    const parts = [];
    const typeIndex = obj._typeIndex;

    // typeIndex
    const typeBuf = Buffer.allocUnsafe(4);
    typeBuf.writeUInt32LE(typeIndex >>> 0);
    parts.push(typeBuf);

    // name
    parts.push(writeCString(obj._name ?? ''));

    // field values, in schema order
    for (const mv of this._getTypeMemVars(typeIndex)) {
      parts.push(this._writeValue(obj[mv.name], mv));
    }

    return Buffer.concat(parts);
  }

  // ── Private: value writers ─────────────────────────────────────────────────

  _writeValue(value, memVar) {
    switch (memVar.varType) {
      case VAR_TYPE.STRING:
        return writeCString(value);

      case VAR_TYPE.OBJECT_PTR:
        return this._writeObjectPtrValue(value);

      case VAR_TYPE.ARRAY:
        return this._writeArrayValue(value, memVar);

      case VAR_TYPE.NORMAL:
      default:
        return this._writeNormalValue(value, memVar.size, memVar.name);
    }
  }

  _writeObjectPtrValue(value) {
    const buf = Buffer.allocUnsafe(4);
    if (value == null) {
      buf.writeInt32LE(-1);
    } else {
      const idx = parseInt(String(value).replace('@object_', ''), 10);
      buf.writeInt32LE(isNaN(idx) ? -1 : idx);
    }
    return buf;
  }

  _writeArrayValue(value, memVar) {
    const elementTypeIdx = memVar.extra;

    // ── Unknown array (not decoded at read time) ─────────────────────────────
    if (value && value._unknownArray) {
      // We cannot recover the original bytes. Write an empty array.
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt32LE(0);
      return buf;
    }

    const items = Array.isArray(value) ? value : [];

    // ── Ref array ────────────────────────────────────────────────────────────
    if (elementTypeIdx === 0xFFFFFFFF) {
      const buf = Buffer.allocUnsafe(4 + items.length * 4);
      buf.writeUInt32LE(items.length, 0);
      for (let i = 0; i < items.length; i++) {
        const ref = items[i];
        const idx = ref == null ? -1 : parseInt(String(ref).replace('@object_', ''), 10);
        buf.writeInt32LE(isNaN(idx) ? -1 : idx, 4 + i * 4);
      }
      return buf;
    }

    // ── Inline typed sub-objects ─────────────────────────────────────────────
    if (elementTypeIdx < this.types.length) {
      const elemMemVars = this._getTypeMemVars(elementTypeIdx);
      const countBuf = Buffer.allocUnsafe(4);
      countBuf.writeUInt32LE(items.length);
      const parts = [countBuf];

      for (const elem of items) {
        for (const emv of elemMemVars) {
          parts.push(this._writeValue(elem != null ? elem[emv.name] : undefined, emv));
        }
      }

      return Buffer.concat(parts);
    }

    // ── Fallback: unknown element type, write empty ──────────────────────────
    const fallback = Buffer.allocUnsafe(4);
    fallback.writeUInt32LE(0);
    return fallback;
  }

  _writeNormalValue(value, size, name) {
    const buf = Buffer.allocUnsafe(size);
    const n = typeof value === 'number' ? value : 0;

    switch (size) {
      case 1:
        if (isBoolName(name)) {
          buf.writeUInt8(value ? 1 : 0);
        } else {
          buf.writeUInt8(n & 0xFF);
        }
        break;

      case 4:
        if (isUInt32Name(name)) {
          buf.writeUInt32LE(n >>> 0); // treat as unsigned
        } else {
          // Reproduce the float-vs-int decision made at read time.
          encode4ByteNormal(buf, 0, n);
        }
        break;

      case 8:
        buf.writeDoubleLE(n);
        break;

      case 12:
        buf.writeFloatLE(value?.x ?? 0, 0);
        buf.writeFloatLE(value?.y ?? 0, 4);
        buf.writeFloatLE(value?.z ?? 0, 8);
        break;

      case 16:
        buf.writeFloatLE(value?.x ?? 0, 0);
        buf.writeFloatLE(value?.y ?? 0, 4);
        buf.writeFloatLE(value?.z ?? 0, 8);
        buf.writeFloatLE(value?.w ?? 0, 12);
        break;

      case 64: {
        const m = value?.matrix;
        if (Array.isArray(m)) {
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++)
              buf.writeFloatLE(m[r]?.[c] ?? 0, (r * 4 + c) * 4);
        } else {
          buf.fill(0);
        }
        break;
      }

      default:
        // Stored as a hex string; restore raw bytes.
        if (typeof value === 'string') {
          const raw = Buffer.from(value, 'hex');
          raw.copy(buf, 0, 0, Math.min(raw.length, size));
          if (raw.length < size) buf.fill(0, raw.length); // zero-pad tail
        } else {
          buf.fill(0);
        }
    }

    return buf;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

Tgcl.VAR_TYPE = VAR_TYPE;
module.exports = { Tgcl, LevelObjects: Tgcl };
