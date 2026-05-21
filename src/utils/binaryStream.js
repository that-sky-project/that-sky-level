const Long = require("long");
const { IBinarying } = require("./helperClasses");
const { Vec3, Vec4 } = require("./vector");

class WritableBinaryStream {
  constructor() {
    this.buffer = Buffer.alloc(128);
    this.bitOffset = 0;
    this.cursor = 0;
  }

  /**
   * Reallocate the buffer to meet the addition "advance" byte requirements.
   * @param {number} advance 
   */
  realloc(advance) {
    var newLength = this.buffer.byteLength
      , newBuffer;

    if (this.bitOffset)
      // When calling this function, bitOffset must be 0; otherwise, the cursor
      // needs to be moved forward.
      this.cursor++;

    // Reset bit offset.
    this.bitOffset = 0;

    if (this.cursor + advance <= this.buffer.byteLength)
      return;

    while (this.cursor + advance > newLength)
      newLength <<= 1;

    newBuffer = Buffer.alloc(newLength);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
  }

  /**
   * Get the total length of written data.
   * @returns {number}
   */
  getLength() {
    return this.cursor;
  }

  /**
   * Get a copy of written data.
   * @returns {Buffer}
   */
  data() {
    var data = Buffer.alloc(this.cursor);
    data.set(this.buffer.subarray(0, this.cursor));
    return data;
  }

  /**
   * Reset the buffer of the stream.
   */
  clear() {
    this.bitOffset = 0;
    this.cursor = 0;
    this.buffer = Buffer.alloc(128);
  }

  /**
   * Write paddings.
   * @param {number} count 
   * @param {number} [value] 
   */
  pad(count, value = 0) {
    this.realloc(count);
    this.buffer.fill(value, this.cursor, this.cursor + count);
    this.cursor += count;
  }

  /**
   * Write "value" as a number with "count" bits.
   * @param {number} value 
   * @param {number} count 
   */
  writeBits(value, count) {
    if (count < 1 || count > 32)
      return;

    // Convert to u32.
    value = value >>> 0;

    var written = 0
      , byte, available, need, take, bits;

    while (written < count) {
      if (this.bitOffset == 0) {
        // Expand buffer.
        this.realloc(1);
        // Initialize the new byte.
        this.buffer[this.cursor] = 0;
      }

      byte = this.buffer[this.cursor];
      available = 8 - this.bitOffset;
      need = count - written;
      take = need < available ? need : available;
      // Fetch the "take" bit to be written next. (starting from the low bit)
      bits = (value >>> written) & ((1 << take) - 1);
      // Merge to current byte.
      byte |= (bits << this.bitOffset);
      this.buffer[this.cursor] = byte;
      written += take;
      this.bitOffset += take;

      if (this.bitOffset == 8) {
        this.bitOffset = 0;
        this.cursor++;
      }
    }
  }

  /**
   * Write a Uint8Array-like object to the stream.
   * @param {Uint8Array} buffer 
   */
  writeBytes(buffer) {
    var length = buffer.byteLength;

    this.realloc(length);
    this.buffer.set(buffer, this.cursor);
    this.cursor += length;
  }

  /**
   * Writes a boolean to the stream.
   * @param {boolean} value
   */
  writeBool(value) {
    this.writeBits(!!value, 1);
  }

  /**
   * Writes a signed 8-bit integer to the stream.
   * @param {number} value 
   */
  writeInt8(value) {
    this.realloc(1);
    this.buffer.writeInt8(value, this.cursor);
    this.cursor += 1;
  }

  /**
   * Writes an unsigned 8-bit integer to the stream.
   * @param {number} value
   */
  writeUint8(value) {
    this.realloc(1);
    this.buffer.writeUint8(value, this.cursor);
    this.cursor += 1;
  }

  /**
   * Writes a signed 16-bit integer to the stream.
   * @param {number} value
   */
  writeInt16(value) {
    this.realloc(2);
    this.buffer.writeInt16LE(value, this.cursor);
    this.cursor += 2;
  }

