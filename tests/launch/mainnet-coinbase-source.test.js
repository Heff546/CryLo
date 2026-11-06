'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const config = read('src/cryptonote_config.h');
const generator = read('src/cryptonote_core/cryptonote_tx_utils.cpp');
const validator = read('src/cryptonote_core/blockchain.cpp');
const hardforks = read('src/hardforks/hardforks.cpp');
const preflight = read('scripts/release/mainnet-launch-preflight.js');

function macro(name) {
  const match = config.match(
    new RegExp('^#define\\s+' + name + '\\s+(\\d+)\\b', 'm')
  );
  assert.ok(match, 'Missing macro: ' + name);
  return BigInt(match[1]);
}

const devBps = macro('CryLo_DEV_FUND_FEE_BPS');
const liquidityBps = macro('CryLo_LIQUIDITY_FUND_FEE_BPS');
const testnetGasBps = macro('CryLo_GAS_TREASURY_FEE_BPS');
const mainnetGasBps = macro('CryLo_GAS_TREASURY_FEE_BPS_MAINNET');

function allocations(rewardAtomic, network) {
  const dev = rewardAtomic * devBps / 10000n;
  const liquidity = network === 'mainnet'
    ? 0n : rewardAtomic * liquidityBps / 10000n;
  const gas = rewardAtomic *
    (network === 'mainnet' ? mainnetGasBps : testnetGasBps) / 10000n;
  const miner = rewardAtomic - dev - liquidity - gas;
  const instant = miner / 2n;
  const vested = miner - instant;
  return network === 'mainnet'
    ? [instant, vested, dev, gas]
    : [instant, vested, dev, liquidity, gas];
}

test('mainnet and existing testnet protocol allocations both total 150 basis points', () => {
  assert.equal(devBps, 75n);
  assert.equal(liquidityBps, 25n);
  assert.equal(testnetGasBps, 50n);
  assert.equal(mainnetGasBps, 75n);
  assert.equal(devBps + mainnetGasBps, 150n);
  assert.equal(devBps + liquidityBps + testnetGasBps, 150n);
});

test('coinbase creator selects mainnet zero liquidity and higher Gas Treasury rate', () => {
  assert.match(generator,
    /liquidity_fund_amount\s*=\s*\(m_nettype\s*==\s*MAINNET\s*\?\s*0\s*:/);
  assert.match(generator,
    /gas_treasury_amount\s*=\s*block_reward\s*\*\s*\(m_nettype\s*==\s*MAINNET\s*\?\s*CryLo_GAS_TREASURY_FEE_BPS_MAINNET\s*:\s*CryLo_GAS_TREASURY_FEE_BPS\)/);
  assert.match(generator, /if \(liquidity_fund_amount > 0\)/);
  assert.match(generator, /if \(gas_treasury_amount > 0\)/);
});

test('validator mirrors both network allocations and enforces correct output indices', () => {
  assert.match(validator, /const size_t required_outs = m_nettype == MAINNET \? 4 : 5;/);
  assert.match(validator, /b\.miner_tx\.vout\.size\(\) != required_outs/);
  assert.match(validator,
    /liquidity_fund_expected\s*=\s*\(m_nettype\s*==\s*MAINNET\s*\?\s*0\s*:/);
  assert.match(validator,
    /gas_treasury_expected\s*=\s*total_reward\s*\*\s*\(m_nettype\s*==\s*MAINNET\s*\?\s*CryLo_GAS_TREASURY_FEE_BPS_MAINNET\s*:\s*CryLo_GAS_TREASURY_FEE_BPS\)/);
  assert.match(validator,
    /if \(m_nettype == MAINNET\)[\s\S]*?b\.miner_tx\.vout\[3\]\.amount != gas_treasury_expected/);
  assert.match(validator,
    /b\.miner_tx\.vout\[3\]\.amount != liquidity_fund_expected[\s\S]*?b\.miner_tx\.vout\[4\]\.amount != gas_treasury_expected/);
  assert.match(validator, /size_t max_outs = hf_version >= HF_VERSION_VESTING \?\s*\(m_nettype == MAINNET \? 4 : 5\)/);
});

test('mainnet v21 and testnet hardfork schedules are preserved', () => {
  assert.match(hardforks, /const hardfork_t mainnet_hard_forks\[\] = \{\s*\{ 17, 0, 1, 1700000000 \},\s*\{ 21, 2, 1, 1700000001 \}/);
  assert.match(hardforks, /const hardfork_t testnet_hard_forks\[\]/);
});

test('integer rounding and conservation at a range of coinbase rewards', () => {
  const atomicSamples = [
    250000000000n, 20000000000n, 100000000001n,
    20000000001n, 99999999999n, 123456789987n, 250000000001n
  ];
  for (const reward of atomicSamples) {
    for (const network of ['mainnet', 'testnet']) {
      const outputs = allocations(reward, network);
      assert.equal(outputs.length, network === 'mainnet' ? 4 : 5);
      assert.equal(outputs.reduce((sum, amount) => sum + amount, 0n), reward);
      assert.ok(outputs.every(amount => amount >= 0n));
      assert.ok(outputs[1] >= outputs[0] && outputs[1] - outputs[0] <= 1n);
      if (network === 'mainnet') {
        assert.equal(outputs[3], reward * 75n / 10000n);
      } else {
        assert.equal(outputs[3], reward * 25n / 10000n);
        assert.equal(outputs[4], reward * 50n / 10000n);
      }
    }
  }
});

test('treasury destination must remain an explicit mainnet blocker until verified', () => {
  // Existing validator checks gas amount, not the destination key. A green
  // source allocation check cannot authorize mainnet publication.
  assert.match(preflight, /Gas Treasury output key MISMATCH/);
  assert.match(preflight, /gas_treasury_derivation/);
  assert.match(preflight, /gas_treasury_view_skey/);
  assert.doesNotMatch(validator, /Gas Treasury output key MISMATCH/);
});

test('official mainnet release builder fails closed on source preflight', () => {
  const builder = read('scripts/release/crylo-release.js');
  assert.match(builder, /if \(releaseNetwork === 'mainnet'\)/);
  assert.match(builder, /mainnet-launch-preflight\.js/);
  assert.match(builder, /gate\.status !== 0/);
  assert.match(builder, /Mainnet release blocked by consensus, recipient or updater preflight/);
});
