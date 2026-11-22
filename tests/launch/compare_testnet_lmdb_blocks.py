#!/usr/bin/env python3
"""Read-only comparison of two saved CryLo LMDB 'blocks' tables.

This checks if a shorter saved chain is a byte-for-byte prefix of a longer
candidate. It does NOT prove which chain is canonical or authenticate remote
nodes. Requires mdb_dump from lmdb-utils. No daemon, RPC, network, wallets,
database writes, or additional Python packages.
"""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys


def read_blocks(db_dir: Path):
    if not (db_dir / "data.mdb").is_file():
        raise ValueError(f"Missing data.mdb: {db_dir}")
    result = subprocess.run(
        ["mdb_dump", "-s", "blocks", str(db_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(
            f"mdb_dump failed for {db_dir}: {result.stderr.strip()}"
        )
    lines = result.stdout.splitlines()
    if "HEADER=END" not in lines or "DATA=END" not in lines:
        raise ValueError(f"Unexpected mdb_dump output: {db_dir}")
    header_end = lines.index("HEADER=END")
    data_end = lines.index("DATA=END", header_end + 1)
    header = lines[:header_end]
    if "format=bytevalue" not in header or "database=blocks" not in header:
        raise ValueError(
            "Expected bytevalue-formatted named 'blocks' database"
        )
    data = lines[header_end + 1:data_end]
    if len(data) % 2:
        raise ValueError(f"Odd number of LMDB key/value lines: {db_dir}")
    result_pairs = []
    for index in range(0, len(data), 2):
        k, v = data[index:index + 2]
        if not k.startswith(" ") or not v.startswith(" "):
            raise ValueError("Expected indented LMDB key/value data lines")
        key, value = k.strip(), v.strip()
        if not re.fullmatch(r"[0-9a-fA-F]+", key):
            raise ValueError(f"Unexpected key encoding at entry {index // 2}")
        if len(value) % 2 or not re.fullmatch(r"[0-9a-fA-F]*", value):
            raise ValueError(f"Unexpected block encoding at entry {index // 2}")
        # Store just the digest; this avoids keeping binary block records.
        result_pairs.append((key.lower(), hashlib.sha256(
            bytes.fromhex(value)
        ).hexdigest()))
    return result_pairs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shorter", type=Path, help="saved smaller LMDB dir")
    parser.add_argument("longer", type=Path, help="saved larger LMDB dir")
    args = parser.parse_args()
    if not shutil.which("mdb_dump"):
        parser.error("mdb_dump missing (lmdb-utils needed)")
    left = read_blocks(args.shorter)
    right = read_blocks(args.longer)
    print("===== ISOLATED CRYLO V4 BLOCK PREFIX AUDIT =====")
    print(f"Shorter entries: {len(left)} (last index {len(left)-1})")
    print(f"Longer entries:  {len(right)} (last index {len(right)-1})")
    if not left or len(right) < len(left):
        raise ValueError("Expected nonempty longer candidate chain")
    for i, (a, b) in enumerate(zip(left, right)):
        if a != b:
            print(f"FAIL: blocks disagree at table entry {i}")
            print(f"  shorter key={a[0]}, sha256={a[1]}")
            print(f"  longer  key={b[0]}, sha256={b[1]}")
            return 1
    print(f"PASS: all {len(left)} shared block records match exactly")
    print(f"Additional candidate block records: {len(right)-len(left)}")
    print(f"Shared last record SHA256: {left[-1][1]}")
    print("This proves only shared LMDB table content, not canonicality.")
    print("Neither snapshot verifies the corrected height 2958.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
