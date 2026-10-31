#!/usr/bin/env python3
"""Windows-only smoke of the exact newly built unsigned CryLo candidate.

Reuses the previously audited wallet-RPC fixture/verification routines without
changing that older-candidate gate. Exercises current binary wallet-RPC and
CryLo URI behavior in an isolated temporary directory. Does NOT certify
installer/updater, multisig signing, transfers, or publication.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote

import windows_wallet_rpc_existing_candidate_smoke as prior

EXPECTED_SOURCE = "5120debcc2a75fa0c7198ee0137f142dd0a5f6a8"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def rpc(method, params=None):
    return prior.rpc(PORT, method, params, timeout=30)


def expect_rejected(method, params):
    try:
        rpc(method, params)
    except RuntimeError:
        return
    raise RuntimeError("Wallet RPC accepted forbidden input for " + method)


def check_uri(addresses):
    first, second = "えんしゅう", "あまやかす"
    qfirst, qsecond = quote(first), quote(second)
    count = 0
    for address in addresses:
        made = rpc("make_uri", {"address": address})
        require(made.get("uri") == "crylo:" + address, "CryLo URI scheme mismatch")
        parsed = rpc("parse_uri", {"uri": made["uri"]})
        require(parsed["uri"]["address"] == address, "CryLo URI address mismatch")
        require(parsed["uri"].get("amount", 0) == 0, "CryLo URI unexpected amount")
        require(not parsed.get("unknown_parameters"), "CryLo URI unexpected parameter")
        atomic = 11000000000
        made = rpc("make_uri", {"address": address, "amount": atomic})
        require(made["uri"].startswith("crylo:" + address + "?tx_amount="),
                "CryLo URI amount encoding mismatch")
        parsed = rpc("parse_uri", {"uri": made["uri"]})
        require(parsed["uri"]["amount"] == atomic, "CryLo 11-decimal atomic-unit roundtrip failed")
        count += 2

    address = addresses[0]
    made = rpc("make_uri", {
        "address": address,
        "recipient_name": first,
        "tx_description": second,
        "amount": 100000000000,
    })
    require(made["uri"].startswith("crylo:" + address + "?tx_amount="),
            "CryLo combined URI missing amount")
    require("recipient_name=" + qfirst in made["uri"] and
            "tx_description=" + qsecond in made["uri"], "UTF-8 URI escaping mismatch")
    parsed = rpc("parse_uri", {"uri": made["uri"]})
    require(parsed["uri"]["recipient_name"] == first and
            parsed["uri"]["tx_description"] == second and
            parsed["uri"]["amount"] == 100000000000, "Combined URI roundtrip failed")
    count += 1

    for bad in (
        "", "crylo:", "monero:" + address, "CRYLO:" + address,
        "crylo:" + address + "?tx_amount=-1",
        "crylo:" + address + "?tx_amount=1e12",
        "crylo:" + address + "?tx_amount=10&tx_amount=20",
        "crylo:" + address + "?tx_amount=222222222222222222222",
        "crylo:" + addresses[2] + "?tx_payment_id=" + "1" * 64,
    ):
        expect_rejected("parse_uri", {"uri": bad})
        count += 1
    for bad in ({}, {"address": ""}, {"address": "invalid"}):
        expect_rejected("make_uri", bad)
        count += 1
    expect_rejected("make_uri", {"address": address, "payment_id": "1" * 64})
    count += 1

    result = rpc("parse_uri", {"uri": "crylo:" + address + "?tx_amount=239.39014&foo=bar"})
    require(result["uri"]["amount"] == 23939014000000, "Unknown URI parameter changed amount")
    require(result.get("unknown_parameters") == ["foo=bar"],
            "Unrecognized URI parameter was not reported")
    count += 1
    print("PASS: current Windows wallet-RPC CryLo URI tests (%d checks)" % count)
    return count


def smoke():
    restored = rpc("restore_deterministic_wallet", {
        "seed": prior.PUBLIC_TEST_SEED,
        "restore_height": 0,
        "filename": "ci-current-public-fixture",
        "password": "",
        "language": "English",
        "autosave_current": False,
    })
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "tests" / "functional_tests"))
    from crylo_address_vectors import PRIMARY_ADDRESS, SUB_0_1_ADDRESS

    address = restored.get("address")
    require(address == PRIMARY_ADDRESS, "Independent CryLo primary address fixture mismatch")
    require(rpc("get_address", {"account_index": 0}).get("address") == address,
            "Restored CryLo address not readable")
    sub = rpc("create_address", {"account_index": 0, "label": "ci-current"})
    require(sub.get("address") == SUB_0_1_ADDRESS, "Independent CryLo subaddress fixture mismatch")
    integrated = rpc("make_integrated_address", {
        "standard_address": address, "payment_id": "0123456789abcdef"})
    integrated_address = integrated["integrated_address"]
    split = rpc("split_integrated_address", {"integrated_address": integrated_address})
    require(split.get("standard_address") == address and
            split.get("payment_id") == "0123456789abcdef", "Integrated CryLo address roundtrip failed")
    for kind, value in (("standard", address), ("subaddress", sub["address"]),
                        ("integrated", integrated_address)):
        valid = rpc("validate_address", {"address": value})
        require(valid.get("valid") and valid.get("nettype") == "mainnet",
                "Current wallet-RPC rejected CryLo " + kind + " address")
        require(bool(valid.get("subaddress")) == (kind == "subaddress"),
                "Incorrect CryLo subaddress classification")
        require(bool(valid.get("integrated")) == (kind == "integrated"),
                "Incorrect CryLo integrated classification")
    require(not rpc("validate_address", {"address": "monero:" + address}).get("valid"),
            "Legacy URI unexpectedly validated as CryLo address")

    cross_count = prior.check_inherited_prefix_behavior(PORT)
    vector_count, multisig_count = prior.validate_fixed_public_vectors(PORT)
    uri_checks = check_uri([address, sub["address"], integrated_address])
    print("PASS: current Windows wallet-RPC independent public address and cross-network vectors")
    return {
        "walletRPCExecuted": True,
        "independentCryLoPublicVectorsValidated": vector_count,
        "multisigPublicAddressFormatsValidated": multisig_count,
        "multisigDerivationOrSigningExecuted": False,
        "crossNetworkCompatibilityVectorsValidated": cross_count,
        "uriRegressionExecuted": True,
        "uriChecksPassed": uri_checks,
    }


def main():
    if len(sys.argv) != 3:
        raise ValueError("usage: windows_current_unsigned_artifact_smoke.py <artifact-dir> <report-json>")
    downloaded, report = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    require(downloaded.is_dir(), "Downloaded current unsigned artifact is missing")
    setup = prior.only_one(downloaded, "CryLo Wallet Setup 1.1.1.exe")
    portable = prior.only_one(downloaded, "CryLo Wallet 1.1.1.exe")
    require(setup.stat().st_size > 1000000 and portable.stat().st_size > 1000000,
            "Current installer/portable artifacts missing or unexpectedly small")
    global PORT
    with tempfile.TemporaryDirectory(prefix="crylo-current-win-rpc-",
                                     dir=os.environ.get("RUNNER_TEMP")) as temporary:
        root = Path(temporary)
        bindir, walletdir = root / "bin", root / "wallets"
        bindir.mkdir()
        walletdir.mkdir()
        # This override applies ONLY to the isolated imported verifier.
        # The older-candidate smoke workflow remains pinned and unchanged.
        require(prior.EXPECTED_SOURCE == "9b876fa5aa726606d2b3dd5651f196d317ba222b",
                "Previously audited artifact verifier unexpectedly changed")
        prior.EXPECTED_SOURCE = EXPECTED_SOURCE
        dlls = prior.verify_candidate(downloaded, bindir)
        require(dlls == 55, "Exact 55-DLL runtime closure changed")
        PORT = prior.free_port()
        args = [
            str(bindir / "CryLo-wallet-rpc.exe"), "--wallet-dir", str(walletdir),
            "--rpc-bind-ip", "127.0.0.1", "--rpc-bind-port", str(PORT),
            "--disable-rpc-login", "--rpc-ssl", "disabled",
            "--daemon-ssl", "disabled", "--offline", "--log-level", "0",
        ]
        logfile = root / "wallet-rpc.log"
        with logfile.open("wb") as output:
            process = subprocess.Popen(args, cwd=str(root), stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT)
            try:
                prior.wait_ready(PORT, process, time.monotonic() + 45)
                checks = smoke()
            except Exception:
                output.flush()
                print("FAIL: current Windows wallet-RPC; sanitized last log lines:", file=sys.stderr)
                for line in logfile.read_text(encoding="utf-8", errors="replace").splitlines()[-12:]:
                    if not any(s in line.lower() for s in ("seed", "secret", "password", "private")):
                        print(line[:240], file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        result = {
            "classification": "WINDOWS_CURRENT_UNSIGNED_ARTIFACT_WALLET_RPC_URI_SMOKE",
            "sourceCommit": EXPECTED_SOURCE,
            "nativeArtifactHashesVerified": True,
            "runtimeDllsVerified": dlls,
            "electronInstallerAndPortableFound": True,
            "installerExecuted": False,
            "updaterExecuted": False,
            "releaseFrozen": True,
            "mayPublish": False,
            "functionalMultiServiceHarnessExecuted": False,
            "transferIntegrationExecuted": False,
            **checks,
        }
        report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print("PASS: exact new CryLo Windows candidate wallet-RPC and URI checks; release frozen")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL: current unsigned Windows artifact audit: %s" % exc, file=sys.stderr)
        raise SystemExit(1)
