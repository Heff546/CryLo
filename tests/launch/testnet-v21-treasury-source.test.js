'use strict';
// Source-level HOLD checks only. Passing these does not authorize Testnet v21.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const file = p => fs.readFileSync(path.join(root, p), 'utf8');

const config = file('src/cryptonote_config.h');
const fork = file('src/hardforks/hardforks.cpp');
const miner = file('src/cryptonote_core/cryptonote_tx_utils.cpp');
const validator = file('src/cryptonote_core/blockchain.cpp');
const extra = file('src/cryptonote_basic/tx_extra.h');
const sorter = file('src/cryptonote_basic/cryptonote_format_utils.cpp');
const gas = file('src/cryptonote_core/crylo_testnet_gas_treasury_proof.h');
const dev = file('src/cryptonote_core/crylo_testnet_dev_fund_proof.h');
const liq = file('src/cryptonote_core/crylo_testnet_liquidity_proof.h');

test('v21 remains UNSCHEDULED: no change to active Testnet V4 hardfork history', () => {
  assert.match(config, /#define HF_VERSION_TESTNET_TREASURY_PROOFS\s+21/);
  const testnet = fork.split('const hardfork_t testnet_hard_forks[] = {')[1]
                       ?.split('};')[0] || '';
  assert.ok(testnet, 'testnet hardfork table must exist');
  assert.match(testnet, /\{\s*20,\s*2100,/);
  assert.doesNotMatch(testnet, /\{\s*21,/);
  assert.doesNotMatch(testnet, /\{\s*(2[2-9]|[3-9][0-9]),/);
});

test('approved 75/25/50 bps are unchanged', () => {
  for (const [name, value] of [
    ['CryLo_DEV_FUND_FEE_BPS', 75],
    ['CryLo_LIQUIDITY_FUND_FEE_BPS', 25],
    ['CryLo_GAS_TREASURY_FEE_BPS', 50]
  ]) {
    assert.match(config, new RegExp('#define\\s+' + name + '\\s+' + value + '\\b'));
  }
});

test('all three DLEQ transcripts bind TESTNET network ID, genesis and height', () => {
  for (const [text, fund] of [[dev, 'DevelopmentFundCoinbase'],
      [liq, 'LiquidityCoinbase'], [gas, 'GasTreasuryCoinbase']]) {
    assert.ok(text.includes('CryLo:testnet-v4+:' + fund + ':DLEQ:v1'));
    assert.ok(text.includes('config::testnet::NETWORK_ID'));
    assert.ok(text.includes('config::testnet::GENESIS_TX'));
    assert.ok(text.includes('get_transaction_prefix_hash'));
    assert.ok(text.includes('height >> (8 * i)'));
    assert.doesNotMatch(text, /CryLo:mainnet:|config::NETWORK_ID|config::GENESIS_TX/);
  }
});

test('future Testnet v21 miner adds Development, Liquidity, Gas public proofs', () => {
  assert.match(miner, /m_nettype == TESTNET && height > 0[\s\S]*hard_fork_version >= HF_VERSION_TESTNET_TREASURY_PROOFS/);
  const i = ['add_crylo_testnet_dev_fund_proof(',
             'add_crylo_testnet_liquidity_proof(',
             'add_crylo_testnet_treasury_proof('].map(x => miner.indexOf(x));
  assert.ok(i.every(x => x >= 0) && i[0] < i[1] && i[1] < i[2]);
  assert.match(miner, /canonical_nonce\.nonce = extra_nonce/);
  assert.match(miner, /!::do_serialize\(ar, canonical_nonce\)/);
});

test('future v21 verification never calls the historical private viewing key', () => {
  const start = validator.indexOf('if (m_nettype == TESTNET &&\n        version >= HF_VERSION_TESTNET_TREASURY_PROOFS)');
  const end = validator.indexOf('    else\n    {\n    \/\/ Verify dev fund output key', start);
  assert.ok(start >= 0 && end > start);
  const guarded = validator.slice(start, end);
  assert.doesNotMatch(guarded, /CryLo_DEV_FUND_VIEWKEY_SECRET/);
  for (const functionName of [
    'verify_crylo_testnet_dev_fund_proof',
    'verify_crylo_testnet_liquidity_proof',
    'verify_crylo_testnet_treasury_proof'
  ]) assert.ok(guarded.includes(functionName + '('));
  const legacy = validator.slice(end);
  assert.ok(legacy.includes('CryLo_DEV_FUND_VIEWKEY_SECRET'));
});

test('the three canonical proof fields are parsed and sorted', () => {
  for (const name of ['CRYLO_DEV_FUND_PROOF','CRYLO_LIQUIDITY_PROOF',
                       'CRYLO_GAS_TREASURY_PROOF']) {
    assert.ok(extra.includes('TX_EXTRA_TAG_' + name));
    assert.ok(sorter.includes('TX_EXTRA_TAG_' + name));
  }
  assert.match(gas, /tx\.extra\.size\(\) < 3 \* CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES/);
  assert.match(dev, /tx\.extra\.size\(\) < 3 \* CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES/);
  assert.match(liq, /tx\.extra\.size\(\) < 3 \* CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES/);
});

test('template padding never follows signed proofs in future v21', () => {
  assert.match(validator, /hf_version >= HF_VERSION_TESTNET_TREASURY_PROOFS[\s\S]*consensus_extra_nonce\.append\(added, '\\0'\)/);
  assert.match(validator, /if \(weight_added > delta\)/);
  assert.match(validator, /new_len >= 128/);
});

test('native adversarial proof suite is registered for compilation', () => {
  assert.ok(file('tests/unit_tests/CMakeLists.txt').includes('crylo_testnet_treasury_proof.cpp'));
  const testfile = file('tests/unit_tests/crylo_testnet_treasury_proof.cpp');
  assert.ok((testfile.match(/TEST_F\(/g) || []).length >= 25);
  assert.ok(testfile.includes('ExistingV20TransactionHasNoRecipientProof'));
});

test('the actual Blockchain validator is exercised against an in-memory Testnet DB', () => {
  const native = file('tests/unit_tests/crylo_testnet_block_validator.cpp');
  assert.ok(native.includes('chain().validate_miner_transaction('));
  assert.ok(native.includes('chain.m_nettype = cryptonote::TESTNET'));
  assert.ok(native.includes('cryptonote::BaseTestDB'));
  assert.ok(native.includes('LegacyV20RecipientGapStillRequiresFutureFork'));
  assert.ok(native.includes('RedirectedDevelopmentOutputRejected'));
  assert.ok(native.includes('RedirectedLiquidityOutputRejected'));
  assert.ok(native.includes('RedirectedGasTreasuryOutputRejected'));
  assert.ok(file('tests/unit_tests/CMakeLists.txt')
      .includes('crylo_testnet_block_validator.cpp'));
});
