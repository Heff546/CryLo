#!/usr/bin/env python3
"""Windows-only audit of the *previously built* unsigned CryLo wallet RPC.

Never authorize publication from this result. This binary was compiled before
the staged URI-parser correction; URI regression remains unvalidated.
Requires only the Python standard library. Uses an isolated ephemeral wallet.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

EXPECTED_SOURCE = "9b876fa5aa726606d2b3dd5651f196d317ba222b"
PUBLIC_TEST_SEED = (
    "velvet lymph giddy number token physics poetry unquoted nibs useful "
    "sabotage limits benches lifestyle eden nitrogen anvil fewest avoid "
    "batch vials washing fences goat unquoted"
)

def only_one(root, filename):
    found = list(root.rglob(filename))
    if len(found) != 1:
        raise RuntimeError("Expected one %s in candidate, found %s" % (filename, len(found)))
    return found[0]

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def check_hash_record(path, record):
    digests = re.findall(r"\b[0-9a-fA-F]{64}\b", record.read_text(encoding="utf-8"))
    if len(digests) != 1 or sha256(path).lower() != digests[0].lower():
        raise RuntimeError("Native executable hash mismatch: " + path.name)

def rpc(port, method, params=None, timeout=4):
    body = json.dumps({"jsonrpc":"2.0","id":"crylo-ci","method":method,
                       "params":params or {}}).encode("utf-8")
    request = Request("http://127.0.0.1:%d/json_rpc" % port,
                      data=body,headers={"Content-Type":"application/json"})
    with urlopen(request, timeout=timeout) as response:
        reply = json.load(response)
    if "error" in reply:
        raise RuntimeError("Wallet RPC error for %s: %s" % (method, reply["error"]))
    if "result" not in reply:
        raise RuntimeError("No result from wallet RPC: " + method)
    return reply["result"]

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def verify_candidate(root, destination):
    receipt = only_one(root, "SOURCE-COMMIT.txt").read_text(encoding="utf-8").strip()
    if receipt != EXPECTED_SOURCE:
        raise RuntimeError("Unsigned candidate source revision not approved")
    binaries = {
        "CryLo-daemon.exe": "DAEMON-SHA256.txt",
        "CryLo-wallet.exe": "WALLET-SHA256.txt",
        "CryLo-wallet-rpc.exe": "RPC-SHA256.txt",
    }
    for executable, proof in binaries.items():
        original = only_one(root, executable)
        check_hash_record(original, only_one(root, proof))
        shutil.copy2(original, destination / executable)
    manifest_file = only_one(root, "WINDOWS-BUILD-RUNTIME-MANIFEST.json")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    runtime = manifest.get("runtime", [])
    if len(runtime) < 30:
        raise RuntimeError("Runtime DLL closure unexpectedly incomplete")
    runtime_dir = manifest_file.parent
    for item in runtime:
        filename = item["file"]
        if Path(filename).name != filename or not filename.lower().endswith(".dll"):
            raise RuntimeError("Invalid DLL closure path")
        original = runtime_dir / filename
        if not original.is_file() or original.stat().st_size != item["size"] or sha256(original) != item["sha256"].lower():
            raise RuntimeError("Runtime DLL closure mismatch: " + filename)
        shutil.copy2(original, destination / filename)
    return len(runtime)

def wait_ready(port, process, until):
    last = None
    while time.monotonic() < until:
        if process.poll() is not None:
            raise RuntimeError("Wallet RPC process exited before readiness: %s" % process.returncode)
        try:
            rpc(port, "get_version", timeout=1)
            return
        except (OSError, RuntimeError, HTTPError, URLError) as exc:
            last = type(exc).__name__
            time.sleep(0.3)
    raise RuntimeError("Timed out checking wallet RPC readiness: " + str(last))

def inherited_cross_network_fixtures():
    """Read *existing* intentionally retained network fixtures without adding addresses.

    Do not execute the functional test file; read only its literal AST so this
    Windows-only audit has no external Python dependency or DNS/network calls.
    """
    import ast
    root = Path(__file__).resolve().parents[2]
    file = root / "tests" / "functional_tests" / "validate_address.py"
    tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
    lists = [
        node.value for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "addresses" for t in node.targets)
        and isinstance(node.value, ast.List)
    ]
    if len(lists) != 1:
        raise RuntimeError("Expected exactly one wallet address-validation fixture table")
    cases = []
    for row in lists[0].elts:
        if not isinstance(row, ast.List) or len(row.elts) != 3:
            raise RuntimeError("Unexpected structure in network validation fixtures")
        if not isinstance(row.elts[0], ast.Constant):
            raise RuntimeError("Network validation fixture has no literal network")
        network = row.elts[0].value
        if network not in ("testnet", "stagenet"):
            continue
        if not isinstance(row.elts[1], ast.Constant) or not isinstance(row.elts[2], ast.Constant):
            raise RuntimeError("Cross-network compatibility fixture must be public literal")
        subtype, address = row.elts[1].value, row.elts[2].value
        if subtype not in ("", "i", "s") or not isinstance(address, str):
            raise RuntimeError("Invalid inherited network fixture metadata")
        cases.append((network, subtype, address))
    if len(cases) != 8 or any(sum(1 for net, _, _ in cases if net == expected) != 4 for expected in ("testnet", "stagenet")):
        raise RuntimeError("Expected four inherited public address vectors per non-mainnet network")
    config = (root / "src" / "cryptonote_config.h").read_text(encoding="utf-8")
    expected_values = (("testnet", 53, 54, 63), ("stagenet", 24, 25, 36))
    for network, standard, integrated, subaddress in expected_values:
        region = config.split("namespace " + network, 1)
        if len(region) != 2:
            raise RuntimeError("Network configuration missing: " + network)
        values = region[1].split("}", 1)[0]
        for suffix, expected in (
            ("CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX", standard),
            ("CRYPTONOTE_PUBLIC_INTEGRATED_ADDRESS_BASE58_PREFIX", integrated),
            ("CRYPTONOTE_PUBLIC_SUBADDRESS_BASE58_PREFIX", subaddress),
        ):
            if not re.search(r"\b" + suffix + r"\s*=\s*" + str(expected) + r"\s*;", values):
                raise RuntimeError("Network prefix changed; halt for compatibility review: " + network)
    return cases

def check_inherited_prefix_behavior(port):
    """Verify default mainnet rejection and explicit cross-network classification."""
    cases = inherited_cross_network_fixtures()
    for network, subtype, address in cases:
        default = rpc(port, "validate_address", {"address": address, "any_net_type": False})
        if default.get("valid"):
            raise RuntimeError("Mainnet-default wallet accepted cross-network address (" + network + ")")
        explicit = rpc(port, "validate_address", {"address": address, "any_net_type": True})
        if not explicit.get("valid") or explicit.get("nettype") != network:
            raise RuntimeError("Explicit cross-network classification disagrees with source fixture (" + network + ")")
        if bool(explicit.get("integrated")) != (subtype == "i") or bool(explicit.get("subaddress")) != (subtype == "s"):
            raise RuntimeError("Cross-network address subtype misclassified (" + network + ")")
        bad = address[:-1] + ("1" if address[-1] != "1" else "2")
        if rpc(port, "validate_address", {"address": bad, "any_net_type": True}).get("valid"):
            raise RuntimeError("Cross-network address checksum mutation unexpectedly accepted (" + network + ")")
    return len(cases)

def smoke(directory, port, report_path):
    response = rpc(port, "restore_deterministic_wallet", {
        "seed": PUBLIC_TEST_SEED,
        "restore_height": 0,
        "filename": "ci-public-fixture",
        "password": "",
        "language": "English",
        "autosave_current": False,
    },timeout=30)
    from sys import path as python_path
    python_path.insert(0, str(Path(__file__).resolve().parents[2] / "tests" / "functional_tests"))
    from crylo_address_vectors import PRIMARY_ADDRESS, SUB_0_1_ADDRESS
    address = response.get("address")
    if address != PRIMARY_ADDRESS:
        raise RuntimeError("CryLo wallet RPC primary address differs from pinned independent public vector")
    primary = rpc(port,"validate_address",{"address":address})
    if not primary.get("valid") or primary.get("nettype") != "mainnet" or primary.get("subaddress"):
        raise RuntimeError("Generated CryLo primary address rejected by wallet RPC")
    primary_read = rpc(port,"get_address",{"account_index":0})
    if primary_read.get("address") != address:
        raise RuntimeError("CryLo wallet RPC get_address disagrees with restored wallet")
    sub = rpc(port, "create_address", {"account_index":0,"label":"ci-audit"})
    if sub.get("address") != SUB_0_1_ADDRESS:
        raise RuntimeError("CryLo subaddress derivation does not match independent public vector")
    sub_check = rpc(port,"validate_address",{"address":sub["address"]})
    if not sub_check.get("valid") or not sub_check.get("subaddress"):
        raise RuntimeError("CryLo wallet RPC does not recognize generated subaddress")
    integrated = rpc(port,"make_integrated_address",{
        "standard_address": address,"payment_id":"0123456789abcdef"})
    int_address = integrated["integrated_address"]
    int_check = rpc(port,"validate_address",{"address":int_address})
    if not int_check.get("valid") or not int_check.get("integrated"):
        raise RuntimeError("CryLo wallet RPC rejected generated integrated address")
    decoded = rpc(port,"split_integrated_address",{"integrated_address":int_address})
    if decoded.get("standard_address") != address or decoded.get("payment_id") != "0123456789abcdef":
        raise RuntimeError("CryLo integrated address did not roundtrip")
    for bad in ("monero:"+address, address[:-1]+("1" if address[-1]!="1" else "2"),
                "42ey1afDFnn4886T7196doS9GPMzexD9gXpsZJDwVjeRVdFCSoHnv7KPbBeGpzJBzHRCAs9UxqeoyFQMYbqSWYTfJJQAWDm"):
        if rpc(port,"validate_address",{"address":bad,"any_net_type":True}).get("valid"):
            raise RuntimeError("Wallet RPC accepted legacy or invalid address")
    cross_network_count = check_inherited_prefix_behavior(port)
    report = {
        "classification":"WINDOWS_EXISTING_UNSIGNED_BINARY_RPC_SMOKE_ONLY",
        "sourceCommit":EXPECTED_SOURCE,
        "binarySourceMatchesCurrentAuditBranch":False,
        "releaseFrozen":True,"mayPublish":False,
        "walletRPCExecuted":True,
        "addressGeneration": "passed",
        "independentPrimaryAndSubaddressVectors": "passed",
        "integratedAddressRoundtrip": "passed",
        "oldMoneroAndInvalidAddressRejection": "passed",
        "strictMainnetRejectedInheritedCrossNetworkAddresses":cross_network_count,
        "explicitAnyNetTypeClassifiedInheritedCrossNetworkAddresses":cross_network_count,
        "legacyMoneroTestnetAndStagenetPrefixOverlap":"confirmed; preserve compatibility and review transaction/UI network checks",
        "networkPrefixChangeAuthorized":False,
        "uriFixExecuted":False,
        "multisigAndTransferIntegrationExecuted":False,
        "note":"Only the previous compiled unsigned candidate was exercised; new URI and shared-wallet source corrections require final native build."
    }
    report_path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS: existing unsigned Windows CryLo wallet RPC matched independent primary and subaddress vectors")
    print("PASS: integrated address roundtrip and legacy address rejection")
    print("PASS: %s inherited testnet/stagenet fixture addresses rejected by default, correctly classified only with any_net_type" % cross_network_count)
    print("NOTICE: inherited Monero network prefix overlap confirmed; no protocol changes authorized")
    print("NOTICE: staged URI fix, multisig and transfer tests NOT executed; release remains frozen")

def main():
    if len(sys.argv)!=3:
        raise SystemExit("usage: windows_wallet_rpc_existing_candidate_smoke.py <download-root> <report-path>")
    source = Path(sys.argv[1]).resolve()
    report_path = Path(sys.argv[2]).resolve()
    if not source.is_dir():
        raise RuntimeError("Candidate artifact directory missing")
    with tempfile.TemporaryDirectory(prefix="crylo-win-rpc-",dir=os.environ.get("RUNNER_TEMP")) as tmp:
        root=Path(tmp)
        bindir=root/"bin"
        bindir.mkdir()
        walletdir=root/"wallets"
        walletdir.mkdir()
        closure=verify_candidate(source,bindir)
        print("PASS: candidate revision, three native executable hashes, and %s DLLs verified" % closure)
        port=free_port()
        args=[
          str(bindir/"CryLo-wallet-rpc.exe"),
          "--wallet-dir",str(walletdir),
          "--rpc-bind-ip","127.0.0.1",
          "--rpc-bind-port",str(port),
          "--disable-rpc-login",
          "--rpc-ssl","disabled",
          "--daemon-ssl","disabled",
          "--offline",
          "--log-level","0",
        ]
        log_path=root/"wallet-rpc.log"
        with log_path.open("wb") as out:
            process=subprocess.Popen(args,cwd=str(root),stdin=subprocess.DEVNULL,
                                     stdout=out,stderr=subprocess.STDOUT)
            try:
                wait_ready(port,process,time.monotonic()+45)
                smoke(root,port,report_path)
            except Exception:
                # Only diagnostic process output; do not print wallet seed or private keys.
                out.flush()
                print("Wallet RPC process failed; last log lines follow:",file=sys.stderr)
                tail=log_path.read_text(encoding="utf-8",errors="replace").splitlines()[-16:]
                for line in tail:
                    if "seed" not in line.lower() and "secret" not in line.lower():
                        print(line[:250],file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL: isolated Windows wallet RPC smoke: %s" % (exc,),file=sys.stderr)
        raise SystemExit(1)
