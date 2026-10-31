#!/usr/bin/env python3
"""No native binaries required. Test Windows RPC harness orchestration and cleanup."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'tests' / 'functional_tests' / 'functional_tests_rpc.py'
spec = importlib.util.spec_from_file_location('crylo_functional_rpc_launcher', SCRIPT)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class StubProcess:
    def __init__(self, state=None, timeout_once=False):
        self.returncode = state
        self.terminated = False
        self.killed = False
        self.timeout_once = timeout_once
        self.wait_calls = []
    def poll(self):
        return self.returncode
    def terminate(self):
        self.terminated = True
        self.returncode = 0
    def kill(self):
        self.killed = True
        self.returncode = -9
    def wait(self, timeout=None):
        self.wait_calls.append(timeout)
        if self.timeout_once:
            self.timeout_once = False
            raise subprocess.TimeoutExpired('CryLo-wallet-rpc.exe', timeout)
        return self.returncode


class WindowsRpcLauncherPreflight(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='crylo-launcher-plan-')
        self.addCleanup(self.tmp.cleanup)
        self.build = Path(self.tmp.name)
        self.bin = self.build / 'bin'
        self.bin.mkdir()
        for name in ('CryLo-daemon.exe', 'CryLo-wallet-rpc.exe'):
            (self.bin / name).write_bytes(b'fake executable for plan-only testing')

    def make_plan(self, tests=None, pay='', windows=True):
        return launcher.build_plan(
            'python', ROOT / 'tests' / 'functional_tests', self.build,
            tests or ['wallet'], pay, self.build / 'test-wallet-dir',
            self.build / 'test-session', windows=windows)

    def test_exact_windows_executable_suffixes_and_paths(self):
        cmds, env = self.make_plan()
        self.assertEqual(len(cmds), 10)
        self.assertTrue(all(x[0].endswith('.exe') for x in cmds))
        self.assertEqual(len(set(launcher.DAEMON_PORTS+launcher.WALLET_PORTS)),10)
        self.assertEqual(env['WALLET_DIRECTORY'], str(self.build / 'test-wallet-dir'))
        self.assertTrue(env['MAKE_TEST_SIGNATURE'].endswith('make_test_signature.exe'))
        self.assertEqual(cmds[0][cmds[0].index('--rpc-bind-ip')+1], '127.0.0.1')
        self.assertEqual(cmds[4][cmds[4].index('--rpc-bind-ip')+1], '127.0.0.1')
        self.assertEqual(cmds[2][-2:], ['--add-exclusive-node','127.0.0.1:18283'])
        self.assertEqual(cmds[3][-2:], ['--add-exclusive-node','127.0.0.1:18282'])
        self.assertTrue(all('--wallet-dir' in cmd for cmd in cmds[4:]))

    def test_payment_requires_verified_caller_input_before_any_launch(self):
        tests = launcher.select_tests(['all'])
        self.assertIn('rpc_payment', tests)
        with self.assertRaisesRegex(ValueError,'CRYLO_REGTEST_RPC_PAYMENT_ADDRESS'):
            launcher.validate_payment_address(tests, '')
        for bad in ('44SK'+'A'*93, 'Wo'+'0'*95, 'Wo'+'A'*94, 'Wo'+'A'*96):
            with self.assertRaises(ValueError):
                launcher.validate_payment_address(tests, bad)
        good = 'Wo'+'A'*95
        self.assertEqual(launcher.validate_payment_address(tests, good), good)
        cmds, _ = self.make_plan(['rpc_payment'],good)
        self.assertEqual(cmds[1][cmds[1].index('--rpc-payment-address')+1],good)
        self.assertTrue(all('--rpc-payment-address' not in x for x in cmds[:1]+cmds[2:]))

    def test_no_unknown_or_duplicate_test_executes(self):
        for chosen in ([], ['all','wallet'], ['wallet','wallet'], ['../../secret'], ['unknown']):
            with self.assertRaises(ValueError):
                launcher.select_tests(chosen)

    def test_startup_preflight_fails_when_executable_missing(self):
        (self.bin / 'CryLo-wallet-rpc.exe').unlink()
        with self.assertRaises(FileNotFoundError):
            self.make_plan()

    def test_windows_path_separator_and_seed_flags(self):
        with mock.patch.dict(os.environ, {'PYTHONPATH': 'C:/existing-python'}):
            _, env = self.make_plan()
        self.assertIn(os.pathsep, env['PYTHONPATH'])
        self.assertEqual(env['PYTHONPATH'].split(os.pathsep)[0], 'C:/existing-python')
        self.assertTrue(env['SOURCE_DIRECTORY'].endswith('functional_tests'))
        self.assertEqual(env['SEEDHASH_EPOCH_BLOCKS'], '8')
        self.assertEqual(env['SEEDHASH_EPOCH_LAG'], '4')

    def test_bounded_termination_and_force_kill(self):
        normal, stubborn = StubProcess(), StubProcess(timeout_once=True)
        launcher.stop_processes([normal, stubborn])
        self.assertTrue(normal.terminated and stubborn.terminated)
        self.assertTrue(stubborn.killed)
        self.assertEqual(stubborn.wait_calls, [launcher.STOP_SECONDS,launcher.KILL_SECONDS])

    def test_already_exited_child_is_reaped(self):
        proc = StubProcess(state=0)
        launcher.stop_processes([proc])
        self.assertFalse(proc.terminated)
        self.assertEqual(proc.wait_calls,[launcher.STOP_SECONDS])

    def test_service_failure_before_readiness_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,'exited during startup'):
            launcher.wait_ready([StubProcess(state=4)], [18180], 10**20)

    def test_no_servers_spawned_when_payment_missing(self):
        with mock.patch.object(launcher.subprocess,'Popen') as popen:
            with mock.patch.dict(os.environ,{'CRYLO_REGTEST_RPC_PAYMENT_ADDRESS':''}):
                code=launcher.main(['functional_tests_rpc.py','python',
                                    str(ROOT/'tests'/'functional_tests'),str(self.build),'all'])
            self.assertEqual(code,2)
            popen.assert_not_called()

    def test_exit_with_no_tests_does_not_return_success(self):
        with mock.patch.object(launcher.subprocess,'Popen') as popen:
            code=launcher.main(['functional_tests_rpc.py','python',
                                str(ROOT/'tests'/'functional_tests'),str(self.build)])
            self.assertNotEqual(code,0)
            popen.assert_not_called()


if __name__ == '__main__':
    unittest.main()
