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

1. Obtain the official CryLo release and its Pi1-signed manifest through the
   authenticated CryLo release channel. Do **not** install GitHub Actions'
   unsigned CI test artifacts as official public releases.
2. Verify the downloaded package using the currently trusted CryLo release key.
   The source-checkout `crylo update` command may prepare a verified PKG
   in the user's private CryLo application-support staging directory. This is
   **preparation only**; the installed Electron wallet does not yet provide a
   completed automatic-update experience.
3. Open the verified PKG in Finder and review the macOS installer. If macOS
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
- Actual Intel and Apple Silicon fresh-install/upgrade tests and installed
  Electron GUI update integration remain required before the public launch.

Apple's macOS security guidance:
https://support.apple.com/en-us/102445
