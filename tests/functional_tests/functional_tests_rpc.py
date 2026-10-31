#!/usr/bin/env python3
"""CryLo local functional RPC harness.

Isolated test-only daemon and wallet processes. No release/update operations,
no user wallet restarts, and no external network connections. Preserve the
historical CTest interface:
  functional_tests_rpc.py <python> <srcdir> <builddir> <test...|all>
"""
from __future__ import print_function

import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time

DEFAULT_TESTS = (
    'address_book', 'bans', 'blockchain', 'cold_signing', 'daemon_info',
    'get_output_distribution', 'integrated_address', 'mining', 'multisig',
    'p2p', 'proofs', 'rpc_payment', 'sign_message', 'transfer', 'txpool',
    'uri', 'validate_address', 'wallet',
)
USAGE = 'usage: functional_tests_rpc.py <python> <srcdir> <builddir> [<tests-to-run> | all]'
DAEMON_PORTS = tuple(range(18180, 18184))
P2P_PORTS = tuple(range(18280, 18284))
ZMQ_PORTS = tuple(range(18380, 18384))
WALLET_PORTS = tuple(range(18090, 18096))
STARTUP_SECONDS = 40
STOP_SECONDS = 12
KILL_SECONDS = 5
DEFAULT_TEST_TIMEOUT_SECONDS = 900
DIFFICULTY = 10
PUBLIC_BASE58 = re.compile(r'[1-9A-HJ-NP-Za-km-z]{97}\Z')


def select_tests(requested):
    if not requested:
        raise ValueError('No RPC test selected. Pass test names or all.')
    if 'all' in requested:
        if requested != ['all']:
            raise ValueError('all cannot be combined with named RPC tests')
        return list(DEFAULT_TESTS)
    invalid = [name for name in requested if name not in DEFAULT_TESTS]
    if invalid or len(requested) != len(set(requested)):
        raise ValueError('Unknown or duplicate RPC tests: ' + ', '.join(invalid or requested))
    return list(requested)


def validate_payment_address(tests, value):
    address = value.strip()
    if 'rpc_payment' in tests and not address:
        raise ValueError('CRYLO_REGTEST_RPC_PAYMENT_ADDRESS is required for rpc_payment (including all)')
    if address and (not address.startswith('Wo') or not PUBLIC_BASE58.fullmatch(address)):
        raise ValueError('RPC payment requires a 97-character CryLo FAKECHAIN/mainnet-format address')
    # Definitive public-key/checksum validation is performed by CryLo-daemon.
    return address


def executable(builddir, name, windows=None):
    if windows is None:
        windows = os.name == 'nt'
    return Path(builddir) / 'bin' / (name + ('.exe' if windows else ''))


def build_plan(python, srcdir, builddir, tests, payment_address, wallet_dir, session_dir, windows=None):
    """Build an inspectable, launch-free plan. Never infer a missing executable."""
    srcdir, builddir = Path(srcdir).resolve(), Path(builddir).resolve()
    daemon = executable(builddir, 'CryLo-daemon', windows)
    wallet = executable(builddir, 'CryLo-wallet-rpc', windows)
    for binary in (daemon, wallet):
        if not binary.is_file():
            raise FileNotFoundError('Expected native test executable missing: ' + str(binary))
    for name in tests:
        if not (srcdir / (name + '.py')).is_file():
            raise FileNotFoundError('Functional RPC test script missing: ' + name)
    wallet_dir = Path(wallet_dir)
    session_dir = Path(session_dir)
    commands = []
    for i in range(4):
        cmd = [
            str(daemon), '--regtest', '--fixed-difficulty', str(DIFFICULTY),
            '--no-igd', '--p2p-bind-port', str(P2P_PORTS[i]),
            '--rpc-bind-ip', '127.0.0.1', '--rpc-bind-port', str(DAEMON_PORTS[i]),
            '--zmq-rpc-bind-ip', '127.0.0.1', '--zmq-rpc-bind-port', str(ZMQ_PORTS[i]),
            '--zmq-pub', 'tcp://127.0.0.1:' + str(18480 + i),
            '--non-interactive', '--disable-dns-checkpoints',
            '--check-updates', 'disabled', '--rpc-ssl', 'disabled',
            '--data-dir', str(session_dir / ('daemon' + str(i))),
            '--log-level', '1', '--rpc-max-connections-per-private-ip', '100',
            '--rpc-max-connections', '100',
        ]
        if i < 2:
            cmd.append('--offline')
        else:
            cmd.extend(['--add-exclusive-node', '127.0.0.1:' + str(P2P_PORTS[7-i])])
        if i == 1 and payment_address:
            cmd.extend(['--rpc-payment-address', payment_address,
                        '--rpc-payment-difficulty', str(DIFFICULTY),
                        '--rpc-payment-credits', '5000'])
        commands.append(cmd)
    for i in range(6):
        cmd = [
            str(wallet), '--wallet-dir', str(wallet_dir),
            '--rpc-bind-ip', '127.0.0.1', '--rpc-bind-port', str(WALLET_PORTS[i]),
            '--disable-rpc-login', '--rpc-ssl', 'disabled', '--daemon-ssl',
            'disabled', '--log-level', '1', '--allow-mismatched-daemon-version',
        ]
        if i == 5:
            cmd += ['--offline']
        else:
            cmd += ['--daemon-address', '127.0.0.1:' + str(DAEMON_PORTS[2] if i == 4 else DAEMON_PORTS[0])]
        commands.append(cmd)
    env = os.environ.copy()
    framework = str((srcdir / '..' / '..' / 'utils' / 'python-rpc').resolve())
    env['PYTHONPATH'] = os.pathsep.join(filter(None, (env.get('PYTHONPATH', ''), framework)))
    env.update({
        'WALLET_DIRECTORY': str(wallet_dir),
        'FUNCTIONAL_TESTS_DIRECTORY': str(builddir / 'tests' / 'functional_tests'),
        'SOURCE_DIRECTORY': str(srcdir),
        'PYTHONIOENCODING': 'utf-8',
        'DIFFICULTY': str(DIFFICULTY),
        'MAKE_TEST_SIGNATURE': str(builddir / 'tests' / 'functional_tests' / ('make_test_signature.exe' if (os.name == 'nt' if windows is None else windows) else 'make_test_signature')),
        'SEEDHASH_EPOCH_BLOCKS': '8',
        'SEEDHASH_EPOCH_LAG': '4',
    })
    return commands, env


