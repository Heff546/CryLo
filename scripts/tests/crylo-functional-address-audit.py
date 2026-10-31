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
    "tests/functional_tests/speed.py",
    "tests/functional_tests/sign_message.py",
    "tests/functional_tests/proofs.py",
    "tests/functional_tests/cold_signing.py",
    "tests/functional_tests/integrated_address.py",
    "tests/functional_tests/wallet.py",
    "tests/functional_tests/address_book.py",
    "tests/functional_tests/transfer.py",
    "tests/functional_tests/multisig.py",
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
    elif name.endswith("/sign_message.py"):
        if "self.address.append(res.address)" not in s or "validate_address(self.address[i]).valid" not in s:
            raise SystemExit("FAIL: message-signing addresses must come from CryLo wallet RPC")
    elif name.endswith("/proofs.py"):
        if "self.address.append(res.address)" not in s or "self.mine(self.address[0], 80)" not in s:
            raise SystemExit("FAIL: proof inputs must be restored CryLo wallet addresses")
    elif name.endswith("/cold_signing.py"):
        expected = ("self.standard_address = res.address", 'if not hasattr(self, "subaddress")',
                    "self.subaddress == hot_subaddress.address", "self.hot_wallet.validate_address(self.subaddress).valid")
        if any(x not in s for x in expected):
            raise SystemExit("FAIL: cold-signing hot/cold wallet address parity missing")
    elif name.endswith("/integrated_address.py"):
        expected = ("self.addresses.append(result.address)", "wallet.split_integrated_address(combined)",
                    "wallet.validate_address(corrupt_address).valid")
        if any(x not in s for x in expected):
            raise SystemExit("FAIL: integrated-address roundtrip/negative coverage missing")
    elif name.endswith("/wallet.py"):
        if "from crylo_address_vectors import" not in s or "assert res.address == PRIMARY_ADDRESS" not in s or "address_0_999 = SUB_0_999_ADDRESS" not in s:
            raise SystemExit("FAIL: wallet deterministic vectors or lookahead vector missing")
    elif name.endswith("/address_book.py"):
        required = ('self.primary_address == PRIMARY_ADDRESS', 'SUB_1_2_ADDRESS',
                    'CRYLO_TEST_OPENALIAS', 'CRYLO_TEST_OPENALIAS_EXPECTED_ADDRESS',
                    'SKIP: external OpenAlias DNS integration')
        if any(item not in s for item in required) or "donate@getmonero.org" in s:
            raise SystemExit("FAIL: address book uses old Monero address or unreviewed external OpenAlias fixture")
    elif name.endswith("/transfer.py"):
        required = ("self.wallet_addresses.append(res.address)",
                    "len(set(self.wallet_addresses)) == len(seeds)",
                    "SUB_VALIDATION_1", "INTEGRATED_ADDRESS_VALIDATION",
                    "address_0_999 = SUB_0_999_ADDRESS",
                    "self.wallet[0].validate_address(INTEGRATED_ADDRESS_VALIDATION).valid")
        if any(item not in s for item in required):
            raise SystemExit("FAIL: CryLo transfer destinations are not wallet-derived or independently pinned")
    elif name.endswith("/multisig.py"):
        if 'from crylo_address_vectors import PRIMARY_ADDRESS' not in s or 'assert addresses[i] == expected_address' not in s:
            raise SystemExit("FAIL: CryLo multisig independent expected address checks missing")
        suite = ast.parse(s, filename=name)
        cases = [node for node in suite.body if isinstance(node, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == "TEST_CASES" for t in node.targets)]
        if len(cases) != 1:
            raise SystemExit("FAIL: missing or duplicated multisig M-of-N fixture")
        expected_mn = [(2, 2), (2, 3), (3, 3), (3, 4), (2, 4), (1, 2)]
        actual_cases = ast.literal_eval(cases[0].value)
        if len(actual_cases) != len(expected_mn):
            raise SystemExit("FAIL: multisig expected case count changed")
        if any((m, n) != pair or not addr.startswith("Wo") or len(addr) != 97
               for (m, n, addr), pair in zip(actual_cases, expected_mn)):
            raise SystemExit("FAIL: CryLo multisig fixed expected addresses or thresholds changed")
        if len(set(addr for _, _, addr in actual_cases)) != 6:
            raise SystemExit("FAIL: duplicate CryLo multisig expected address")
    elif "self.mining_address = res.address" not in s or "validate_address(self.mining_address).valid" not in s:
        raise SystemExit("FAIL: RPC wallet-derived address contract missing: " + name)
    if name.endswith("/txpool.py") or name.endswith("/speed.py"):
        if "self.destination_address = destination.address" not in s:
            raise SystemExit("FAIL: receiver destination is not wallet-generated: " + name)
    if name.endswith("/speed.py"):
        if s.index("from __future__ import print_function") > s.index("import time"):
            raise SystemExit("FAIL: Python future import must precede ordinary imports")