  /**
   * Writes an unsigned 16-bit integer to the stream.
   * @param {number} value
   */
  writeUint16(value) {
    this.realloc(2);
    this.buffer.writeUint16LE(value, this.cursor);
    this.cursor += 2;
  }

  /**
   * Writes a signed 32-bit integer to the stream.
   * @param {number} value
   */
  writeInt32(value) {
    this.realloc(4);
    this.buffer.writeInt32LE(value, this.cursor);
    this.cursor += 4;
  }

  /**
   * Writes an unsigned 32-bit integer to the stream.
   * @param {number} value
   */
  writeUint32(value) {
    this.realloc(4);
    this.buffer.writeUint32LE(value, this.cursor);
    this.cursor += 4;
  }

  /**
   * Writes a signed 64-bit integer to the stream.
   * @param {Long} value 
   */
  writeInt64(value) {
    this.realloc(8);
    this.buffer.writeInt32LE(value.high, this.cursor);
    this.cursor += 4;
    this.buffer.writeInt32LE(value.low, this.cursor);
    this.cursor += 4;
  }

  /**
   * Writes an unsigned 64-bit integer to the stream.
   * @param {Long} value 
   */
  writeUint64(value) {
    this.realloc(8);
    this.buffer.writeInt32LE(value.high, this.cursor);
    this.cursor += 4;
    this.buffer.writeInt32LE(value.low, this.cursor);
    this.cursor += 4;
  }

  /**
   * Writes a 32-bit, little-endian float to the stream.
   * @param {number} value
   */
  writeFloat(value) {
    this.realloc(4);
    this.buffer.writeFloatLE(value, this.cursor);
    this.cursor += 4;
  }

  /**
   * Writes a 64-bit, little-endian float to the stream.
   * @param {number} value
   */
  writeDouble(value) {
    this.realloc(4);
    this.buffer.writeDoubleLE(value, this.cursor);
    this.cursor += 8;
  }

  /**
   * Writes a compressed signed 8-bit integer to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   */
  writeCompressedInt8(value, min, max) {
    value = ((value) << 24) >> 24;
    min = ((min | 0) << 24) >> 24;
    max = ((max | 0) << 24) >> 24;
  }

  /**
   * Writes a compressed unsigned 8-bit integer to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   */
  writeCompressedUint8(value, min, max) {

  }

  /**
   * Writes a compressed signed 32-bit integer to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   */
  writeCompressedInt32(value, min, max) {
    value ^= 0x80000000;
    min ^= 0x80000000;
    max ^= 0x80000000;
    this.writeCompressedUint32(value, min, max);
  }

  /**
   * Writes a compressed unsigned 32-bit integer to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   */
  writeCompressedUint32(value, min, max) {
    value >>>= 0;
    min >>>= 0;
    max >>>= 0;

    if (min > max)
      throw new RangeError("min must be less than max.");

    var width = 32 - Math.clz32(max - min);

    this.writeBits(value - min, width);
  }

  /**
   * Writes a compressed 32-bit, little-endian float to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   * @param {number} pivot 
   * @param {number} bits 
   */
  writeCompressedFloat(value, min, max, pivot, bits) {
    value = Math.fround(value);
    min = Math.fround(min);
    max = Math.fround(max);
    pivot = Math.fround(pivot);

    this.writeCompressedDouble(value, min, max, pivot, bits);
  }

