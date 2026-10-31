#!/usr/bin/env python3
"""Windows no-build source audit of CryLo's regtest-only genesis hardfork schedule.

This is NOT a substitute for a native CryLo regtest genesis and RPC startup test.
"""
import pathlib
import re
root = pathlib.Path(__file__).resolve().parents[2]
core = (root/"src/cryptonote_core/cryptonote_core.cpp").read_text(encoding="utf-8")
hf = (root/"src/hardforks/hardforks.cpp").read_text(encoding="utf-8")
chain = (root/"src/cryptonote_core/blockchain.cpp").read_text(encoding="utf-8")
config = (root/"src/cryptonote_config.h").read_text(encoding="utf-8")
first = re.search(r"const hardfork_t mainnet_hard_forks\[\]\s*=\s*\{(?P<body>.*?)\};", hf, re.S)
if not first:
    raise SystemExit("FAIL: CryLo mainnet hardfork schedule not found")
entries = [(int(a), int(b)) for a,b in re.findall(r"\{\s*(\d+)\s*,\s*(\d+)\s*,", first.group("body"))]
if not entries or entries[0] != (17, 0) or entries[-1][0] < 17:
    raise SystemExit("FAIL: current CryLo genesis version mismatch, re-review instead of changing assumptions")
regtest = re.search(
    r"const std::pair<uint8_t, uint64_t> regtest_hard_forks\[3\]\s*=\s*\{(?P<body>.*?)\};",
    core, re.S,
)
if not regtest:
    raise SystemExit("FAIL: regtest version fixture not found")
body = regtest.group("body")
required = (
    r"std::make_pair\(\s*mainnet_hard_forks\[0\]\.version\s*,\s*0\s*\)",
    r"std::make_pair\(\s*mainnet_hard_forks\[num_mainnet_hard_forks\s*-\s*1\]\.version\s*,\s*1\s*\)",
    r"std::make_pair\(\s*0\s*,\s*0\s*\)",
)
for clause in required:
    if not re.search(clause, body):
        raise SystemExit("FAIL: regtest genesis or accelerated test-only transition mismatched")
if len(re.findall(r"std::make_pair", body)) != 3:
    raise SystemExit("FAIL: regtest schedule has added or missing entries")
if not re.search(r"regtest\s*\?\s*&regtest_test_options\s*:\s*test_options", core):
    raise SystemExit("FAIL: regtest-only configuration no longer isolated from live chains")
if "get_config(m_nettype).GENESIS_TX" not in chain or "m_nettype = test_options != NULL ? FAKECHAIN : nettype;" not in chain:
    raise SystemExit("FAIL: fakechain genesis source path changed; review source before release")
if not re.search(r"case FAKECHAIN:\s*return mainnet\s*;", config):
    raise SystemExit("FAIL: fakechain no longer uses mainnet genesis")
print("PASS: regtest genesis hardfork version follows CryLo's existing v17 genesis")
print("PASS: accelerated regtest-only hardfork transition at height 1 remains configured")
print("NOTICE: no native genesis was generated in this source-only audit")
