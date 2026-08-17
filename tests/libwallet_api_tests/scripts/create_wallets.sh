#!/bin/bash

DAEMON_ADDRESS="${TESTNET_DAEMON_ADDRESS:-127.0.0.1:22641}"

function create_wallet {
    wallet_name=$1
    echo 0 | CryLo-wallet  --testnet --trusted-daemon --daemon-address "$DAEMON_ADDRESS" --generate-new-wallet $wallet_name --password "" --restore-height=1
}


create_wallet wallet_01.bin
create_wallet wallet_02.bin
create_wallet wallet_03.bin
create_wallet wallet_04.bin
create_wallet wallet_05.bin
create_wallet wallet_06.bin

# create_wallet wallet_m


