// Follow the live Bitmark chain, validating each block forward. Sources blocks +
// prevouts from the local bitmarkd (raw block -> unwrap -> decode; prevouts via
// getrawtransaction), validates structure + scripts/sigs + fees + maturity with
// only bitmark:mainnet injected, and tracks the tip with reorg awareness. No UTXO
// set held — bitmarkd resolves prevouts on demand, so this is light.
//
// Scope: structure + scripts + UTXO (multi-algo PoW stays external for Bitmark).
//   START=<height>  where to begin (default: tip - 15, to show a short catch-up)

import { execSync } from 'node:child_process';

const KERNEL = new URL('../../../bitcoin-kernel/kernel/packages/kernel/index.js', import.meta.url);
const { Codec, BlockEngine, schemas } = await import(KERNEL.href);
const bitmarkChain = (await import(new URL('../schema/chain.js', import.meta.url).href)).default;
const { unwrapBitmarkBlock } = await import(new URL('../unwrap.js', import.meta.url).href);

const codec = new Codec(schemas.core, schemas.proof);
const be = BlockEngine.fromSchemas(codec, bitmarkChain, schemas.validate, schemas.script, 'bitmark:mainnet');

const RPC = 'http://127.0.0.1:9266/';
const AUTH = 'Basic ' + Buffer.from('bitmarkrpc:H8WZpWhp85pQn8VQ6vPZykWM9dXGrifEkKzYHSiBnwNv').toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: AUTH }, body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const NULL_TXID = '00'.repeat(32);
const txCache = new Map();
const getTx = async (txid) => { if (!txCache.has(txid)) { txCache.set(txid, await rpc('getrawtransaction', [txid, 1])); if (txCache.size > 5000) txCache.delete(txCache.keys().next().value); } return txCache.get(txid); };

const tip = await rpc('getblockcount', []);
const target = tip;
let height = Number(process.env.START || tip - 15);
let prevHash = await rpc('getblockhash', [height - 1]);
const recent = new Map();   // height -> hash, for reorg detection
console.log(`validating Bitmark ${height.toLocaleString()} → ${target.toLocaleString()} (bitmarkd tip) forward\n`);

const t0 = Date.now(); let done = 0;
while (height <= target) {
  const hash = await rpc('getblockhash', [height]);
  const raw = await rpc('getblock', [hash, false]);
  const u = unwrapBitmarkBlock(raw);
  const blk = codec.decode('Block', u.standardBlockHex);

  // reorg: does it build on our last accepted block?
  if (blk.header.prevBlockHash !== prevHash) {
    let fork = height - 1;
    while (fork > height - 50 && recent.get(fork) !== (await rpc('getblockhash', [fork]))) fork--;
    console.log(`\n⟲ reorg detected at ${height.toLocaleString()} → re-aligning from ${fork.toLocaleString()}`);
    height = fork + 1; prevHash = await rpc('getblockhash', [fork]); continue;
  }

  // resolve prevouts + validate forward
  const view = new Map();
  let ins = 0;
  for (const tx of blk.transactions) for (const inp of tx.inputs) {
    if (inp.prevout.txid === NULL_TXID) continue; ins++;
    const key = `${inp.prevout.txid}:${inp.prevout.vout}`; if (view.has(key)) continue;
    const pt = await getTx(inp.prevout.txid); const o = pt.vout[inp.prevout.vout];
    view.set(key, { output: { value: Math.round(o.value * 1e8), scriptPubKey: o.scriptPubKey.hex }, height: tip - pt.confirmations + 1, coinbase: 'coinbase' in pt.vin[0] });
  }
  // Bitmark's coinbase subsidy is a complex scaled emission-based formula (post-"fork 1",
  // per-algo scaling via the UPDATE_SSF version bit) that our simple-halving schema can't
  // express — so we don't validate coinbase-amount for Bitmark (like multi-algo PoW, it's
  // an external/known gap). Everything else (structure/scripts/UTXO/maturity/fees) we do check.
  const BITMARK_SKIP = new Set(['btc:rule-blockctx-coinbase-amount']);
  const failed = [...be.validateBlockStructure(blk).results, ...be.validateBlockContext(blk, { height, utxo: view }).results].filter((r) => r.ok === false && !BITMARK_SKIP.has(r.rule));
  if (failed.length) { console.log(`\n❌ block ${height} INVALID: ${failed.map((f) => f.rule).join(', ')} — stopping`); process.exit(1); }

  recent.set(height, hash); recent.delete(height - 60);
  prevHash = hash; done++;
  const rate = done / ((Date.now() - t0) / 1000);
  console.log(`h ${height.toLocaleString().padStart(9)}  ${hash.slice(0, 12)}…  ${u.algo.padEnd(10)} txs ${String(blk.transactions.length).padStart(3)}  ins ${String(ins).padStart(3)}  ✓  ${rate.toFixed(2)} blk/s`);
  height++;
}
console.log(`\n✅ ${done} live Bitmark blocks validated forward (structure + scripts + UTXO).`);
console.log(`   Known Bitmark gaps not checked: coinbase subsidy (scaled emission, bip-0102) + multi-algo PoW.`);
process.exit(0);