# Check actual assignment syntax and public-address encoding, not comments.
vectors_src = (ROOT / "tests/functional_tests/crylo_address_vectors.py").read_text(encoding="utf8")
tree = ast.parse(vectors_src, filename="crylo_address_vectors.py")
expected_vector_prefixes = {
    "PRIMARY_ADDRESS": "Wo", "SECOND_ADDRESS": "Wo",
    "ACCOUNT_1_ADDRESS": "WW", "ACCOUNT_2_ADDRESS": "WW",
    "SUB_0_1_ADDRESS": "WW", "SUB_1_1_ADDRESS": "WW",
    "SUB_1_2_ADDRESS": "WW", "SUB_0_999_ADDRESS": "WW",
    "INTEGRATED_ADDRESS_VALIDATION": "So",
    "SUB_VALIDATION_1": "WW", "SUB_VALIDATION_2": "WW",
}
addresses = {}
for node in tree.body:
    if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
        continue
    name = node.targets[0].id
    if name not in expected_vector_prefixes or name in addresses:
        raise SystemExit("FAIL: unexpected or duplicate CryLo vector assignment: " + name)
    if not isinstance(node.value, ast.Constant) or not isinstance(node.value.value, str):
        raise SystemExit("FAIL: CryLo fixture values must be fixed public-address literals")
    value = node.value.value
    if not value.startswith(expected_vector_prefixes[name]) or len(value) not in (97, 108) or not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]+", value):
        raise SystemExit("FAIL: invalid CryLo public-address fixture: " + name)
    addresses[name] = value
if set(addresses) != set(expected_vector_prefixes):
    raise SystemExit("FAIL: missing or added CryLo fixture assignments")

# Current CryLo chain configurations must match the pinned public vectors.
config_src = (ROOT / "src/cryptonote_config.h").read_text(encoding="utf8")
prefix_values = {}
for typ in ("", "INTEGRATED_", "SUB"):
    prefix_name = "CRYPTONOTE_PUBLIC_" + ("SUBADDRESS" if typ == "SUB" else typ + "ADDRESS") + "_BASE58_PREFIX"
    prefix_values[prefix_name] = [int(x) for x in re.findall(
        r"uint64_t const " + prefix_name + r"\s*=\s*(\d+);", config_src)]
if prefix_values != {
    "CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX": [4146, 53, 24],
    "CRYPTONOTE_PUBLIC_INTEGRATED_ADDRESS_BASE58_PREFIX": [6810, 54, 25],
    "CRYPTONOTE_PUBLIC_SUBADDRESS_BASE58_PREFIX": [12208, 63, 36],
}:
    raise SystemExit("FAIL: public-address network prefixes changed; regenerate and independently verify CryLo vectors")

validation_src = (ROOT / "tests/functional_tests/validate_address.py").read_text(encoding="utf8")
ast.parse(validation_src, filename="validate_address.py")
if "INTEGRATED_ADDRESS_VALIDATION" not in validation_src or "SUB_VALIDATION_1" not in validation_src:
    raise SystemExit("FAIL: CryLo mainnet network validation vectors missing")
for name in ("tests/functional_tests/address_book.py", "tests/functional_tests/validate_address.py"):
    source = (ROOT / name).read_text(encoding="utf8")
    if "donate@getmonero.org" in source or "888tNkZrPN" in source:
        raise SystemExit("FAIL: default external Monero donation fixture remains in: " + name)
    for env in ("CRYLO_TEST_OPENALIAS", "CRYLO_TEST_OPENALIAS_EXPECTED_ADDRESS"):
        if env not in source:
            raise SystemExit("FAIL: optional CryLo OpenAlias integration contract absent in: " + name)
    if "SKIP: external OpenAlias DNS" not in source:
        raise SystemExit("FAIL: external OpenAlias DNS test does not report a skipped case: " + name)

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
    "verifiedPublicVectorAssignments": len(addresses),
    "networkPrefixOverlapRequiresReview": {
        "testnet": {"standard": 53, "integrated": 54, "subaddress": 63},
        "stagenet": {"standard": 24, "integrated": 25, "subaddress": 36},
        "status": "inherited prefix overlap with legacy Monero networks; no protocol changes authorized",
    },
    "externalOpenAliasFixtureReviewRequired": True,
    "defaultMoneroOpenAliasDNSTestDisabled": True,
    "externalOpenAliasIntegrationExecuted": False,
    "note": "Generated CryLo mainnet vectors still require wallet RPC execution. Network-prefix and external OpenAlias review remain open."
}
print(json.dumps(report, indent=2))
