# Testnet V4 treasury recipient custody and migration gate

**Security review — November 21, 2026. No private wallet material is included or requested.**

The existing published **Testnet.27** L1 source hard-codes **public** view and spend keys for three reward recipients in `src/cryptonote_config.h`:
- Development: **75 basis points** (0.75%), output [2].
- Liquidity: **25 basis points** (0.25%), output [3].
- CryLo Gas Treasury: **50 basis points** (0.50%), output [4].

`src/cryptonote_core/cryptonote_tx_utils.cpp` derives each coinbase one-time destination from those pairs of public keys. Those constants **are not proof that an actual owner-controlled wallet exists** or that its seed/spend key was backed up. The hard-coded `CryLo_DEV_FUND_ADDRESS_TESTNET` address string is **not** used to build the treasury outputs; the public key pair is. Derive and independently verify any displayed address against that actual pair and the selected Testnet address prefix.

**The operator reports that Development and Liquidity wallets have not yet been created. Ownership of the old receiving keys is unknown.** Do not assume that the original matching private spend keys exist, or that newly created wallets can unlock already mined outputs.

## Immediate custody priority — no blockchain mutation

1. Identify, **privately and locally**, whether the original treasury wallets or backups already exist in user-controlled archives/devices; never paste or upload wallet files, mnemonic seeds, private view keys or private spend keys into GitHub, tickets, chats or CI. Check Development, Liquidity, and Gas independently.
2. If an original recipient's private spend key/seed is **not** recoverable, its existing historical outputs cannot be recovered by generating a new random wallet. A publicly known *view* secret cannot spend funds. Do not attempt to rewrite history, silently redirect old outputs, mint replacement balances or transfer ownership via code.
3. Prepare **three separately controlled, new Testnet recipient wallets** as appropriate for a future security activation. The owner should create them on a trusted, preferably air-gapped machine with an authenticated CryLo Testnet wallet binary, unique wallet passwords and independently verified backups. Store wallet files outside Git worktrees. Mainnet must later use **entirely different** wallets.
4. Configure only **public** recipient information after independently verifying a Testnet address against its two public keys. The entire activation must remain a draft until the intended destinations and owner custody have been checked. Never reuse the historical publicly disclosed Development private viewing key for a future wallet.
5. Choose the activation height/version **only after** obtaining trustworthy current chain height and verifying historical Testnet V4 consensus on an isolated snapshot. Preserve all pre-activation blocks, including already paid treasury outputs. Never apply a new proof or recipient key rule retroactively.
6. The forward-only change must also address the existing Liquidity and Gas amount-only recipient checks with native public recipient proofs and correct network-domain separation. Native block acceptance/rejection, pre/post-activation history, reorg, sync and miner-template cases must pass before merging a new consensus implementation or publishing the next signed Testnet release.

## Locally creating a NEW Testnet wallet (after existing-key custody review)

The repository's wallet source supports `--testnet`, `--offline` (**no daemon or DNS connections by the wallet**) and `--generate-new-wallet`; the compiled executable is named `CryLo-wallet` (`src/simplewallet/CMakeLists.txt`). **Offline mode is not the same as physically air-gapping the computer.**

On a trusted machine running a verified CryLo Testnet binary, make a private, non-repository directory. Run interactively **without screen recording, terminal transcript capture, cloud backup or shell tracing**:

```bash
umask 077
ulimit -c 0
WALLET_BIN="$HOME/CryLo/build/linux-arm64/bin/CryLo-wallet"
test -x "$WALLET_BIN" || { echo "Verified CryLo-wallet binary unavailable"; exit 1; }
"$WALLET_BIN" --version

TREASURY_DIR="$HOME/.local/share/crylo-testnet-treasury"
mkdir -p -m 700 "$TREASURY_DIR"
chmod 700 "$TREASURY_DIR"

# Run separately, and follow interactive password/seed prompts:
"$WALLET_BIN" --testnet --offline \
  --generate-new-wallet "$TREASURY_DIR/testnet-development"

"$WALLET_BIN" --testnet --offline \
  --generate-new-wallet "$TREASURY_DIR/testnet-liquidity"
```

Use a separately verified wallet and custody process for the Gas Treasury if it has not already been securely provisioned. For long-term custody or Mainnet funds, an air-gapped, trusted device with tested offline backups is preferable to an internet-connected build workstation. A local encrypted wallet password does **not** substitute for the seed/spend-key backup.

At creation, verify the wallet's **public address** and securely back up its seed/keys offline. Do not paste private output from `seed`, `viewkey` or `spendkey` commands. The `.keys` file is secret, despite its filename. If help or flags differ from this pinned source, stop rather than improvise.

## Audit record and acceptance

Only **public** information may enter a later reviewed Testnet consensus PR:
- Recipient role, network, verified public address and corresponding two public keys;
- Owner confirmation that the private wallet exists and backups can be independently restored;
- Old-vs-new recipient distinction and explicit activation boundary;
- Validated Testnet network prefix and source-version provenance.

Do not commit real seed words, private wallet keys, passwords, backups or private signing material. Do not disclose them to contributors; no developer needs private keys to implement public recipient verification.

### Mandatory work holds

- **Testnet signed release:** `v1.1.1-testnet.27` stays intact.
- **Historical V4 rewards:** immutable even if old recipient private keys are unavailable.
- **Future Testnet activation:** not selected, not merged, not launched until custody and replay verified.
- **Mainnet:** CryLo Mainnet genesis, Mainnet Development/Liquidity wallets and Nexus Mainnet chain remain **not created** until Testnet is complete and verified.
