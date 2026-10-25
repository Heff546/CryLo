# CryLo macOS unsigned launch: verification and installation

## Launch policy

CryLo's initial macOS distribution does **not** require a paid Apple Developer
ID, Apple code-signing certificate, or notarization. Consequently, Gatekeeper
may block the PKG or applications until the **user** explicitly authorizes them.
CryLo must not remove the quarantine attribute, disable Gatekeeper, launch the
installer with elevated privileges, or change macOS security settings silently.

An unsigned PKG is never authenticated merely because it came from GitHub or
has the expected filename. Only the trusted Pi1 Ed25519-signed CryLo release
manifest and its exact SHA-256/byte-size record authorize the PKG. The release
sequence may not fall below the locally accepted rollback floor.

## Supported Intel and Apple Silicon artifacts

- Intel x64: `CryLo-<version>-mac-x64-unsigned.pkg`
- Apple Silicon ARM64: `CryLo-<version>-mac-arm64-unsigned.pkg`

The version, platform, architecture, package filename, hash, and size must match
the signed manifest. Never rename a mismatched package to make it pass.

## For users

The installed macOS PKG includes a `/usr/local/bin/crylo` command. In Terminal,
run **`crylo update`** to authenticate and prepare a matching Intel or Apple Silicon
release without Homebrew, Git or a source checkout. The command asks permission
to download and then opens the verified PKG in macOS Installer, where you approve
installation under normal macOS security controls. After Installer says success,
return to the same Terminal and press Enter. CryLo checks a fresh Installer
receipt and all installed application files against the Pi1-authenticated PKG
before advancing release-security state. Cancelling or failing cannot advance
rollback protection. No Pi1-signed update means no installation.

1. Obtain an official CryLo release through the Pi1-authenticated release
   channel. Do **not** install GitHub Actions' unsigned CI validation artifacts
   as official public releases.
2. From an installed Mac CryLo Wallet, choose **CryLo Wallet → Check for Verified
   Updates…**. The wallet checks official release metadata, authenticates the
   Pi1 Ed25519 signature against its bundled pinned public key, and selects
   only the PKG matching Intel or Apple Silicon. It asks permission before
   downloading and verifies the exact installer bytes. Users maintaining a
   source checkout may alternatively use `crylo update` to prepare a verified
   installer. Neither path automatically installs software.
3. Choose **Reveal in Finder**, then open the verified PKG yourself and review
   the macOS installer. If macOS
   blocks opening software from an unidentified developer, follow Apple's
   official **System Settings > Privacy & Security > Open Anyway** review flow
   *only if you independently trust and have verified this exact release*.
   Some managed devices will not permit this exception.
4. Do not turn off Gatekeeper globally, run an `xattr` command to clear
   quarantine, or override a malware/damaged-file warning.
5. Finish the installation through Apple's normal installer interface.
   Keep wallet, keys, configuration, and blockchain data in their existing
   user-owned directories; do not delete them to upgrade CryLo.

An Apple Developer ID certificate may be added after launch. CryLo release
signing on Pi1 is a separate mandatory authenticity mechanism.

## For release engineering

- CI may generate **unsigned validation artifacts**; only Pi1 signs and
  publishes official manifests/releases.
- The macOS trust gate requires Ed25519 verification, exact PKG content hash,
  CPU architecture, network and release sequence before private staging.
- A prepared PKG does **not** prove the installation succeeded. Do not advance
  `release-security.json` on download or staging.
- Preserve wallet/config/app-data directories during fresh install, upgrade,
  interruption, rollback and removal of old app versions.
- The installed Electron GUI can discover and stage verified packages, but a
  complete official Pi1-signed Mac release must be published before real
  end-to-end update/download tests can pass.
- Actual Intel and Apple Silicon fresh-install, upgrade, post-install version,
  shutdown/startup and wallet-data preservation tests remain mandatory.
- Package staging and Finder reveal do not prove installation succeeded. The
  release-security sequence must not advance until installation is verified.

Apple's macOS security guidance:
https://support.apple.com/en-us/102445
