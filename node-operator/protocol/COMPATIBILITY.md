# CryLoNexus Operator Protocol Compatibility

## Mainnet identity

- Network: `CryLoNexus Mainnet`
- Chain ID: `5546`
- Native gas asset: `CRYLO`
- Native gas decimals: `18`
- CryLo decimals: `11`
- wCryLo decimals: `11`
- Operator service: `crylo-nexus-operator.service`

These values are consensus and product identity checks. A package or
configuration that does not match them must not be treated as a mainnet
operator installation.

## Version fields

The operator protocol uses independent versions:

- `schemaVersion`
  - Shape of a specific JSON document.
- `protocolVersion`
  - Behavioral compatibility between Electron and the operator service.
- `serviceVersion`
  - Installed operator software release.
- `minimumElectronVersion`
  - Oldest Electron release allowed to consume a release manifest.

Changing one version does not automatically require changing the others.

## Compatibility policy

Electron may accept a document only when:

1. The JSON parses successfully.
2. The document is within the configured maximum byte size.
3. The document passes its exact schema.
4. `network` equals `CryLoNexus Mainnet`.
5. `chainId` equals `5546`.
6. The operator address matches the wallet expected by Electron.
7. The protocol version is supported.
8. The status timestamp is not unreasonably in the future.
9. The status age is within the configured freshness limit.
10. No secret field is present.

Unknown properties are rejected in version 1.

## Release-channel policy

Mainnet Electron defaults to the `stable` channel.

The following channels must require an explicit development setting:

- `release-candidate`
- `development`

A lower-trust channel must never be selected automatically.

## Release verification

A release is trusted only after all required verification succeeds:

1. Manifest signature is valid.
2. Manifest product is `CryLoNexus Operator`.
3. Manifest network is `CryLoNexus Mainnet`.
4. Manifest chain ID is `5546`.
5. Selected asset architecture matches the host.
6. Selected asset SHA-256 matches the manifest.
7. Release protocol version is compatible.
8. Electron version satisfies `minimumElectronVersion`.
9. Release version is not revoked by a valid signed policy.

A checksum downloaded from the same unverified source as a binary is not,
by itself, sufficient proof of authenticity.

## Configuration security

Operator configuration must never contain:

- CryLo mnemonic or seed
- CryLo wallet password
- CryLo wallet file
- Nexus wallet private key
- Deployer or owner key
- Reward treasury key
- Bridge reserve key
- Release-signing private key

The operator host generates and protects its own node identity locally.

## Status-file handling

Electron must treat operator status as untrusted input.

Required protections:

- maximum file size;
- strict JSON parsing;
- exact schema validation;
- HTML-free text rendering;
- timestamp freshness checks;
- chain ID validation;
- operator wallet matching;
- bounded arrays and message lengths.

A malformed status document must produce a controlled unavailable state,
not crash the Electron renderer.

## Backward compatibility

A schema change is backward compatible only when all currently valid
documents remain valid and retain the same meaning.

Because version 1 rejects unknown properties, adding a new property requires
a new schema version unless the property already exists as optional.

A protocol version increase is required when Electron and the service change
behavior in a way that cannot safely interoperate with the previous protocol.

## Mainnet release rule

No release should be promoted to `stable` until:

- automated tests pass;
- amd64 and arm64 artifacts are built;
- checksums are generated;
- SBOMs are generated;
- release metadata is signed;
- package installation is tested on a clean supported Linux host;
- upgrade and rollback are tested;
- Node Center compatibility is verified;
- a human reviews the draft GitHub Release.
