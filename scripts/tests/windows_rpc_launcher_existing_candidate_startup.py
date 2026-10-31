#!/usr/bin/env python3
"""Start all ten local CryLo RPC test services from a verified *old* Windows artifact.

Checks process orchestration only, not the tests, updated native binaries,
multisig signing, installer behavior, or release readiness. Never publishes.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def module_from_file(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prior = module_from_file("crylo_prior_win_candidate_smoke", ROOT / "scripts/tests/windows_wallet_rpc_existing_candidate_smoke.py")
harness = module_from_file("crylo_functional_rpc_launcher", ROOT / "tests/functional_tests/functional_tests_rpc.py")


def main(argv):
    if len(argv) != 3:
        raise ValueError("usage: windows_rpc_launcher_existing_candidate_startup.py <downloaded-candidate> <report-path>")
    downloaded = Path(argv[1]).resolve()
    report_path = Path(argv[2]).resolve()
    if not downloaded.is_dir():
        raise RuntimeError("Existing Windows candidate artifact directory missing")
    with tempfile.TemporaryDirectory(prefix="crylo-win-ten-rpc-") as temp:
        root = Path(temp)
        bindir = root / "bin"
        bindir.mkdir()
        wallet_dir = root / "wallets"
        wallet_dir.mkdir()
        data_root = root / "data"
        data_root.mkdir()
        closure = prior.verify_candidate(downloaded, bindir)
        commands, child_env = harness.build_plan(
            sys.executable,
            ROOT / "tests" / "functional_tests",
            root,
            ["validate_address"],
            "",
            wallet_dir,
            data_root,
            windows=True,
        )
        if len(commands) != 10:
            raise RuntimeError("Unexpected CryLo RPC service count")
        if any("--rpc-payment-address" in command for command in commands):
            raise RuntimeError("No-payment test must not start a paid RPC service")
        # The test is run on disposable GitHub Windows workers, not a user host.
        harness.check_available_ports(harness.DAEMON_PORTS + harness.WALLET_PORTS + harness.P2P_PORTS)
        processes, logs = [], []
        failure = None
        try:
            for i, command in enumerate(commands):
                path = root / ("CryLo-daemon%d.log" % i if i < 4 else "CryLo-wallet-rpc%d.log" % (i-4))
                handle = path.open("wb")
                logs.append(handle)
                processes.append(subprocess.Popen(
                    command, cwd=str(data_root), env=child_env,
                    stdin=subprocess.DEVNULL, stdout=handle,
                    stderr=subprocess.STDOUT, shell=False,
                ))
            # Real socket readiness, no proxy/mock, with finite deadline.
            harness.wait_ready(
                processes, harness.DAEMON_PORTS + harness.WALLET_PORTS,
                time.monotonic() + 90,
            )
            for i, process in enumerate(processes):
                if process.poll() is not None:
                    raise RuntimeError("CryLo test child exited after readiness: " + str(i))
            print("PASS: 4 CryLo Windows regtest daemons and 6 wallet-RPC services started on localhost")
            print("PASS: all ten services remained alive when all ten RPC ports became ready")
        except Exception as exc:
            failure = str(exc)
            print("FAIL: CryLo ten-service startup: " + failure, file=sys.stderr)
            for i, h in enumerate(logs):
                h.flush()
                logpath = Path(h.name)
                lines = logpath.read_text(encoding="utf-8", errors="replace").splitlines()
                if lines:
                    print("LAST LOG LINES for child %d (%s):" % (i, logpath.name), file=sys.stderr)
                    for line in lines[-8:]:
                        if not any(word in line.lower() for word in ("password", "seed", "secret", "private")):
                            print(line[:280], file=sys.stderr)
        finally:
            try:
                harness.stop_processes(processes)
                print("PASS: all ten test-only CryLo services shut down with bounded waits")
            except Exception as exc:
                failure = (failure or "") + "; cleanup: " + str(exc)
            for h in logs:
                h.close()
        report = {
            "classification": "WINDOWS_PREVIOUS_UNSIGNED_ARTIFACT_TEN_SERVICE_STARTUP_ONLY",
            "sourceCommit": prior.EXPECTED_SOURCE,
            "releaseFrozen": True,
            "mayPublish": False,
            "sourceCorrectionsCompiled": False,
            "rpcIntegrationTestsExecuted": False,
            "installerOrUpdaterTested": False,
            "legacyPrefixChanges": False,
            "runtimeDllsVerified": closure,
            "plannedDaemons": 4,
            "plannedWalletRpcServers": 6,
            "tenServiceStartupPassed": failure is None,
            "cleanupPassed": not (failure and "cleanup:" in failure),
            "errorCategory": None if failure is None else "startup_or_cleanup",
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if failure is not None:
            raise RuntimeError("Ten-service startup gate failed; inspect runner logs")
    print("NOTICE: old unsigned binary only; wallet, multisig and URI tests not executed; release remains frozen")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception as exc:
        print("FAIL: ten-service CryLo Windows prior-artifact test: " + str(exc), file=sys.stderr)
        sys.exit(1)
