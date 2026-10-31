# CryLo — Electron v26 upstream security remediation handoff
Date: 2026-10-31

**STATUS: RELEASE BLOCKED. No exception, override, signature, installer, or release is authorized here.**

## Verified upstream path

- GitHub advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) flags npm `minimatch` versions below **11.0.1** (CVE-2026-118764; moderate, resource-exhaustion risk).
- [electron-builder PR #10538](https://github.com/electron-userland/electron-builder/pull/10538) targets the **v26** packaging line used by CryLo and is **draft/open** at review. It proposes `app-builder-lib` `minimatch` `^10.2.5` → `^11.0.1`, resolving `11.0.3`, retaining the class API needed for FileMatcher. It is not a published stable fix or a CryLo release approval.
- [electron-builder PR #10539](https://github.com/electron-userland/electron-builder/pull/10539) targets v27 and is not an acceptable substitute for CryLo's unchanged shared v26 implementation without a separate complete migration.
- Upstream #10538 explicitly says that its patch does **not** fix legacy transitive `minimatch` copies. Do not assume a green builder FileMatcher test means the entire npm security audit is clear.
- Upstream tests and checks are still subject to review. Do not consume draft branch contents, prereleases, or a global override as a production dependency.

## CryLo source state

The isolated audit branch is `audit/windows-warning-fixes`. At review, `electron/package.json` pins `electron` **44.9.3** and `electron-builder` **26.17.0**. Its canonical `electron/package-lock.json` is blob `1a6f37beb42b1de5edfb40882f3ba9406eb4fb10`, also present on `feature/mac-first-build-gate`. No dependency changes are included in this handoff.

The canonical lock contains six `minimatch` instances, all in the advisory's flagged range:

| Dependency owner | Installed minimatch | Owner dependency |
| --- | --- | --- |
| `app-builder-lib@26.17.0` | `10.2.6` | `^10.2.5` |
| `@electron/asar@3.4.1` | `3.1.5` | `^3.0.4` |
| `@electron/universal@2.0.3` | `9.0.9` | `^9.0.3` |
| `dir-compare@4.2.0` | `3.1.5` | `^3.0.5` |
| `filelist@1.0.6` | `5.1.9` | `^5.0.1` |
| `glob@7.2.3` | `3.1.5` | `^3.1.1` |

These are six installed package paths, **not six separate CVEs**. There were **15 related moderate npm audit package findings**, with zero findings under `npm audit --omit=dev`, in the previous trial. Audit findings and exploitability must not be conflated.

## New isolated upstream candidate gate

Workflow: [electron-upstream-v26-security-gate.yml](../../.github/workflows/electron-upstream-v26-security-gate.yml)

- Only tests exact published stable builder v26 versions; no v27 migration, release publish or signing.
- Copies canonical package files into a temporary directory; verifies their SHA-256 remains unchanged.
- Pins Node **24.21.0**, npm **12.1.0**.
- Resolves the candidate in a disposable npm lock, audits all and production dependencies, and records every `minimatch` path.
- Tests app-builder-lib's patched class API, real CryLo shared Wallet/native packaging patterns, directory traversal, brace/exclusion/extglob matching, glob7 callable API, ASAR archive creation/extraction, and the electron-builder library API.
- Fail closed unless **all** candidate checks, full audit and production audit pass.
- A push to the isolated audit branch uses the already rejected v26.18.1 as a **negative control**; success means only that the gate correctly identified a blocked candidate. A manual run can test a later stable v26 version after upstream publishes it.
- JSON evidence is uploaded on both pass and failure.

## Remaining release gates

1. Upstream-reviewed and officially published stable v26 fix; complete zero-finding audited graph or separately reviewed and explicitly approved residual risk—**no silent suppressions**.
2. CryLo-specific disposable dependency and packaging compatibility validation, including Windows NSIS/portable, Linux x64/ARM64, macOS Intel/Apple Silicon.
3. One consolidated unsigned native + Electron Windows CI build after the security gate: RPC/genesis, wallet URI/address handling, multisig/transfer, installer/updater/rollback, CMD-only end-user commands, wallet/config preservation.
4. Mainnet-targeted security sign-off. Only Pi1 may sign/publish official releases; all other platform releases remain frozen until approval.

No CryLo mainline, canonical package-lock, native runtime, wallet data, or official release artifacts are modified by this handoff.
