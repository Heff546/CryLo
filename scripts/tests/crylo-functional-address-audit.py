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
    "tests/functional_tests/blockchain.py",
    "tests/functional_tests/txpool.py",
    "tests/functional_tests/rpc_payment.py",
    "tests/functional_tests/uri.py",
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
    if name.endswith("/uri.py"):
        if "def test_crylo_uri(self):" not in s or "self.primary_address = res.address" not in s or "'monero:' + address" not in s:
            raise SystemExit("FAIL: CryLo URI tests missing dynamic addresses and legacy-scheme rejection")
    elif name.endswith("/rpc_payment.py"):
        if "os.environ['CRYLO_REGTEST_RPC_PAYMENT_ADDRESS']" not in s:
            raise SystemExit("FAIL: RPC payment test not using explicit CryLo address")
    elif "self.mining_address = res.address" not in s or "validate_address(self.mining_address).valid" not in s:
        raise SystemExit("FAIL: RPC wallet-derived address contract missing: " + name)
    if name.endswith("/txpool.py"):
        if "self.destination_address = destination.address" not in s:
            raise SystemExit("FAIL: txpool destination is not wallet-generated")
# URI support is part of the same address-migration release gate.
wallet_cpp = (ROOT / "src/wallet/wallet2.cpp").read_text(encoding="utf8")
unit_cpp = (ROOT / "tests/unit_tests/wallet_storage.cpp").read_text(encoding="utf8")
release_yml = (ROOT / ".github/workflows/windows-pinned-unsigned-native-release.yml").read_text(encoding="utf8")
if 'uri.compare(0, scheme_length, uri_scheme) != 0' not in wallet_cpp or 'uri.substr(scheme_length)' not in wallet_cpp:
    raise SystemExit("FAIL: CryLo URI parsing scheme length and offset are not synchronized")
if 'TEST(wallet_storage, crylo_uri_roundtrip)' not in unit_cpp or 'EXPECT_FALSE(wallet.parse_uri("monero:" + address' not in unit_cpp:
    raise SystemExit("FAIL: CryLo URI regression does not cover roundtrip and legacy-scheme rejection")
if 'wallet_storage.crylo_uri_roundtrip' not in release_yml:
    raise SystemExit("FAIL: Windows native wallet gate does not execute the URI regression")

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
