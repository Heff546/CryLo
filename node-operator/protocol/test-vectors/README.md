# CryLoNexus Evidence Protocol Test Vectors

These files are immutable reference vectors for Evidence Protocol V1.

They define expected outputs for:

- CEP-1 canonical JSON
- CEP-2 normalized status hashing
- CEP-2 unsigned heartbeat payload hashing

Compatible implementations must reproduce the canonical JSON strings and
Keccak-256 hashes exactly.

After release, these files must not be silently regenerated or modified.
An intentional protocol change requires a new protocol version and new vector
filenames.