  /**
   * Writes a compressed 32-bit, little-endian float to the stream.
   * @param {number} value 
   * @param {number} min 
   * @param {number} max 
   * @param {number} pivot 
   * @param {number} bits 
   */
  writeCompressedDouble(value, min, max, pivot, bits) {
    if (min >= max)
      throw new RangeError("min must be less than max");
    if (pivot < min || pivot > max)
      throw new RangeError("pivot must be within [min, max]");
    if (bits < 1 || bits >= 32)
      throw new RangeError("bits must be between 1 and 31");

    var mask = ((1 << bits) - 1) >>> 0
      , range = max - min
      , pivotCode = Math.trunc(((pivot - min) / range) * mask)
      , code, t;

    if (value < pivot) {
      // [min, pivot)
      if (pivot - min == 0) {
        // It won't happen.
        code = 0;
      } else {
        t = Math.min(Math.max((value - min) / (pivot - min), 0), 1);
        code = Math.trunc(t * pivotCode + 0.5);
      }
    } else {
      // [pivot, max]
      if (max - pivot == 0) {
        // pivot == max
        code = mask;
      } else {
        t = Math.min(Math.max((value - pivot) / (max - pivot), 0), 1);
        code = Math.trunc(t * (mask - pivotCode) + 0.5) + pivotCode;
      }
    }

    this.writeBits(code, bits);
  }

  /**
   * Writes three packed compressed 32-bit, little-endian float to the stream.
   * @param {Vec3} value 
   * @param {Vec3} min 
   * @param {Vec3} max 
   * @param {Vec3} pivot 
   * @param {number} bits 
   */
  writeCompressedVec3(value, min, max, pivot, bits) {
    this.writeCompressedFloat(value.x, min.x, max.x, pivot.x, bits);
    this.writeCompressedFloat(value.y, min.y, max.y, pivot.y, bits);
    this.writeCompressedFloat(value.z, min.z, max.z, pivot.z, bits);
  }

  /**
   * Writes four packed compressed 32-bit, little-endian float from the stream.
   * @param {Vec4} value 
   * @param {Vec4} min 
   * @param {Vec4} max 
   * @param {Vec4} pivot 
   * @param {number} bits 
   */
  writeCompressedVec4(value, min, max, pivot, bits) {
    this.writeCompressedFloat(value.x, min.x, max.x, pivot.x, bits);
    this.writeCompressedFloat(value.y, min.y, max.y, pivot.y, bits);
    this.writeCompressedFloat(value.z, min.z, max.z, pivot.z, bits);
    this.writeCompressedFloat(value.w, min.w, max.w, pivot.w, bits);
  }

  /**
   * Write an object.
   * @param {IBinarying} t
   */
  writeType(t) {
    t.toStream(this);
  }
}

class ReadOnlyBinaryStream {
  constructor(buffer) {
    this.buffer = buffer || Buffer.alloc(0);
    this.cursor = 0;
    this.bitOffset = 0;
    this.errorFlag = false;
  }

  /**
   * Returns true if the buffer has been read to its end.
   * @returns {boolean}
   */
  done() {
    return this.cursor >= this.buffer.byteLength;
  }

  /**
   * Return the error flag.
   * @returns {boolean}
   */
  error() {
    return this.errorFlag;
  }

  /**
   * Get the total length of remaining data.
   * @returns {number}
   */
  getRemain() {
    if (this.done())
      return 0;
    return this.buffer.byteLength - this.cursor;
  }

  /**
   * Move the cursor for given advance. Returns -1 if out of range.
   * @param {number} advance 
   * @returns {number}
   */
  move(advance = 0) {
    if (this.done() || this.errorFlag)
      return -1;

    var cursor = this.cursor;

    // Reset bit offset.
    this.bitOffset = 0;

    this.cursor += advance;
    if (this.cursor > this.buffer.byteLength) {
      this.errorFlag = 1;
      return -1;
    }

    return cursor;
  }

  /**
   * Skip "count" bytes.
   * @param {number} [count] 
   */
  skip(count = 0) {
    this.move(count);
  }

