# CryLo shared Electron — GHSA-g3hv-75wg-m249 reachability evidence

Date: October 31, 2026
Branch: `audit/windows-warning-fixes`
**STATUS: SECURITY EXCEPTION NOT APPROVED; ALL RELEASES FROZEN.**

## CI evidence

- [Frozen-tree reachability CI run 41221046919](https://github.com/Heff546/CryLo/actions/runs/41221046919) completed successfully on Ubuntu with Node 24.21.0 and npm 12.1.0.
- Evidence script: [electron-minimatch-reachability-review.js](../../scripts/tests/electron-minimatch-reachability-review.js); [workflow](../../.github/workflows/electron-minimatch-reachability-review.yml). The full JSON is attached to the GitHub Actions run.
- `npm ci --ignore-scripts` succeeded with **unchanged** `electron/package.json` and `electron/package-lock.json`; the six installed `minimatch` paths matched the canonical lock.
- Full audit: **15 moderate package findings** associated with the new advisory chain. Production-only audit: **0** findings.
- `minimatch@3.1.5` (ASAR, glob, dir-compare) and `5.1.9` (filelist) lacked **both** `firstPhasePreProcess`/`secondPhasePreProcess` and the `globParts.push(other)` expansion in their installed source.
- `minimatch@9.0.9` (universal) and `10.2.6` (app-builder-lib) contained the named preprocessing and cloning code.
- The CI scanned 145 JS/CJS/MJS files from `app-builder-lib`, 14 from `@electron/universal`, 9 from ASAR, 3 from glob, 33 from dir-compare and 2 from filelist. It found **no explicit `optimizationLevel` token** in these inspected dependency-consumer files.
- The upstream tagged sources for [v9.0.9, line 468](https://github.com/isaacs/minimatch/blob/v9.0.9/src/index.ts#L468) and [v10.2.6, line 567](https://github.com/isaacs/minimatch/blob/v10.2.6/src/index.ts#L567) show `const { optimizationLevel = 1 } = this.options`. The advisory's described dangerous expansion requires **level 2 or higher**.
- Separate upstream source review of v6.2.2 found that the described preprocessing functions are also absent there. v7.4.6 and v8.0.6 do implement them. This suggests the GitHub advisory's blanket `<11.0.1` range may over-flag older series **for this particular code path**, subject to upstream confirmation.

## What the evidence means

The reviewed CryLo tooling call sites use ordinary predefined build globs, with no explicit request for `optimizationLevel` 2. The exact amplification mechanism described in [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) was **not observed as invoked** by this packaging graph.

This is a **reachability indicator, not a full exploitability proof**. Static token scanning cannot exclude dynamically generated options, hidden entry points, different lifecycle execution contexts, malicious modifications to build inputs, or other preexisting advisories. No adversarial workload was run and this CI did **not** package a production installer.

In particular, **do not edit the advisories, override package versions, suppress `npm audit`, or call this a passing security release gate** solely based on this evidence. All 15 package findings still appear under the currently published advisory.

## Upstream status and resolution paths

- [electron-builder v26 PR #10538](https://github.com/electron-userland/electron-builder/pull/10538) became **ready for review** October 31; it remained open and unmerged when checked. It proposes to upgrade `app-builder-lib` from `minimatch` 10 to 11. It does not migrate the legacy copies.
- Upstream release `electron-builder@26.18.1` remains the most recent verified stable v26 version and does **not** close the advisory. CryLo keeps its previously validated **26.17.0** pinned.
- The preferred complete solution is a reviewed, published, compatible patch and a verified full dependency tree. A second path is a **maintainer-reviewed correction** to the advisory's affected version range, followed by targeted remediation of the genuinely affected consumers.
- If development-only residuals remain despite demonstrated unreachability, any exception requires a separately explicit risk-acceptance decision; this document does **not** authorize one.
- Earlier four-, two-, and nested-scope override experiments all showed that eliminating npm audit findings by forcing `minimatch@11` breaks the legacy glob/ASAR behavior. Do not reapply those techniques.

## Remaining release sequence

1. Validate an upstream-reviewed stable fix and/or maintainer-corrected advisory against the unmodified shared cross-platform package architecture; maintain full and production audit results as real data.
2. Run deterministic packaging compatibility across Windows NSIS + portable; Linux x64/ARM64; macOS Intel/Apple Silicon PKG, including ASAR file inclusion, native resource manifests and update/rollback preservation.
3. Then perform **one consolidated unsigned Windows native+Electron CI build** and the previously identified CryLo RPC/genesis/address/multisig/transfer/launcher checks. Only after this gate passes proceed to other platforms, which remain frozen.
4. Official Pi1 signing, tagging and publishing require separate final approval. Preserve user wallet/config data; Windows users must not require PowerShell, and every platform must retain one-command `crylo update`.

**No signing, release publishing, native rebuild, wallet-key migration or production dependency changes were performed in this review.**
