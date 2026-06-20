// bitmark-kernel — chain schema for Bitmark mainnet.
//
// This is the ONLY consensus artifact Bitmark has to provide. Everything else
// (transaction/script/merkle/codec rules) is injected from the published
// @bitcoin-kernel/kernel engine unchanged — Bitmark's wire format is byte-for-byte
// Bitcoin (proven: the kernel codec reproduces Bitmark's block hashes and merkle
// roots exactly; see ../proof/decode-block.mjs).
//
// Source of truth: project-bitmark/bitmark/src/kernel/chainparams.cpp (CMainParams),
// consensus/consensus.h (COINBASE_MATURITY), consensus/amount.h (MAX_MONEY).
//
// SCOPE: structural consensus only. Bitmark's multi-algorithm proof-of-work (8
// algos) is NOT expressed here and NOT checked by the kernel — header difficulty
// is validated externally (see SPEC). The kernel validates structure, merkle root,
// transactions and scripts; that covers the SHA256d-anchored majority of the chain
// PoW-independently. Difficulty/PoW fields below are descriptive, not enforced here.

export default {
  '@context': { bitmark: 'https://bitmark.rocks/ns#' },
  '@graph': [
    {
      '@id': 'bitmark:mainnet',
      '@type': 'bitmark:NetworkParams',
      label: 'mainnet',
      comment: 'Bitmark mainnet — an honest, no-premine SHA256d/multi-algo chain live since 2014-07-13.',
      name: 'mainnet',
      magic: 'f9beb4d9',
      genesisHash: 'c1fb746e87e89ae75bdec2ef0639a1f6786744639ce3d0ece1dcf979b79137cb',

      // PoW (descriptive only — multi-algo difficulty validated outside the kernel)
      powLimit: '00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      targetTimespan: 86400,   // 1 day
      targetSpacing: 120,      // 2-minute blocks
      difficultyAdjustmentInterval: 720,
      maxFutureBlockTime: 7200,

      // monetary policy
      halvingInterval: 788000,
      initialSubsidy: 2000000000,    // 20 BTM
      maxMoney: 2800000000000000,    // 28,000,000 BTM

      // network / address encoding
      port: 9265,
      p2pkhVersion: 85,
      p2shVersion: 5,
      secretVersion: 213,
      bech32Hrp: 'btm',
      xpubVersion: 76067358,         // 0x0488B21E

      // block limits
      maxBlockWeight: 4000000,
      maxBlockSigopsCost: 80000,
      coinbaseMaturity: 720,

      // soft-fork activation heights
      bip34Height: 1,
      bip65Height: 451166,
      bip66Height: 451166,
      csvHeight: null,       // never activated on Bitmark
      segwitHeight: null,    // never activated — blocks carry no witness data
    },
  ],
};
