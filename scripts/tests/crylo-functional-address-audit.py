#!/usr/bin/env python3
"""No-build audit: legacy addresses must not be used as live regtest mining/payment inputs."""
import ast
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
ACTIVE = (
    "tests/functional_tests/functional_tests_rpc.py",
    "tests/functional_tests/mining.py",
    "tests/functional_tests/get_output_distribution.py",
    "tests/functional_tests/p2p.py",
)
# Detect legacy Monero-form base58 constants; do not treat copyright headers as an address.
MONERO_ADDRESS_LIKE = re.compile(r"(?<![A-Za-z0-9])[48][1-9A-HJ-NP-Za-km-z]{80,115}(?![A-Za-z0-9])")
for name in ACTIVE:
    content = (ROOT / name).read_text(encoding="utf8")
    ast.parse(content, filename=name)
    if MONERO_ADDRESS_LIKE.search(content):
        raise SystemExit("FAIL: legacy mainnet address in migrated RPC test: " + name)
launcher = (ROOT / ACTIVE[0]).read_text(encoding="utf8")
if "CRYLO_REGTEST_RPC_PAYMENT_ADDRESS" not in launcher:
    raise SystemExit("FAIL: RPC payment address is not explicitly provided")
if "--rpc-payment-address" not in launcher:
    raise SystemExit("FAIL: RPC payment coverage silently disabled")
if "startswith('Wo')" not in launcher:
    raise SystemExit("FAIL: CryLo regtest address prefix preflight absent")
for name in ACTIVE[1:]:
    s = (ROOT / name).read_text(encoding="utf8")
    if "self.mining_address = res.address" not in s or "validate_address(self.mining_address).valid" not in s:
        raise SystemExit("FAIL: RPC wallet-derived address contract missing: " + name)
other = {}
for file in sorted((ROOT / "tests/functional_tests").glob("*.py")):
    if file.relative_to(ROOT).as_posix() in ACTIVE:
        continue
    n = len(MONERO_ADDRESS_LIKE.findall(file.read_text(encoding="utf8")))
    if n:
        other[file.name] = n
report = {
    "classification": "WINDOWS_CRYLO_FUNCTIONAL_ADDRESS_MIGRATION_AUDIT_ONLY",
    "releaseFrozen": True,
    "mayPublish": False,
    "rpcIntegrationExecuted": False,
    "migrated": list(ACTIVE),
    "remainingLegacyAddressCandidatesByFile": other,
    "note": "Remaining fixtures require wallet-derived CryLo addresses or verified CryLo vectors. Do not change upstream copyright or compatibility fixtures blindly."
}
print(json.dumps(report, indent=2))
