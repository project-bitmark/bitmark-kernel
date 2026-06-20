# bitmark-kernel

An independent, zero-build browser node for **[Bitmark](https://bitmark.rocks/)** — the
honest, no-premine chain live since 13 July 2014.

It does **not** reimplement consensus. Bitmark's wire format is byte-for-byte Bitcoin,
so this repo reuses the published [`@bitcoin-kernel/kernel`](https://github.com/bitcoin-kernel/kernel)
engine unchanged and injects **only a Bitmark chain schema** (`schema/chain.js`). Same
codec, transactions, scripts and merkle tree; only the network parameters differ.

This keeps the two projects cleanly separated: nothing Bitmark lives in bitcoin-kernel,
and Bitmark consumes bitcoin-kernel exactly as it is published.

## Proof

`proof/decode-block.mjs` runs real Bitmark blocks (genesis + block 1, in `fixtures/`)
through the kernel with the `bitmark:mainnet` schema injected and confirms:

- the codec reproduces the node's **block hash** exactly,
- the **merkle root** matches the header,
- all structural consensus rules (coinbase, sigops, weight, duplicates, …) pass.

```
node proof/decode-block.mjs    # ✅ PROOF HOLDS
```

## Scope: structure, not PoW

The kernel validates **structure, merkle root, transactions and scripts** —
PoW-independently. This covers the SHA256d-anchored majority of Bitmark history
without trusting anyone. What it deliberately does **not** do is validate Bitmark's
**multi-algorithm proof-of-work** (8 algorithms: scrypt, sha256d, yescrypt, argon2d,
x17, lyra2rev2, equihash, cryptonight). Difficulty/PoW is an external policy layer;
the exotic-PoW headers (~8% of blocks) are verified by linkage + checkpoints, not by
re-running each algorithm. See the bitcoin-kernel architecture for the same split.

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

Published from **gh-pages**, like every other piece of the stack, served at
**bitmark.rocks** and via jsDelivr — mirroring how bitcoin-kernel ships from gh-pages
to bitcoin-kernel.com.

## License

AGPL-3.0-or-later.
