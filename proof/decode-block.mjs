// PROOF + BOUNDARY MAP: how far the unmodified @bitcoin-kernel/kernel engine gets
// on REAL Bitmark blocks, with ONLY Bitmark's chain schema injected.
//
// Bitmark reuses Bitcoin's entire transaction/script/merkle/codec stack and supplies
// nothing but ../schema/chain.js. This script runs real fixtures spanning Bitmark's
// 8-algo PoW and reports exactly where structural reuse holds vs. where Bitmark's
// PoW serialization needs an external layer.
//
// Kernel source: published at cdn.jsdelivr.net/gh/bitcoin-kernel/kernel@<ver>/packages/kernel
// (the browser build imports that URL directly). For this Node proof, KERNEL_DIR points
// at a local checkout of the same package; defaults to the sibling monorepo.

import { readFileSync } from 'node:fs';

const KERNEL = process.env.KERNEL_DIR
  ? new URL('file://' + process.env.KERNEL_DIR + '/index.js')
  : new URL('../../../bitcoin-kernel/kernel/packages/kernel/index.js', import.meta.url);
const { Codec, BlockEngine, schemas } = await import(KERNEL.href);
const bitmarkChain = (await import(new URL('../schema/chain.js', import.meta.url).href)).default;

const codec = new Codec(schemas.core, schemas.proof);
const blocks = BlockEngine.fromSchemas(codec, bitmarkChain, schemas.validate, schemas.script, 'bitmark:mainnet');

// header kinds: 'standard' = 80-byte header (codec handles fully, any PoW algo);
//               'auxpow'   = merged-mining blob between header and txs;
//               'equihash' = solution appended -> non-80-byte header.
const fixtures = [
  { h: 0,       file: 'block0.hex',       algo: 'SHA256D',   ntx: 1, kind: 'standard', hash: 'c1fb746e87e89ae75bdec2ef0639a1f6786744639ce3d0ece1dcf979b79137cb' },
  { h: 1,       file: 'block1.hex',       algo: 'SHA256D',   ntx: 1, kind: 'standard', hash: 'eb114fd075298dd4f113a3af621c812d3f2b1ffda1f20002dbd52179bf62d0a9' },
  { h: 1200000, file: 'block1200000.hex', algo: 'X17',       ntx: 3, kind: 'standard', hash: '7e3c4277aef41f2c221b6cf94363a20268dbca6f94d8544cd9a915ca89759119' },
  { h: 700000,  file: 'block700000.hex',  algo: 'LYRA2REv2', ntx: 1, kind: 'auxpow',   hash: '90320f2e6f73e0a4fcf3bcc799ad1615082f274535e5b44d70d517fdfcc07f4f' },
  { h: 2398000, file: 'block2398000.hex', algo: 'EQUIHASH',  ntx: 1, kind: 'equihash', hash: '000006af14784999b84179f4b42ab35abc50f4559cbd4239e2bc99166604aee8' },
];

const pad = (s, n) => String(s).padEnd(n);
let standardOk = true;
console.log(pad('height', 9), pad('algo', 11), pad('hdr', 9), pad('decode', 8), pad('id-hash', 9), pad('merkle', 8), 'structure');
console.log('─'.repeat(72));
for (const fx of fixtures) {
  const hex = readFileSync(new URL(`../fixtures/${fx.file}`, import.meta.url), 'utf8').trim();
  let decode = '✗', hashOk = '–', merkleOk = '–', structOk = '–';
  try {
    const block = codec.decode('Block', hex);
    decode = '✓';
    hashOk = codec.blockHash(block.header) === fx.hash ? '✓' : '✗';
    const merkle = codec.merkleRoot(block.transactions.map((tx) => codec.txid(tx)));
    merkleOk = merkle === block.header.merkleRoot ? '✓' : '✗';
    structOk = blocks.validateBlockStructure(block).ok ? '✓' : '✗';
  } catch (e) {
    decode = '✗ ' + e.message.slice(0, 14);
  }
  if (fx.kind === 'standard') standardOk &&= (decode === '✓' && hashOk === '✓' && merkleOk === '✓' && structOk === '✓');
  console.log(pad(fx.h, 9), pad(fx.algo, 11), pad(fx.kind, 9), pad(decode, 8), pad(hashOk, 9), pad(merkleOk, 8), structOk);
}
console.log('─'.repeat(72));
console.log(standardOk
  ? '✅ Standard-header blocks (any PoW algo, multi-tx) fully validate via the unmodified kernel.'
  : '❌ A standard-header block failed — regression.');
console.log('ℹ  auxpow / equihash rows show the boundary: Bitmark\'s merged-mining & equihash');
console.log('   PoW serialization wraps the block, so full decode needs a small Bitmark-side');
console.log('   unwrap layer. The 80-byte header identity + SHA256d linkage still anchor them.');
process.exit(standardOk ? 0 : 1);
