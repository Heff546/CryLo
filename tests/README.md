# Running All Tests

To run all tests:

```bash
cd /path/to/CryLo
make [-jn] debug-test
```

where `n` is the number of compiler processes.

To test a release build, replace `debug-test` with `release-test`.

# Core Tests

Core tests take longer than most other CryLo tests because of the amount of computational work involved in validating core components.

Tests are located in `tests/core_tests/` and follow a straightforward naming convention. Most cases cover core functionality such as `block_reward.cpp`, `chaingen.cpp`, and `rct.cpp`, while others cover security scenarios such as `double_spend.cpp` and `integer_overflow.cpp`.

To run only CryLo's core tests after building:

```bash
cd build/debug/tests/core_tests
ctest
```

To run the same tests on a release build, replace `debug` with `release`.

# Crypto Tests

Crypto tests are located under `tests/crypto`.

- `crypto-tests.h` contains test harness headers.
- `main.cpp` implements the driver for the crypto tests.

Tests correspond to components under `src/crypto/`. New tests should continue the existing naming convention.

To run only CryLo's crypto tests after building:

```bash
cd build/debug/tests/crypto
ctest
```

To run the same tests on a release build, replace `debug` with `release`.

# Daemon Tests

TODO.

# Functional Tests

Functional tests are located under `tests/functional_tests`.

Building all tests requires the following Python dependencies:

```bash
pip install requests psutil monotonic zmq deepdiff
```

For regression testing, start a CryLo daemon in offline mode with a fixed difficulty:

```bash
CryLo-daemon --regtest --offline --fixed-difficulty 1
```

Alternatively, multiple daemons may be connected with `--add-exclusive-node`. Use the same fixed difficulty on each daemon.

Restore the required test wallet with the seed and restore height expected by the functional test being run.

Open the wallet with `CryLo-wallet-rpc` using an available local wallet RPC port, then invoke the required functional test such as `./blockchain.py` or `./speed.py`.

## Parameters

### Mining Test

The following environment variables may be set to control the mining test:

- `MINING_NO_MEASUREMENT` — use fixed, sufficiently large mining timeouts.
- `MINING_SILENT` — disable mining logging.

Example:

```bash
export MINING_NO_MEASUREMENT=1
ctest -V -R functional_tests_rpc
unset MINING_NO_MEASUREMENT
```

# Fuzz Tests

Fuzz tests are written using American Fuzzy Lop (AFL) and are located under `tests/fuzz`.

The helper utility `contrib/fuzz_testing/fuzz.sh` may be used when AFL and its required environment are available.

# Hash Tests

Hash tests are located under `tests/hash` and include sets of target hashes in text files.

To run only CryLo's hash tests after building:

```bash
cd build/debug/tests/hash
ctest
```

To run the same tests on a release build, replace `debug` with `release`.

# Libwallet API Tests

See `tests/libwallet_api_tests/scripts/README.md`.

# Net Load Tests

TODO.

# Performance Tests

Performance tests are located in `tests/performance_tests` and measure performance characteristics on the host machine.

To run only CryLo's performance tests after building:

```bash
cd build/debug/tests/performance_tests
./performance_tests
```

Build paths may vary by platform and configuration.

If the `performance_tests` binary does not exist, build the corresponding performance-test target first.

To run the same tests on a release build, replace `debug` with `release`.

# Unit Tests

Unit tests are defined under `tests/unit_tests`. Independent components are tested individually.

To run only CryLo's unit tests after building:

```bash
cd build/debug/tests/unit_tests
ctest
```

To run the same tests on a release build, replace `debug` with `release`.

# Writing New Tests

## Test Hygiene

Implement functions in `.cpp` or `.c` files and keep function declarations in `.h` files where practical. This keeps the larger test suites easier to maintain.

## Writing Fuzz Tests

TODO.
