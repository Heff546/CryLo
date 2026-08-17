#!/bin/bash

DAEMON_ADDRESS="${TESTNET_DAEMON_ADDRESS:-127.0.0.1:22641}"

rlwrap CryLo-wallet --wallet-file wallet_03.bin --password "" --testnet --trusted-daemon --daemon-address "$DAEMON_ADDRESS"  --log-file wallet_03.log

