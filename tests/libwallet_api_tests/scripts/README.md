# Running libwallet_api Tests

These helper scripts support the CryLo libwallet API test environment.

## Environment for the Tests

A CryLo daemon must be available for the test environment.

The daemon address used by the test suite may be overridden with:

```bash
TESTNET_DAEMON_ADDRESS=<your_daemon_address>
```

CryLo network ports are defined by the active network configuration.

Current CryLo mainnet and testnet defaults are:

- P2P: `22640`
- RPC: `22641`
- ZMQ RPC: `22642`

CryLo stagenet uses its separately defined stagenet ports.

The tests also require a directory containing pre-generated test wallets such as:

```text
wallet_01.bin
wallet_02.bin
wallet_03.bin
wallet_04.bin
wallet_05.bin
wallet_06.bin
```

The wallet directory may be overridden with:

```bash
WALLETS_ROOT_DIR=<your_directory_with_wallets>
```

The directory and wallet files must be writable by the user running the tests.

## Generating Test Wallets

`create_wallets.sh` creates the test wallets in the current directory.

The current CryLo command-line wallet executable is:

```text
CryLo-wallet
```

To create the miner wallet as well, enable the corresponding `wallet_m` creation line in `create_wallets.sh`.

The miner wallet is used to mine test funds that can then be distributed to the other test wallets.

## Mining Helpers

The following scripts control mining through the miner wallet:

```text
mining_start.sh
mining_stop.sh
```

## Seeding Test Wallets

`send_funds.sh` distributes test funds from the miner wallet to the generated test wallets.

Only run the funding helper after the miner wallet contains sufficient test funds.

## CryLo Executables

The current CryLo executable names relevant to these tests are:

```text
CryLo-daemon
CryLo-wallet
CryLo-wallet-rpc
```

The helper scripts in this directory must use CryLo executable names and the appropriate CryLo network configuration.
