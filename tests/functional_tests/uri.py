#!/usr/bin/env python3
#encoding=utf-8

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

"""Test CryLo URI RPC using real regtest wallet-derived addresses."""

from __future__ import print_function

try:
    from urllib import quote as urllib_quote
except ImportError:
    from urllib.parse import quote as urllib_quote

from framework.wallet import Wallet


class URITest:
    def run_test(self):
        self.create()
        self.test_crylo_uri()

    def create(self):
        wallet = Wallet()
        try:
            wallet.close_wallet()
        except Exception:
            pass
        seed = 'velvet lymph giddy number token physics poetry unquoted nibs useful sabotage limits benches lifestyle eden nitrogen anvil fewest avoid batch vials washing fences goat unquoted'
        res = wallet.restore_deterministic_wallet(seed=seed)
        assert res.seed == seed
        self.primary_address = res.address
        assert wallet.validate_address(self.primary_address).valid
        self.subaddress = wallet.create_address(account_index=0, label="CryLo URI recipient").address
        assert wallet.validate_address(self.subaddress).valid
        self.integrated_address = wallet.make_integrated_address(payment_id="0123456789abcdef").integrated_address
        assert wallet.validate_address(self.integrated_address).valid

    def test_crylo_uri(self):
        print('Testing crylo: URI')
        wallet = Wallet()
        first = u'えんしゅう'
        second = u'あまやかす'
        quoted_first = urllib_quote(first.encode('utf8'))
        quoted_second = urllib_quote(second.encode('utf8'))
        payment_addresses = [self.primary_address, self.subaddress, self.integrated_address]

        # Invalid or missing payment destinations are rejected.
        for args in ({}, {"address": ""}, {"address": "kjshdkj"}):
            try:
                wallet.make_uri(**args)
            except Exception:
                pass
            else:
                raise AssertionError("make_uri accepted a missing or invalid CryLo address")

        for address in payment_addresses:
            result = wallet.make_uri(address=address)
            assert result.uri == "crylo:" + address
            parsed = wallet.parse_uri(result.uri)
            assert parsed.uri.address == address
            assert parsed.uri.payment_id == ''
            assert parsed.uri.amount == 0
            assert parsed.uri.tx_description == ''
            assert parsed.uri.recipient_name == ''
            assert not parsed.get('unknown_parameters', [])

            # CryLo atomic units have 11 decimal places; use an exact
            # atomic amount and require the RPC to round-trip it.
            atomic_amount = 11000000000
            result = wallet.make_uri(address=address, amount=atomic_amount)
            assert result.uri.startswith("crylo:" + address + "?tx_amount=")
            parsed = wallet.parse_uri(result.uri)
            assert parsed.uri.address == address
            assert parsed.uri.amount == atomic_amount
            assert not parsed.get('unknown_parameters', [])

        address = self.primary_address
        result = wallet.make_uri(address=address, tx_description=first)
        assert result.uri == "crylo:" + address + "?tx_description=" + quoted_first
        parsed = wallet.parse_uri(result.uri)
        assert parsed.uri.address == address
        assert parsed.uri.tx_description == first
        assert parsed.uri.recipient_name == ''

        result = wallet.make_uri(address=address, recipient_name=first)
        assert result.uri == "crylo:" + address + "?recipient_name=" + quoted_first
        parsed = wallet.parse_uri(result.uri)
        assert parsed.uri.address == address
        assert parsed.uri.recipient_name == first
        assert parsed.uri.tx_description == ''

        result = wallet.make_uri(address=address, recipient_name=first, tx_description=second)
        assert result.uri == ("crylo:" + address + "?recipient_name=" + quoted_first
                              + "&tx_description=" + quoted_second)
        parsed = wallet.parse_uri(result.uri)
        assert parsed.uri.recipient_name == first
        assert parsed.uri.tx_description == second

        atomic_unit = 100000000000  # 1 CryLo at 11 decimals.
        result = wallet.make_uri(address=address, amount=atomic_unit,
                                 recipient_name=first, tx_description=second)
        assert result.uri.startswith("crylo:" + address + "?tx_amount=")
        parsed = wallet.parse_uri(result.uri)
        assert parsed.uri.address == address
        assert parsed.uri.amount == atomic_unit
        assert parsed.uri.recipient_name == first
        assert parsed.uri.tx_description == second

        # A separate payment ID is not allowed with current CryLo URIs.
        try:
            wallet.make_uri(address=address, payment_id='1' * 64)
        except Exception:
            pass
        else:
            raise AssertionError("make_uri accepted deprecated standalone payment id")

        result = wallet.make_uri(address=address,
                                 tx_description=' ' + second + ' ' + first + ' ',
                                 amount=atomic_unit)
        assert "&tx_description=%20" in result.uri
        parsed = wallet.parse_uri(result.uri)
        assert parsed.uri.amount == atomic_unit
        assert parsed.uri.tx_description == ' ' + second + ' ' + first + ' '

        # Bad schemes, invalid addresses and malformed parameters must fail.
        invalid = [
            '', ':', 'crylo', 'crylo:', 'crylo:badaddress',
            'notcrylo:' + address, 'CRYLO:' + address,
            'monero:' + address,  # Negative compatibility check, never a payment destination.
            'crylo::' + address, 'crylo:tx_amount=10',
            'crylo:?tx_amount=10',
            'crylo:' + address + '?tx_amount=-1',
            'crylo:' + address + '?tx_amount=1e12',
            'crylo:' + address + '?tx_amount=+12',
            'crylo:' + address + '?tx_amount=1+2',
            'crylo:' + address + '?tx_amount=A',
            'crylo:' + address + '?tx_amount=0x2',
            'crylo:' + address + '?tx_amount=222222222222222222222',
            'crylo:' + address[:-1] + '1?tx_amount=10',
            'crylo:' + address + '&',
            'crylo:' + address + '&tx_amount',
            'crylo:' + address + '&tx_amount=',
            'crylo:' + address + '&tx_amount=10=',
            'crylo:' + address + '?tx_amount=10&tx_amount=20',
            'crylo:' + self.integrated_address + '?tx_payment_id=' + '1' * 64
        ]
        for bad_uri in invalid:
            try:
                wallet.parse_uri(bad_uri)
            except Exception:
                continue
            raise AssertionError("parse_uri accepted malformed or non-CryLo URI")

        # Unrecognized but syntactically valid parameters must be reported.
        for params, unknown in [
            ('foo=bar', ['foo=bar']),
            ('foo=bar&baz=quux', ['foo=bar', 'baz=quux']),
            ('%20=%20', ['%20=%20']),
            ('unknown=' + quoted_first, ['unknown=' + quoted_first])
        ]:
            result = wallet.parse_uri("crylo:" + address + "?tx_amount=239.39014&" + params)
            assert result.uri.address == address
            assert result.uri.amount == 23939014000000
            assert result.unknown_parameters == unknown


if __name__ == '__main__':
    URITest().run_test()