def check_available_ports(ports):
    """Fail closed before starting any child; never attach to unrelated listeners."""
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError('RPC test port already occupied: ' + str(port))


def wait_ready(processes, ports, deadline):
    while time.monotonic() < deadline:
        for index, process in enumerate(processes):
            if process.poll() is not None:
                raise RuntimeError('RPC test child %d exited during startup: %s' % (index, process.returncode))
        pending = []
        for port in ports:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.5)
                if sock.connect_ex(('127.0.0.1', port)) != 0:
                    pending.append(port)
        if not pending:
            return
        time.sleep(0.4)
    raise RuntimeError('RPC child startup timed out; missing local ports: ' + str(pending))


def stop_processes(processes):
    """Bounded shutdown, including partially started services on Windows."""
    errors = []
    for process in reversed(processes):
        try:
            if process.poll() is None:
                process.terminate()
        except (OSError, PermissionError) as exc:
            errors.append(str(exc))
    for process in reversed(processes):
        try:
            process.wait(timeout=STOP_SECONDS)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
                process.wait(timeout=KILL_SECONDS)
            except (subprocess.TimeoutExpired, OSError) as exc:
                errors.append('Could not reap test-only child: ' + str(exc))
        except (OSError, PermissionError) as exc:
            errors.append(str(exc))
    if errors:
        raise RuntimeError('; '.join(errors))


def main(argv):
    if len(argv) < 5:
        print(USAGE, file=sys.stderr)
        return 2
    python, srcdir, builddir = argv[1:4]
    try:
        tests = select_tests(argv[4:])
        payment_address = validate_payment_address(
            tests, os.environ.get('CRYLO_REGTEST_RPC_PAYMENT_ADDRESS', ''))
        srcdir, builddir = Path(srcdir).resolve(), Path(builddir).resolve()
        if not srcdir.is_dir() or not builddir.is_dir():
            raise ValueError('CryLo functional-test source or build directory missing')
        max_test_seconds = int(os.environ.get('CRYLO_RPC_TEST_TIMEOUT_SECONDS', DEFAULT_TEST_TIMEOUT_SECONDS))
        if not 30 <= max_test_seconds <= 3600:
            raise ValueError('CRYLO_RPC_TEST_TIMEOUT_SECONDS must be between 30 and 3600')
    except (ValueError, OSError) as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        return 2
    # Preserve upstream output/signature directory, but never reuse or delete
    # any pre-existing wallet or daemon data, even on a retry.
    log_dir = builddir / 'tests' / 'functional_tests'
    log_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='crylo-rpc-test-', dir=str(builddir)) as scratch:
        session = Path(scratch)
        wallet_dir = session / 'wallets'
        wallet_dir.mkdir()
        try:
            commands, child_env = build_plan(python, srcdir, builddir, tests, payment_address, wallet_dir, session)
            check_available_ports(DAEMON_PORTS + WALLET_PORTS + P2P_PORTS)
        except (ValueError, OSError, RuntimeError) as exc:
            print('ERROR: preflight: ' + str(exc), file=sys.stderr)
            return 2
        processes, outputs = [], []
        failed = []
        outcome = 0
        try:
            print('Starting %d isolated CryLo RPC test services' % len(commands), flush=True)
            for index, cmd in enumerate(commands):
                log_path = log_dir / ('CryLo-daemon' + str(index) + '.log' if index < 4 else 'wallet' + str(index-4) + '.log')
                out = log_path.open('ab')
                outputs.append(out)
                processes.append(subprocess.Popen(
                    cmd, stdout=out, stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL, env=child_env, cwd=str(session),
                    shell=False))
            wait_ready(processes, DAEMON_PORTS + WALLET_PORTS, time.monotonic() + STARTUP_SECONDS)
            time.sleep(2)
            for name in tests:
                print('[TEST STARTED] ' + name, flush=True)
                try:
                    subprocess.run([python, str(srcdir / (name + '.py'))], check=True,
                                   env=child_env, timeout=max_test_seconds, cwd=str(session))
                    print('[TEST PASSED] ' + name, flush=True)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
                    failed.append(name)
                    print('[TEST FAILED] %s: %s' % (name, type(exc).__name__), flush=True)
            if failed:
                print('Done, %d/%d tests failed: %s' % (len(failed), len(tests), ', '.join(failed)))
                outcome = 1
            else:
                print('Done, %d/%d tests passed' % (len(tests), len(tests)))
        except (OSError, RuntimeError) as exc:
            print('ERROR: RPC test service startup or execution: ' + str(exc), file=sys.stderr)
            outcome = 1
        finally:
            print('Stopping isolated RPC test services', flush=True)
            try:
                stop_processes(processes)
            except RuntimeError as exc:
                print('ERROR: RPC child cleanup: ' + str(exc), file=sys.stderr)
                outcome = 1
            for output in outputs:
                output.close()
        return outcome


if __name__ == '__main__':
    sys.exit(main(sys.argv))
