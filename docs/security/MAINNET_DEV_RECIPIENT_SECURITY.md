# Mainnet Development Fund recipient: key separation and public proof

**Status: UNRELEASED REVIEW CANDIDATE — not yet compiled or validated on Pi1. Mainnet release remains blocked.**

## Background

CryLo Testnet V4 publicly contains a Development Fund **private viewing key** used by historical block validation. A viewing key cannot independently spend coins, but it is no longer private and cannot be safely reused for the production Mainnet Development Fund. The names `CryLo_DEV_FUND_SPENDKEY` and `CryLo_DEV_FUND_VIEWKEY` in the old configuration refer to **public** keys, not private spending keys.

Never rewrite the signed `v1.1.1-testnet.27` source or invalidate historical Testnet blocks to hide that viewing key. Git history and previously distributed binaries cannot be retroactively sanitized.

## Candidate design

The existing Mainnet source candidate already had distinct public recipient DLEQ proofs for Liquidity [3] and Gas Treasury [4]. This branch adds the analogous Development Fund proof for output [2], with domain `CryLo:mainnet:DevelopmentFundCoinbase:DLEQ:v1`, typed transaction-extra tag `0x07`, and canonical 96-byte payload in a 98-byte field.

The complete, strict suffix is **[Development 0x07][Liquidity 0x06][Gas 0x05]**, each field containing one 32-byte shared point, one 64-byte transaction proof, and its canonical tag/length. Development signs the original coinbase prefix, Liquidity signs the prefix including Development, Gas signs the prefix including both. Mainnet validation checks each DLEQ signature, authenticated recipient output key, view tag, block height and canonical proof layout. Duplicate, missing, malformed, re-ordered or changed fields must fail.

Testnet/Stagenet **retain their historical Development viewing-key validation**. Only the separate unreleased Mainnet source is changed here. This is a new **Mainnet consensus candidate**, NOT a compatible update to the published Testnet.27 chain.

## Required independent Mainnet Development wallet

The source declares two deliberately **unset** values in `src/cryptonote_config.h`:

- `CryLo_MAINNET_DEV_FUND_VIEWKEY` — **public** view key, hex.
- `CryLo_MAINNET_DEV_FUND_SPENDKEY` — **public** spend key, hex.

Before native Mainnet block testing, the owner must generate a NEW Mainnet Development wallet using a trusted offline wallet environment, preserve its seed/private keys in secure offline backups, independently verify its address, and configure ONLY the two **public** keys in the isolated candidate. Never upload wallet files, private view/spend keys, seed phrases, or private signing keys to GitHub, CI, or chats.

Both public keys must differ from the historical Testnet Development keys. The official Mainnet preflight refuses unconfigured or reused keys and cannot authorize a release while native consensus evidence is outstanding.

**Mainnet is intentionally unable to construct valid Development recipient templates until a new wallet is provisioned. Do not bypass this failure or reinsert the exposed Testnet view secret.**

## Outstanding launch evidence

1. Confirm new Development wallet ownership and public address ↔ public-key consistency offline.
2. Compile Mainnet candidate natively on Pi1; run the Development/Liquidity/Gas proof GTests and real isolated offline Mainnet block acceptance/rejection tests, including the nonce-size 127→128 transition.
3. Replay original Testnet V4 historical blocks through the expected height without modifying Pi1's canonical LMDB.
4. Independently review DLEQ domain separation, tag parsing, subgroup validation, output derivation, version/hardfork behavior, miner-template weight padding, and network-specific recipient isolation.
5. Audit all Git history and deployed secrets; rotate every wallet with a *spending* key or seed that was ever exposed, if any are found.
6. Complete independent Mainnet genesis, five-platform deterministic native checks, Mainnet-only update channel and official release approval.

This candidate is a draft for security review. **No merge to `main` or `testnet`, no Mainnet chain initialization or production release signing** until the above gates pass.
