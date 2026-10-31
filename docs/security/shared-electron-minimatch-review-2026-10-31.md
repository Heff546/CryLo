# CryLo — Shared Electron security and compatibility review
Date: October 31, 2026

STATUS: **RELEASE BLOCKED. This document does not approve a security exception.**

## Scope and provenance

This review applies to ONE shared CryLo Electron package.json and package-lock.json for Windows x64, Linux x64, Linux ARM64, macOS Intel and macOS Apple Silicon. No Windows-specific package workaround is authorized.

- Electron: 44.9.3; electron-builder: 26.17.0 (unchanged).
- Release Node: 24.21.0; release npm: 12.1.0.
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), CVE-2026-118764 (updated October 30, 2026), affects minimatch versions less than 11.0.1. Patched version: 11.0.1. Resource-exhaustion risk arises from attacker-controlled pattern amplification.
- Fresh registry audit: **15 moderate development/packaging tree findings**, **0 high or critical**, and **0 production-only findings**.
- The 15 package rows are related through one transitive vulnerability chain; do not describe them as 15 separate independent CVEs.
- Deprecated development-only dependencies rimraf 2.6.3, glob 7.2.3, inflight 1.0.6, boolean 3.2.0 remain pinned. Deprecation notices are not equivalent to the vulnerability.
- Developer/packager-only classification does not establish that a build with untrusted patterns is safe.

## Evidence and trials

1. [CI #41216693326](https://github.com/Heff546/CryLo/actions/runs/41216693326): full audit 15 moderate; production-only audit zero; security gate deliberately fails.
2. [CI #41217358623](https://github.com/Heff546/CryLo/actions/runs/41217358623): four disposable scenarios. Existing lock: packaging APIs pass but 15 findings. Global minimatch 11.0.1 override: audit zero but glob7 matching and @electron/asar archive packaging FAIL. Stable electron-builder 26.18.1 alone: APIs pass but 15 findings remain. Builder 26.18.1 plus global override: audit zero but packaging APIs FAIL.
3. [CI #41217677066](https://github.com/Heff546/CryLo/actions/runs/41217677066): scoped modern-dependency overrides yielded zero or seven audit findings, but glob matching and ASAR packaging FAIL again.
4. All matrix jobs completed as *experiments*, not as release gates. Every attempted remediation reported candidateSafe=false.

The tests were in disposable directories and changed no canonical Electron dependencies, CryLo native code, user wallet files or release artifacts.

## Decision: do not mask the advisory by breaking packaging

- Do not merge global or scoped minimatch 11 overrides as tested; they break legacy package APIs.
- Do not bump stable electron-builder solely to silence warnings when it fails to remove them.
- Do not introduce Windows-only dependency differences or an unsupported prerelease packager merely to pass an audit.
- Do not silently downgrade, whitelist, suppress or waive the security finding.
- Keep all platform releases frozen; Pi1 retains authority for official signing and publishing.
- The shared lockfile remains unchanged while a compatible upstream remediation is evaluated.

## Exit criteria for security and Windows release

1. Identify a supported stable packaging dependency graph or independently reviewed compatibility-preserving patch that addresses the vulnerability. Re-run full and production npm audits with clear evidence of remaining findings; any residual advisory requires explicit separate security approval.
2. Re-test all shared build-tool APIs including glob file selection, ASAR archive pack/extract, Electron-builder, Windows NSIS/portable and all relevant Linux/macOS build configs; do not introduce platform divergence.
3. Once security and source gates are cleared, perform one consolidated unsigned Windows native plus Electron CI build and test CryLo URI parsing, v17 regtest genesis/RPC startup, wallet addresses, integrated addresses, multisig/transfer, installer/update/rollback and wallet data preservation.
4. Continue Windows normal-user CMD-only single-command update. Preserve data/config across install, update and uninstall. No official signing or multi-platform release until all release gates are approved.

## Explicit limitations

- No variant tested here was an acceptable complete security remediation.
- Older unsigned Windows wallet-RPC behavior was verified separately, but those binaries do not contain the staged C++ URI or regtest fixes.
- No native release build, package signing or publication is authorized by this record.
