# bitmark-kernel

An independent, zero-build browser node for **[Bitmark](https://bitmark.rocks/)** — the
honest, no-premine chain live since 13 July 2014.

It does **not** reimplement consensus. Bitmark's transactions, scripts and merkle tree
are byte-for-byte Bitcoin, so this repo reuses the published
[`@bitcoin-kernel/kernel`](https://github.com/bitcoin-kernel/kernel) engine unchanged
and adds only two small things:

- **`schema/chain.js`** — the Bitmark chain parameters (~50 lines), injected as the network.
- **`unwrap.js`** — a dependency-free shim that strips Bitmark's multi-algo proof-of-work
  serialization (equihash's extended header, the auxpow merged-mining blob) back to a
  standard block before it reaches the engine.

This keeps the two projects cleanly separated: nothing Bitmark lives in bitcoin-kernel,
and Bitmark consumes bitcoin-kernel exactly as it is published.

## Proof

`proof/decode-block.mjs` runs real Bitmark blocks across all eight PoW algorithms
(`fixtures/`, including a merged-mining auxpow block and an equihash block) through the
kernel with the `bitmark:mainnet` schema injected, and confirms for **every** block:

- the recomputed **block hash** matches the node's (incl. equihash `GetHashE`),
- the **merkle root** matches the header,
- all structural consensus rules (coinbase, sigops, weight, duplicates, …) pass.

```
node proof/decode-block.mjs    # ✅ PROOF HOLDS — all algos, auxpow + equihash
```

## Scope: structure, merkle, scripts — not difficulty

The engine validates **structure, merkle root, transactions and scripts** for every
block. What stays **external** by design is multi-algo **difficulty**: re-running the
eight PoW hash functions (scrypt, sha256d, yescrypt, argon2, x17, lyra2rev2, equihash,
cryptonight) to check each header meets target. The block hashes still chain by SHA256d
linkage (and equihash's `GetHashE`), so blocks are anchored and ordered; difficulty
verification is a separate policy layer, the same split the bitcoin-kernel architecture
draws.

## Bitmark mainnet (from `bitmark/src/kernel/chainparams.cpp`)

| | |
|---|---|
| genesis | `c1fb746e…137cb` (t=1405274442, 20 BTM, P2PK) |
| magic / port | `f9beb4d9` / 9265 |
| block time | 2 min (retarget every 720) |
| supply | 28,000,000 BTM · halving 788000 |
| addresses | P2PKH 85 · P2SH 5 · bech32 `btm` |
| soft forks | BIP34@1, BIP65/66@451166 · no CSV, no SegWit |

## Hosting

Published from the **gh-pages** branch, like every other piece of the stack. The live
proof runs at **https://project-bitmark.github.io/bitmark-kernel/** and packages are
reachable via jsDelivr (`cdn.jsdelivr.net/gh/project-bitmark/bitmark-kernel@<ver>/...`).
A dedicated custom domain can come later; the apex `bitmark.rocks` belongs to the
explorer site and is intentionally left untouched.

## License

AGPL-3.0-or-later.
