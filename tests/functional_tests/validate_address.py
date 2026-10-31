#!/usr/bin/env python3

# Copyright (c) 2019-2022, The Monero Project
# 
# All rights reserved.
# 
# Redistribution and use in source and binary forms, with or without modification, are
# permitted provided that the following conditions are met:
# 
# 1. Redistributions of source code must retain the above copyright notice, this list of
#    conditions and the following disclaimer.
# 
# 2. Redistributions in binary form must reproduce the above copyright notice, this list
#    of conditions and the following disclaimer in the documentation and/or other
#    materials provided with the distribution.
# 
# 3. Neither the name of the copyright holder nor the names of its contributors may be
#    used to endorse or promote products derived from this software without specific
#    prior written permission.
# 
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
# EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
# THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
# SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
# PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
# STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
# THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

"""Test address validation RPC calls
"""

from __future__ import print_function
import os
from framework.wallet import Wallet
from crylo_address_vectors import (PRIMARY_ADDRESS, SECOND_ADDRESS, INTEGRATED_ADDRESS_VALIDATION,
    SUB_VALIDATION_1, SUB_VALIDATION_2)

class AddressValidationTest():
    def run_test(self):
      self.create()
      self.check_bad_addresses()
      self.check_good_addresses()
      self.check_openalias_addresses()

    def create(self):
        print('Creating wallet')
        seed = 'velvet lymph giddy number token physics poetry unquoted nibs useful sabotage limits benches lifestyle eden nitrogen anvil fewest avoid batch vials washing fences goat unquoted'
        address = PRIMARY_ADDRESS
        self.wallet = Wallet()
        # close the wallet if any, will throw if none is loaded
        try: self.wallet.close_wallet()
        except: pass
        res = self.wallet.restore_deterministic_wallet(seed = seed)
        assert res.address == address
        assert res.seed == seed

    def check_bad_addresses(self):
        print('Validating bad addresses')
        bad_addresses = ['', 'a', PRIMARY_ADDRESS[:-1] + ('1' if PRIMARY_ADDRESS[-1] != '1' else '2'), ' ', '@', 'monero:' + PRIMARY_ADDRESS]
        for address in bad_addresses:
            res = self.wallet.validate_address(address, any_net_type = False)
            assert not res.valid
            res = self.wallet.validate_address(address, any_net_type = True)
            assert not res.valid

    def check_good_addresses(self):
        print('Validating good addresses')
        # CryLo mainnet vectors use current prefixes. The existing testnet/
        # stagenet vectors below are retained only for cross-network validation;
        # those prefixes overlap Monero and require a separate protocol review.
        addresses = [
            [ 'mainnet',  '', PRIMARY_ADDRESS ],
            [ 'mainnet',  '', SECOND_ADDRESS ],
            [ 'testnet',  '', '9ujeXrjzf7bfeK3KZdCqnYaMwZVFuXemPU8Ubw335rj2FN1CdMiWNyFV3ksEfMFvRp9L9qum5UxkP5rN9aLcPxbH1au4WAB' ],
            [ 'stagenet', '', '53teqCAESLxeJ1REzGMAat1ZeHvuajvDiXqboEocPaDRRmqWoVPzy46GLo866qRFjbNhfkNckyhST3WEvBviDwpUDd7DSzB' ],
            [ 'mainnet', 'i', INTEGRATED_ADDRESS_VALIDATION ],
            [ 'mainnet', 's', SUB_VALIDATION_1 ],
            [ 'mainnet', 's', SUB_VALIDATION_2 ],
            [ 'testnet', 'i', 'AApMA1VuhiCaHzr5X2KXi2Zc9oJ3VaGjkfChxxpRpxkyKf1NetvbRbQTbFMrGkr85DjnEH7JsBaoUFsgKwZnmtnVWnoB8MDotCsLb7eWwz' ],
            [ 'testnet', 's', 'BdKg9udkvckC5T58a8Nmtb6BNsgRAxs7uA2D49sWNNX5HPW5Us6Wxu8QMXrnSx3xPBQQ2iu9kwEcRGAoiz6EPmcZKbF62GS' ],
            [ 'testnet', 's', 'BcFvPa3fT4gVt5QyRDe5Vv7VtUFao9ci8NFEy3r254KF7R1N2cNB5FYhGvrHbMStv4D6VDzZ5xtxeKV8vgEPMnDcNFuwZb9' ],
            [ 'stagenet', 'i', '5K8mwfjumVseCcQEjNbf59Um6R9NfVUNkHTLhhPCmNvgDLVS88YW5tScnm83rw9mfgYtchtDDTW5jEfMhygi27j1QYphX38hg6m4VMtN29' ],
            [ 'stagenet', 's', '73LhUiix4DVFMcKhsPRG51QmCsv8dYYbL6GcQoLwEEFvPvkVvc7BhebfA4pnEFF9Lq66hwvLqBvpHjTcqvpJMHmmNjPPBqa' ],
            [ 'stagenet', 's', '7A1Hr63MfgUa8pkWxueD5xBqhQczkusYiCMYMnJGcGmuQxa7aDBxN1G7iCuLCNB3VPeb2TW7U9FdxB27xKkWKfJ8VhUZthF' ],
        ]
        for any_net_type in [True, False]:
            for address in addresses:
                res = self.wallet.validate_address(address[2], any_net_type = any_net_type)
                if any_net_type or address[0] == 'mainnet':
                    assert res.valid
                    assert res.integrated == (address[1] == 'i')
                    assert res.subaddress == (address[1] == 's')
                    assert res.nettype == address[0]
                    assert res.openalias_address == ''
                else:
                    assert not res.valid

    def check_openalias_addresses(self):
        # Never resolve a third-party Monero donation alias by default.
        # Explicit fixtures require a real, reviewed CryLo alias and expected
        # CryLo public address. This is an external DNS integration case, not
        # a self-contained wallet unit test.
        alias = os.environ.get('CRYLO_TEST_OPENALIAS', '').strip()
        expected = os.environ.get('CRYLO_TEST_OPENALIAS_EXPECTED_ADDRESS', '').strip()
        if bool(alias) != bool(expected):
            raise AssertionError("Both CryLo OpenAlias test environment variables are required")
        if not alias:
            print("SKIP: external OpenAlias DNS validation (no reviewed CryLo test alias configured)")
            return
        expected_validation = self.wallet.validate_address(expected)
        assert expected_validation.valid
        assert expected.startswith(('Wo', 'WW'))
        assert not self.wallet.validate_address(alias).valid
        res = self.wallet.validate_address(alias, allow_openalias = True)
        assert res.valid
        assert res.integrated == expected_validation.integrated
        assert res.subaddress == expected_validation.subaddress
        assert res.nettype == 'mainnet'
        assert res.openalias_address == expected

if __name__ == '__main__':
    AddressValidationTest().run_test()
