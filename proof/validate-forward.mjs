// Validate a REAL Bitmark block forward with the unmodified @bitcoin-kernel/kernel
// engine: decode it (unwrap auxpow/equihash), resolve its prevouts from the local
// bitmarkd, run full block-context validation (scripts/sigs/fees/structure) with
// only the bitmark:mainnet chain schema injected, then cross-check against the
// explorer's Mongo index (values + spent heights) as the ground-truth oracle.
//
//   BLOCK=<height>   which block to validate (default 1,200,000 — X17, 75-input spend)
//
// Scope: structure + scripts + UTXO (same as the testnet4 PoC). Multi-algo PoW
// difficulty stays external for Bitmark (the 8-algo wall) — not validated here.

import { execSync } from 'node:child_process';

const KERNEL = process.env.KERNEL_DIR
  ? new URL('file://' + process.env.KERNEL_DIR + '/index.js')
  : new URL('../../../bitcoin-kernel/kernel/packages/kernel/index.js', import.meta.url);
const { Codec, BlockEngine, schemas } = await import(KERNEL.href);
const bitmarkChain = (await import(new URL('../schema/chain.js', import.meta.url).href)).default;
const { unwrapBitmarkBlock } = await import(new URL('../unwrap.js', import.meta.url).href);

const codec = new Codec(schemas.core, schemas.proof);
const be = BlockEngine.fromSchemas(codec, bitmarkChain, schemas.validate, schemas.script, 'bitmark:mainnet');

const RPC = 'http://127.0.0.1:9266/';
const AUTH = 'Basic ' + Buffer.from('bitmarkrpc:H8WZpWhp85pQn8VQ6vPZykWM9dXGrifEkKzYHSiBnwNv').toString('base64');
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: AUTH }, body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const mongo = (txid, vout) => {
  const out = execSync(`mongosh bitmark --quiet --eval 'JSON.stringify(db.utxos.findOne({txid:"${txid}",vout:${vout}},{value:1,spent_height:1,coinbase:1,_id:0}))'`).toString().trim();
  try { return JSON.parse(out); } catch { return null; }
};

const HEIGHT = Number(process.env.BLOCK || 1200000);
const NULL_TXID = '00'.repeat(32);
const tip = await rpc('getblockcount', []);
const hash = await rpc('getblockhash', [HEIGHT]);
const raw = await rpc('getblock', [hash, false]);

const u = unwrapBitmarkBlock(raw);
const block = codec.decode('Block', u.standardBlockHex);
console.log(`block ${HEIGHT.toLocaleString()} = ${hash}\n  algo ${u.algo}  auxpow ${u.auxpow}  txs ${block.transactions.length}`);

// resolve every non-coinbase prevout from bitmarkd → coin view
const txCache = new Map();
const getTx = async (txid) => { if (!txCache.has(txid)) txCache.set(txid, await rpc('getrawtransaction', [txid, 1])); return txCache.get(txid); };
const view = new Map();
let inputs = 0;
for (const tx of block.transactions) {
  for (const inp of tx.inputs) {
    if (inp.prevout.txid === NULL_TXID) continue;
    inputs++;
    const key = `${inp.prevout.txid}:${inp.prevout.vout}`;
    if (view.has(key)) continue;
    const pt = await getTx(inp.prevout.txid);
    const o = pt.vout[inp.prevout.vout];
    view.set(key, { output: { value: Math.round(o.value * 1e8), scriptPubKey: o.scriptPubKey.hex }, height: tip - pt.confirmations + 1, coinbase: 'coinbase' in pt.vin[0] });
  }
}
console.log(`resolved ${view.size} prevouts for ${inputs} inputs (via bitmarkd)`);

// validate forward
const sr = be.validateBlockStructure(block);
const cr = be.validateBlockContext(block, { height: HEIGHT, utxo: view });
const mark = (r) => r.ok === true ? '✓' : r.ok === false ? '✗ FAIL' : '– skip';
console.log(`\nstructure: ${sr.ok ? 'OK ✓' : 'FAIL ✗'}`);
console.log('context (resolved against bitmarkd prevouts):');
for (const r of cr.results) console.log(`  ${mark(r)}  ${r.rule}`);

// Mongo oracle cross-check (sample)
console.log('\nexplorer (Mongo) cross-check — value + spent_height == this block:');
let xok = 0, xn = 0;
for (const [key, coin] of [...view.entries()].slice(0, 6)) {
  const i = key.lastIndexOf(':'); const txid = key.slice(0, i), vout = Number(key.slice(i + 1));
  const m = mongo(txid, vout); xn++;
  const valOk = m && m.value === coin.output.value;
  const spentOk = m && m.spent_height === HEIGHT;
  if (valOk && spentOk) xok++;
  console.log(`  ${txid.slice(0, 12)}…:${vout}  value ${valOk ? '✓' : `✗ ${m?.value}≠${coin.output.value}`}  spent@${m?.spent_height} ${spentOk ? '✓' : ''}`);
}

const failed = cr.results.filter((r) => r.ok === false).length;
console.log((sr.ok && !failed)
  ? `\n✅ real Bitmark block validated forward (structure + scripts + UTXO) — explorer agrees on ${xok}/${xn} sampled prevouts.`
  : `\n❌ validation failed (${failed} rule(s)).`);
process.exit(sr.ok && !failed ? 0 : 1);
