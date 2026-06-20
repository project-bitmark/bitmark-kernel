// bitmark-kernel/unwrap.js
//
// Strip Bitmark's multi-algorithm proof-of-work serialization down to a plain
// Bitcoin block that the unmodified @bitcoin-kernel/kernel codec decodes as-is.
//
// Bitmark blocks deviate from Bitcoin's wire format in exactly two places, both
// in/around the header (the transaction list is identical Bitcoin):
//
//   1. EQUIHASH blocks use an extended header — an extra hashReserved (32) after
//      the merkle root, and a 256-bit nNonce + a length-prefixed solution vector
//      in place of the 4-byte nonce.
//   2. AUXPOW (merged-mined) blocks append a CAuxPow blob between the header and
//      the transactions: the parent-chain coinbase (CMerkleTx), two merkle
//      branches, a chain index, and the parent block header (itself algo-aware).
//
// This walker reproduces Bitmark's CBlockHeader / CPureBlockHeader / CAuxPow
// serialization (primitives/{block,pureheader,transaction}.h) to find where the
// transaction list begins, then emits a synthetic standard 80-byte header + the
// real transactions. The engine then does the rest unchanged: decode, txids,
// merkle root, structural rules.
//
// Pure and dependency-free (byte-walking + hex only). Hashing stays with the
// kernel in the caller: the block identity hash is reverseHex(dsha256(headerHex)),
// where headerHex is the *real* pure-header bytes returned here — for non-equihash
// that's the 80-byte header (Bitmark GetHash), for equihash it's the 1487-byte
// header (Bitmark GetHashE). Both reproduce the node's block hash exactly.

const hexToBytes = (h) => { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; };
const bytesToHex = (b) => { let s = ''; for (const x of b) s += x.toString(16).padStart(2, '0'); return s; };

// nVersion bit layout (primitives/pureheader.h): bit 8 = auxpow, bits 9-11 = algo.
const ALGO = { SCRYPT: 0, SHA256D: 1, YESCRYPT: 2, ARGON2: 3, X17: 4, LYRA2REv2: 5, EQUIHASH: 6, CRYPTONIGHT: 7 };
const ALGO_NAMES = ['SCRYPT', 'SHA256D', 'YESCRYPT', 'ARGON2', 'X17', 'LYRA2REv2', 'EQUIHASH', 'CRYPTONIGHT'];
const algoOf = (v) => (v >> 9) & 7;
const isAuxpow = (v) => (v & (1 << 8)) !== 0;
const u32le = (b, p) => (b[p] | b[p + 1] << 8 | b[p + 2] << 16 | b[p + 3] * 0x1000000) >>> 0;

class Reader {
  constructor(bytes) { this.b = bytes; this.p = 0; }
  u32() { const v = u32le(this.b, this.p); this.p += 4; return v; }
  skip(n) { this.p += n; }
  varint() {
    const x = this.b[this.p++];
    if (x < 0xfd) return x;
    if (x === 0xfd) { const v = this.b[this.p] | this.b[this.p + 1] << 8; this.p += 2; return v; }
    if (x === 0xfe) return this.u32();
    const lo = this.u32(), hi = this.u32(); return lo + hi * 0x100000000;
  }
  vector() { this.skip(this.varint()); }        // length-prefixed bytes
  hashes() { this.skip(this.varint() * 32); }   // vector<uint256>
}

// Walk one CPureBlockHeader. isParent selects the auxpow parent-block variants.
function readPureHeader(r, isParent, parentAlgo) {
  if (isParent && parentAlgo === ALGO.CRYPTONIGHT) { r.vector(); return r.p; } // raw vector_rep
  const start = r.p;
  const algo = isParent ? parentAlgo : algoOf(u32le(r.b, r.p));
  r.skip(4 + 32 + 32);                                  // version + prevBlock + merkleRoot
  if (algo === ALGO.EQUIHASH) r.skip(32);               // hashReserved
  r.skip(4 + 4);                                        // nTime + nBits
  if (algo === ALGO.EQUIHASH) { r.skip(32); r.vector(); } // nNonce256 + nSolution
  else r.skip(4);                                       // nNonce
  return start;
}

// CMerkleTx: CMutableTransaction (no witness) + hashBlock + vMerkleBranch + nIndex
function skipMerkleTx(r) {
  r.u32();                                              // tx version
  let n = r.varint();
  for (let i = 0; i < n; i++) { r.skip(36); r.vector(); r.u32(); } // prevout + scriptSig + sequence
  n = r.varint();
  for (let i = 0; i < n; i++) { r.skip(8); r.vector(); }           // value + scriptPubKey
  r.u32();                                              // locktime
  r.skip(32);                                           // hashBlock
  r.hashes();                                           // vMerkleBranch
  r.u32();                                              // nIndex
}

function skipAuxpow(r, mainAlgo) {
  skipMerkleTx(r);
  r.hashes();                                           // vChainMerkleBranch
  r.u32();                                              // nChainIndex
  readPureHeader(r, true, mainAlgo);                    // parentBlock (algo-aware)
}

/**
 * Unwrap a raw Bitmark block (hex) into a standard Bitcoin block the kernel decodes.
 * @returns {{ algo, auxpow, headerHex, standardBlockHex }}
 *   headerHex        — real pure-header bytes; identity hash = reverseHex(dsha256(headerHex))
 *   standardBlockHex — synthetic 80-byte header + the real transactions, for codec.decode('Block')
 */
export function unwrapBitmarkBlock(hex) {
  const b = hexToBytes(hex.trim());
  const r = new Reader(b);
  const version = u32le(b, 0);
  const algo = algoOf(version);
  const aux = isAuxpow(version);

  const hStart = readPureHeader(r, false, null);
  const headerEnd = r.p;
  if (aux) skipAuxpow(r, algo);
  const txBytes = b.subarray(r.p);

  // synthesize a standard 80-byte header (legacy field layout) + the real txs.
  const off = hStart + 68 + (algo === ALGO.EQUIHASH ? 32 : 0); // start of nTime
  const std = new Uint8Array(80 + txBytes.length);
  std.set(b.subarray(hStart, hStart + 68), 0);   // version + prev + merkle
  std.set(b.subarray(off, off + 8), 68);          // nTime + nBits
  if (algo !== ALGO.EQUIHASH) std.set(b.subarray(off + 8, off + 12), 76); // nNonce (else left zero)
  std.set(txBytes, 80);

  return {
    algo: ALGO_NAMES[algo],
    auxpow: aux,
    headerHex: bytesToHex(b.subarray(hStart, headerEnd)),
    standardBlockHex: bytesToHex(std),
  };
}