  /**
   * Read "count" bits.
   * @param {number} count 
   * @returns {number}
   */
  readBits(count) {
    if (count < 1 || count > 32) {
      this.errorFlag = true;
      return 0;
    }
    if (this.done()) {
      this.errorFlag = true;
      return 0;
    }

    var result = 0
      , bitsRead = 0
      , byte, available, need, take, bits;

    while (bitsRead < count) {
      if (this.done()) {
        this.errorFlag = true;
        return 0;
      }

      byte = this.buffer[this.cursor];
      available = 8 - this.bitOffset;
      need = count - bitsRead;
      take = need < available ? need : available;
      // Extract the "take" bits from "bitoffset".
      bits = (byte >>> this.bitOffset) & ((1 << take) - 1);
      // Convert to u32.
      result |= (bits << bitsRead) >>> 0;

      bitsRead += take;
      this.bitOffset += take;

      if (this.bitOffset == 8) {
        this.bitOffset = 0;
        this.cursor++;
      }
    }

    return result >>> 0;
  }

  /**
   * Read "count" bytes into a Buffer.
   * @param {number} count 
   * @returns {Buffer}
   */
  readBytes(count) {
    var result = Buffer.alloc(count)
      , cursor = this.move(count);

    if (cursor < 0)
      return result;

    result.set(this.buffer.subarray(cursor, cursor + count));

    return result;
  }

  /**
   * Writes a boolean to the stream.
   * @returns {boolean}
   */
  readBool() {
    return !!this.readBits(1);
  }

  /**
   * Reads a signed 8-bit integer from the stream.
   * @returns {number}
   */
  readInt8() {
    var cursor = this.move(1);
    if (cursor < 0)
      return 0;
    return this.buffer.readInt8(cursor);
  }

  /**
   * Reads an unsigned 8-bit integer from the stream.
   * @returns {number}
   */
  readUint8() {
    var cursor = this.move(1);
    if (cursor < 0)
      return 0;
    return this.buffer.readUint8(cursor);
  }

  /**
   * Reads a signed, little-endian 16-bit integer from the stream.
   * @returns {number}
   */
  readInt16() {
    var cursor = this.move(2);
    if (cursor < 0)
      return 0;
    return this.buffer.readInt16LE(cursor);
  }

  /**
   * Reads an unsigned, little-endian 16-bit integer from the stream.
   * @returns {number}
   */
  readUint16() {
    var cursor = this.move(2);
    if (cursor < 0)
      return 0;
    return this.buffer.readUint16LE(cursor);
  }

  /**
   * Reads a signed, little-endian 32-bit integer from the stream.
   * @returns {number}
   */
  readInt32() {
    var cursor = this.move(4);
    if (cursor < 0)
      return 0;
    return this.buffer.readInt32LE(cursor);
  }

  /**
   * Reads an unsigned, little-endian 32-bit integer from the stream.
   * @returns {number}
   */
  readUint32() {
    var cursor = this.move(4);
    if (cursor < 0)
      return 0;
    return this.buffer.readUint32LE(cursor);
  }

  /**
   * Reads a signed, little-endian 64-bit integer from the stream.
   * @returns {Long}
   */
  readInt64() {
    var cursorHi = this.move(4)
      , cursorLo = this.move(4)
      , hi, lo;

    if (cursorLo < 0 || cursorHi < 0)
      return Long.fromNumber(0);

    hi = this.buffer.readUint32LE(cursorHi);
    lo = this.buffer.readUint32LE(cursorLo);

    return new Long(lo, hi);
  }

  /**
   * Reads an unsigned, little-endian 32-bit integer from the stream.
   * @returns {Long}
   */
  readUint64() {
    var cursorHi = this.move(4)
      , cursorLo = this.move(4)
      , hi, lo;

    if (cursorLo < 0 || cursorHi < 0)
      return Long.fromNumber(0);

    hi = this.buffer.readUint32LE(cursorHi);
    lo = this.buffer.readUint32LE(cursorLo);

    return new Long(lo, hi, true);
  }

  /**
   * Reads a 32-bit, little-endian float from the stream.
   * @returns {number}
   */
  readFloat() {
    var cursor = this.move(4);
    if (cursor < 0)
      return 0;
    return this.buffer.readFloatLE(cursor);
  }

  /**
   * Reads a 64-bit, little-endian float from the stream.
   * @returns {number}
   */
  readDouble() {
    var cursor = this.move(8);
    if (cursor < 0)
      return 0;
    return this.buffer.readDoubleLE(cursor);
  }

