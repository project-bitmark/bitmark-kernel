// PROOF: with the unwrap layer, the unmodified @bitcoin-kernel/kernel engine
// decodes + structurally validates EVERY Bitmark block — all 8 PoW algorithms,
// including merged-mining (auxpow) and equihash — with only Bitmark's chain
// schema injected. Bitmark adds just unwrap.js (PoW-serialization byte-walking)
// and schema/chain.js; the consensus engine is Bitcoin's, untouched.

import { readFileSync } from 'node:fs';

const KERNEL = process.env.KERNEL_DIR
  ? new URL('file://' + process.env.KERNEL_DIR + '/index.js')
  : new URL('../../../bitcoin-kernel/kernel/packages/kernel/index.js', import.meta.url);
const { Codec, BlockEngine, schemas, dsha256, reverseHex, hexToBytes } = await import(KERNEL.href);
const bitmarkChain = (await import(new URL('../schema/chain.js', import.meta.url).href)).default;
const { unwrapBitmarkBlock } = await import(new URL('../unwrap.js', import.meta.url).href);

const codec = new Codec(schemas.core, schemas.proof);
const blocks = BlockEngine.fromSchemas(codec, bitmarkChain, schemas.validate, schemas.script, 'bitmark:mainnet');

const fixtures = [
  { h: 0,       file: 'block0.hex',       hash: 'c1fb746e87e89ae75bdec2ef0639a1f6786744639ce3d0ece1dcf979b79137cb' },
  { h: 1,       file: 'block1.hex',       hash: 'eb114fd075298dd4f113a3af621c812d3f2b1ffda1f20002dbd52179bf62d0a9' },
  { h: 1200000, file: 'block1200000.hex', hash: '7e3c4277aef41f2c221b6cf94363a20268dbca6f94d8544cd9a915ca89759119' },
  { h: 700000,  file: 'block700000.hex',  hash: '90320f2e6f73e0a4fcf3bcc799ad1615082f274535e5b44d70d517fdfcc07f4f' },
  { h: 2398000, file: 'block2398000.hex', hash: '000006af14784999b84179f4b42ab35abc50f4559cbd4239e2bc99166604aee8' },
];

const pad = (s, n) => String(s).padEnd(n);
let allOk = true;
console.log(pad('height', 9), pad('algo', 11), pad('aux', 5), pad('decode', 7), pad('id-hash', 8), pad('merkle', 7), 'structure');
console.log('─'.repeat(70));
for (const fx of fixtures) {
  const hex = readFileSync(new URL(`../fixtures/${fx.file}`, import.meta.url), 'utf8').trim();
  let algo = '?', aux = '–', decode = '✗', hashOk = '✗', merkleOk = '✗', structOk = '✗', ok = false;
  try {
    const u = unwrapBitmarkBlock(hex);
    algo = u.algo; aux = u.auxpow ? 'yes' : '–';
    const block = codec.decode('Block', u.standardBlockHex);
    decode = '✓';
    hashOk = reverseHex(dsha256(hexToBytes(u.headerHex))) === fx.hash ? '✓' : '✗';
    merkleOk = codec.merkleRoot(block.transactions.map((tx) => codec.txid(tx))) === block.header.merkleRoot ? '✓' : '✗';
    structOk = blocks.validateBlockStructure(block).ok ? '✓' : '✗';
    ok = decode === '✓' && hashOk === '✓' && merkleOk === '✓' && structOk === '✓';
  } catch (e) { decode = '✗ ' + e.message.slice(0, 18); }
  allOk &&= ok;
  console.log(pad(fx.h, 9), pad(algo, 11), pad(aux, 5), pad(decode, 7), pad(hashOk, 8), pad(merkleOk, 7), structOk);
}
console.log('─'.repeat(70));
console.log(allOk
  ? '✅ PROOF HOLDS — every Bitmark block (all algos, auxpow + equihash) validates via the unmodified kernel.'
  : '❌ FAILED');
process.exit(allOk ? 0 : 1);
