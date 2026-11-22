#!/usr/bin/env python3
"""Read-only audit of one SAVED Pi1 LMDB copy against the verified anchor RPC.

Reference identity: crylo-anchor, 127.0.0.1:22641, 2026-11-21.
Anchor /get_height: 2958 blocks (highest height 2957).
These SHA256 values are of the serialized block bytes returned by the
production getblock RPC (NOT Cryptonote block IDs), so they can be directly
compared against the values in the LMDB 'blocks' table.

This proves exact identity only at the three pinned checkpoints. It cannot
prove the provenance of unexamined blocks, validate PoW or consensus replay,
or establish canonical status for height >= 2958.
"""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys

EXPECTED_BLOCK_COUNT = 2958
ANCHOR_SHA256 = {
    0: "2e7a9caf6fccf27d2d3bca47695e5a238dcc089a731c847a5379f155f0ab7f08",
    2777: "a177632e7274881b3fbb57816ecb57aea41a6e11f82953cceecfa43f25cc5496",
    2957: "1f17b4467e246d810ea273fbe114c8e8a47c91a3d2d0d4f7641072cc8788d92f",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="saved, inactive Pi1 LMDB directory")
    args = parser.parse_args()
    path = args.snapshot
    if not (path / "data.mdb").is_file():
        parser.error(f"Missing snapshot data.mdb: {path}")
    if not shutil.which("mdb_dump"):
        parser.error("mdb_dump missing; install lmdb-utils on Pi1")

    result = subprocess.run(
        ["mdb_dump", "-s", "blocks", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise ValueError(
            "Read-only mdb_dump failed: " + result.stderr.strip()
        )

    lines = result.stdout.splitlines()
    if "HEADER=END" not in lines or "DATA=END" not in lines:
        raise ValueError("Missing LMDB dump header/data terminators")
    begin = lines.index("HEADER=END")
    end = lines.index("DATA=END", begin + 1)
    header = lines[:begin]
    if "format=bytevalue" not in header or "database=blocks" not in header:
        raise ValueError("Unexpected LMDB database/encoding")
    pairs = lines[begin + 1:end]
    if len(pairs) % 2 != 0:
        raise ValueError("Odd number of dump key/value lines")

    count = len(pairs) // 2
    print("===== SAVED V4 SNAPSHOT VS VERIFIED ANCHOR RPC =====")
    print(f"Saved snapshot: {path}")
    print(f"Block records: {count} (last expected height {count - 1})")
    if count != EXPECTED_BLOCK_COUNT:
        raise ValueError(
            f"Snapshot has {count} blocks, expected exactly "
            f"{EXPECTED_BLOCK_COUNT} from anchor"
        )

    matched = set()
    for index in range(count):
        key_line, value_line = pairs[2*index:2*index + 2]
        if not key_line.startswith(" ") or not value_line.startswith(" "):
            raise ValueError(f"LMDB dump indentation invalid at {index}")
        key, value = key_line.strip(), value_line.strip()
        if len(key) != 16 or not re.fullmatch(r"[0-9a-fA-F]{16}", key):
            raise ValueError(f"LMDB blocks key malformed at {index}")
        if int.from_bytes(bytes.fromhex(key), "little") != index:
            raise ValueError(f"LMDB block height/key mismatch at entry {index}")
        if len(value) % 2 or not re.fullmatch(r"[0-9a-fA-F]+", value):
            raise ValueError(f"LMDB block blob malformed at entry {index}")
        if index in ANCHOR_SHA256:
            digest = hashlib.sha256(bytes.fromhex(value)).hexdigest()
            expected = ANCHOR_SHA256[index]
            if digest != expected:
                print(f"FAIL at height {index}:")
                print(f"  anchor SHA256:   {expected}")
                print(f"  snapshot SHA256: {digest}")
                return 1
            matched.add(index)
            print(f"PASS block {index}: {digest}")

    if matched != set(ANCHOR_SHA256):
        raise ValueError("One or more anchor checkpoints missing")

    print("PASS: all three anchor RPC serialized-block fingerprints match.")
    print("PASS: exactly 2958 contiguous height keys (0..2957).")
    print("LIMIT: no canonical blocks 2958+ exist on anchor.")
    print("LIMIT: this is not full block-validation/replay or every-block comparison.")
    print("NO ORIGINAL DB OR RUNNING SERVICE WAS MODIFIED.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