  /**
   * Writes a compressed signed 32-bit integer to the stream.
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  readCompressedInt32(min, max) {
    min ^= 0x80000000;
    max ^= 0x80000000;
    return this.readCompressedUint32(min, max);
  }

  /**
   * Writes a compressed unsigned 32-bit integer to the stream.
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  readCompressedUint32(min, max) {
    min >>>= 0;
    max >>>= 0;

    if (min > max)
      throw new RangeError("min must be less than max.");

    var width = 32 - Math.clz32(max - min)
      , result;

    result = this.readBits(width) + min;

    return result;
  }

  /**
   * Reads a compressed 32-bit, little-endian float from the stream.
   * @param {number} min 
   * @param {number} max 
   * @param {number} pivot 
   * @param {number} bits 
   * @returns {number}
   */
  readCompressedFloat(min, max, pivot, bits) {
    min = Math.fround(min);
    max = Math.fround(max);
    pivot = Math.fround(pivot);

    return Math.fround(this.readCompressedDouble(min, max, pivot, bits));
  }

  /**
   * Reads a compressed 64-bit, little-endian float from the stream.
   * @param {number} min 
   * @param {number} max 
   * @param {number} pivot 
   * @param {number} bits 
   * @returns {number}
   */
  readCompressedDouble(min, max, pivot, bits) {
    if (min >= max)
      throw new RangeError("min must be less than max");
    if (pivot < min || pivot > max)
      throw new RangeError("pivot must be within [min, max]");
    if (bits < 1 || bits >= 32)
      throw new RangeError("bits must be between 1 and 31");

    var mask = ((1 << bits) - 1) >>> 0
      , range = max - min
      , pivotCode = Math.trunc(((pivot - min) / range) * mask)
      , result, code, t;

    code = this.readBits(bits);
    if (this.errorFlag)
      return 0;

    if (code <= pivotCode) {
      if (pivotCode === 0) {
        result = min;
      } else {
        t = code / pivotCode;
        result = min * (1 - t) + pivot * t;
      }
    } else {
      if (mask === pivotCode) {
        result = max;
      } else {
        t = (code - pivotCode) / (mask - pivotCode);
        result = pivot * (1 - t) + max * t;
      }
    }

    return result;
  }

  /**
   * Reads three compressed 32-bit, little-endian float from the stream.
   * @param {Vec3} min 
   * @param {Vec3} max 
   * @param {Vec3} pivot 
   * @param {number} bits 
   * @returns {Vec3}
   */
  readCompressedVec3(min, max, pivot, bits) {
    var result = new Vec3();

    result.x = this.readCompressedFloat(min.x, max.x, pivot.x, bits);
    result.y = this.readCompressedFloat(min.y, max.y, pivot.y, bits);
    result.z = this.readCompressedFloat(min.z, max.z, pivot.z, bits);

    return result;
  }

  /**
   * Reads four compressed 32-bit, little-endian float from the stream.
   * @param {Vec4} min 
   * @param {Vec4} max 
   * @param {Vec4} pivot 
   * @param {number} bits 
   * @returns {Vec4}
   */
  readCompressedVec4(min, max, pivot, bits) {
    var result = new Vec4();

    result.x = this.readCompressedFloat(min.x, max.x, pivot.x, bits);
    result.y = this.readCompressedFloat(min.y, max.y, pivot.y, bits);
    result.z = this.readCompressedFloat(min.z, max.z, pivot.z, bits);
    result.w = this.readCompressedFloat(min.w, max.w, pivot.w, bits);

    return result;
  }

  /**
   * @returns {boolean}
   */
  readBool() {
    return !!this.readUint8();
  }

  /**
   * Read an IBinarying object from the stream.
   * @param {Constructor<IBinarying>} T 
   * @returns {IBinarying}
   */
  readType(T) {
    return T.deserialize(this);
  }
}

module.exports = {
  ReadOnlyBinaryStream,
  WritableBinaryStream
};
