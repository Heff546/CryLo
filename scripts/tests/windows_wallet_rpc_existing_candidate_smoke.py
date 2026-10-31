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
        "uriFixExecuted":False,
        "multisigAndTransferIntegrationExecuted":False,
        "note":"Only the previous compiled unsigned candidate was exercised; new URI and shared-wallet source corrections require final native build."
    }
    report_path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS: existing unsigned Windows CryLo wallet RPC matched independent primary and subaddress vectors")
    print("PASS: integrated address roundtrip and legacy address rejection")
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
