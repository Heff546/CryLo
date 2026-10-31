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

"""CryLo integrated-address RPC tests: validated wallet-derived inputs."""

from __future__ import print_function
from framework.wallet import Wallet


class IntegratedAddressTest():
    def run_test(self):
        self.create()
        self.check()

    def create(self):
        print("Restoring CryLo test wallets")
        seeds = [
            'velvet lymph giddy number token physics poetry unquoted nibs useful sabotage limits benches lifestyle eden nitrogen anvil fewest avoid batch vials washing fences goat unquoted',
            'peeled mixture ionic radar utopia puddle buying illness nuns gadget river spout cavernous bounced paradise drunk looking cottage jump tequila melting went winter adjust spout',
        ]
        self.addresses = []
        for i, seed in enumerate(seeds):
            wallet = Wallet(idx = i)
            try:
                wallet.close_wallet()
            except Exception:
                pass
            result = wallet.restore_deterministic_wallet(seed = seed)
            assert result.seed == seed
            self.addresses.append(result.address)
            assert wallet.validate_address(result.address).valid
        assert self.addresses[0] != self.addresses[1]

    def check(self):
        wallet = Wallet()
        payment_ids = ('0123456789abcdef', '1122334455667788')

        for address, payment_id in zip(self.addresses, payment_ids):
            result = wallet.make_integrated_address(
                standard_address = address, payment_id = payment_id)
            combined = result.integrated_address
            assert result.payment_id == payment_id
            assert combined != address
            assert wallet.validate_address(combined).valid
            decoded = wallet.split_integrated_address(combined)
            assert decoded.standard_address == address
            assert decoded.payment_id == payment_id

        address = self.addresses[1]
        bad_ids = [
            '11223344556677880', '112233445566778', '112233445566778g',
            '1122334455667788112233445566778811223344556677881122334455667788',
        ]
        for bad_id in bad_ids:
            try:
                wallet.make_integrated_address(standard_address = address, payment_id = bad_id)
            except Exception:
                pass
            else:
                raise AssertionError("Accepted invalid integrated payment ID: " + bad_id)

        corrupt_address = address[:-1] + ('1' if address[-1] != '1' else '2')
        assert not wallet.validate_address(corrupt_address).valid
        combined = wallet.make_integrated_address(
            standard_address = address, payment_id = payment_ids[1]).integrated_address
        for bad_standard in (corrupt_address, combined):
            try:
                wallet.make_integrated_address(standard_address = bad_standard, payment_id = payment_ids[1])
            except Exception:
                pass
            else:
                raise AssertionError("Accepted invalid standard address")


if __name__ == '__main__':
    IntegratedAddressTest().run_test()
