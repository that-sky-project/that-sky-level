/**
 * Minimal LZ4 block-format codec (pure JS, no native dependency).
 *
 * Sky:CotL compresses each level file segment (LOD payloads, cloud SDF, etc.)
 * as a single raw LZ4 *block* (no frame magic / size header / checksum) and
 * decompresses with LZ4_decompress_safe. This module implements:
 *  - decompressBlock: a correct LZ4 block decoder (reads real game segments).
 *  - compressBlock:   a valid literal-only LZ4 block encoder (no match search,
 *                     larger output but always correct), good enough to produce
 *                     game-loadable segments without a native compressor.
 */

const MIN_MATCH = 4;
// LZ4 end-of-block rules: the final 5 bytes are always literals, and no match
// may start within the last 12 bytes of the block.
const LAST_LITERALS = 5;
const MF_LIMIT = 12;

/**
 * Decompress a raw LZ4 block.
 * @param {Buffer|Uint8Array} src compressed block
 * @param {number} [maxOut] optional output capacity hint
 * @returns {Buffer}
 */
function decompressBlock(src, maxOut) {
  var out = Buffer.alloc(maxOut && maxOut > 0 ? maxOut : src.length * 4 + 64)
    , sp = 0
    , dp = 0;

  function ensure(extra) {
    if (dp + extra <= out.byteLength)
      return;
    var n = out.byteLength;
    while (dp + extra > n) n <<= 1;
    var grown = Buffer.alloc(n);
    out.copy(grown, 0, 0, dp);
    out = grown;
  }

  while (sp < src.length) {
    var token = src[sp++];

    // Literals.
    var litLen = token >> 4;
    if (litLen === 15) {
      var b;
      do { b = src[sp++]; litLen += b; } while (b === 255);
    }
    ensure(litLen);
    for (var i = 0; i < litLen; i++)
      out[dp++] = src[sp++];

    // The last sequence ends after its literals (no match).
    if (sp >= src.length)
      break;

    // Match.
    var offset = src[sp] | (src[sp + 1] << 8);
    sp += 2;
    if (offset === 0)
      throw new Error("lz4: invalid match offset 0");

    var matchLen = token & 0x0F;
    if (matchLen === 15) {
      var mb;
      do { mb = src[sp++]; matchLen += mb; } while (mb === 255);
    }
    matchLen += MIN_MATCH;

    ensure(matchLen);
    var mp = dp - offset;
    if (mp < 0)
      throw new Error("lz4: match offset before output start");
    // Byte-by-byte copy (overlapping matches are legal in LZ4).
    for (var j = 0; j < matchLen; j++)
      out[dp++] = out[mp++];
  }

  return out.subarray(0, dp);
}

/**
 * Encode a raw LZ4 block with a fast hash-chain match finder. Output is a
 * valid LZ4 block that LZ4_decompress_safe reproduces exactly. Honors the LZ4
 * end-of-block rules (last 5 bytes are literals; no match within the last 12
 * bytes) so the game's safe decoder accepts it.
 * @param {Buffer|Uint8Array} src
 * @returns {Buffer}
 */
function compressBlock(src) {
  var n = src.length;

  // Too small to contain a match under the end-of-block rules: emit literals.
  if (n < MF_LIMIT + 1)
    return literalBlock(src);

  var HASH_LOG = 16
    , table = new Int32Array(1 << HASH_LOG).fill(-1)
    , out = []
    , anchor = 0
    , ip = 0
    , mflimit = n - MF_LIMIT       // no match may START past here
    , matchlimit = n - LAST_LITERALS; // matches may not COVER the last 5 bytes

  function u32(p) {
    return (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
  }
  function hash(v) {
    return ((Math.imul(v, 2654435761) >>> 0) >>> (32 - HASH_LOG));
  }
  function emitLen(arr, v) {
    while (v >= 255) { arr.push(255); v -= 255; }
    arr.push(v);
  }
  function emitSeq(litStart, litEnd, offset, matchLen) {
    var litLen = litEnd - litStart
      , ml = matchLen - MIN_MATCH
      , token = ((litLen >= 15 ? 15 : litLen) << 4) | (ml >= 15 ? 15 : ml);
    out.push(token);
    if (litLen >= 15) emitLen(out, litLen - 15);
    for (var i = litStart; i < litEnd; i++) out.push(src[i]);
    out.push(offset & 0xFF, (offset >> 8) & 0xFF);
    if (ml >= 15) emitLen(out, ml - 15);
  }

  ip++; // LZ4 starts match search at the second byte
  while (ip < mflimit) {
    var h = hash(u32(ip))
      , ref = table[h];
    table[h] = ip;

    if (ref < 0 || ip - ref > 0xFFFF || u32(ref) !== u32(ip)) {
      ip++;
      continue;
    }

    // Extend the match forward.
    var matchLen = MIN_MATCH;
    while (ip + matchLen < matchlimit && src[ref + matchLen] === src[ip + matchLen])
      matchLen++;

    emitSeq(anchor, ip, ip - ref, matchLen);
    ip += matchLen;
    anchor = ip;
  }

  // Trailing literals (final match-less sequence).
  var lastLen = n - anchor
    , lastTok = (lastLen >= 15 ? 15 : lastLen) << 4;
  out.push(lastTok);
  if (lastLen >= 15) emitLen(out, lastLen - 15);
  for (var k = anchor; k < n; k++) out.push(src[k]);

  var result = Buffer.from(out);

  // Defensive self-check: our decoder is validated against real game data, so
  // if the compressed block round-trips through it we know it is a spec-valid
  // LZ4 block. On any mismatch, fall back to the trivially-correct literal
  // block rather than risk emitting a file the game cannot decompress.
  var srcBuf = Buffer.isBuffer(src) ? src : Buffer.from(src);
  if (Buffer.compare(decompressBlock(result, n), srcBuf) !== 0)
    return literalBlock(src);

  return result;
}

/** Encode `data` as a single match-less (all-literals) LZ4 block. */
function literalBlock(data) {
  var len = data.length
    , header = [];
  if (len < 15) {
    header.push(len << 4);
  } else {
    header.push(0xF0);
    var remaining = len - 15;
    while (remaining >= 255) { header.push(255); remaining -= 255; }
    header.push(remaining);
  }
  return Buffer.concat([Buffer.from(header), Buffer.from(data)]);
}

module.exports = { decompressBlock, compressBlock };
