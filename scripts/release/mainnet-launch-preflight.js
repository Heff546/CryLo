'use strict';

// Read-only evidence checks for the CryLo mainnet transition. A passing
// result is NECESSARY, not sufficient: native consensus and release E2E
// testing, trusted keys, deployment and approval remain separate gates.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}
const config = source('src/cryptonote_config.h');
const miner = source('src/cryptonote_core/cryptonote_tx_utils.cpp');
const blockchain = source('src/cryptonote_core/blockchain.cpp');
const launcher = source('scripts/crylo.js');
const wallet = source('electron/main.js');
const renderer = source('electron/src/app.js');
const checks = [];

function check(name, condition, remediation) {
  checks.push({ name, passed: Boolean(condition), remediation });
}

function numberMacro(name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}]/g, '\\$&');
  const match = config.match(new RegExp('^#define\\s+' + escaped + '\\s+(\\d+)\\b', 'm'));
  return match ? Number(match[1]) : null;
}

const dev = numberMacro('CryLo_DEV_FUND_FEE_BPS');
const legacyLiquidity = numberMacro('CryLo_LIQUIDITY_FUND_FEE_BPS');
const legacyGas = numberMacro('CryLo_GAS_TREASURY_FEE_BPS');

console.log('Observed shared consensus defaults (basis points): Dev=' + dev +
  ', Liquidity=' + legacyLiquidity + ', Gas=' + legacyGas);
console.log('Required MAINNET policy: Dev=75, Liquidity=0, Gas=75');
console.log('');

check(
  'Development consensus allocation is 0.75%',
  dev === 75,
  'Set and test the intended 75 bp Development payout'
);
check(
  'Mainnet has no liquidity coinbase output',
  /mainnet/i.test(miner) &&
  /liquidity_fund_amount\s*=\s*\(?m_nettype\s*==\s*MAINNET\s*\?\s*0(?:ULL)?\s*:/.test(miner) &&
  /liquidity_fund_expected\s*=\s*\(?m_nettype\s*==\s*MAINNET\s*\?\s*0(?:ULL)?\s*:/.test(blockchain),
  'Remove mainnet liquidity allocation in both coinbase creation and validation, preserving testnet rules'
);
check(
  'Mainnet Gas Treasury consensus allocation is 0.75%',
  (numberMacro('CryLo_GAS_TREASURY_FEE_BPS_MAINNET') === 75 ||
   numberMacro('CryLo_MAINNET_GAS_TREASURY_FEE_BPS') === 75) &&
  miner.includes('CryLo_GAS_TREASURY_FEE_BPS_MAINNET') &&
  blockchain.includes('CryLo_GAS_TREASURY_FEE_BPS_MAINNET'),
  'Set 75 bp mainnet-only gas allocation in construction AND validation'
);
check(
  'Mainnet HF19+ coinbase has four validated outputs',
  /m_nettype\s*==\s*MAINNET\s*\?\s*4\s*:\s*5/.test(blockchain) &&
  /m_nettype\s*==\s*MAINNET\s*\?\s*4\s*:\s*5/.test(blockchain.slice(blockchain.indexOf('size_t max_outs'))),
  'Validate instant, vested, Dev and Gas output order (4); preserve testnet (5)'
);
check(
  'Treasury recipient destination has consensus key verification',
  blockchain.includes('Gas Treasury output key MISMATCH') &&
  blockchain.includes('gas_treasury_derivation') &&
  blockchain.includes('gas_treasury_view_skey'),
  'Require proof Gas Treasury output pays the intended address; do not accept amount-only validation'
);
check(
  'Mainnet updater has a dedicated authenticated release channel',
  !/mode:\s*'testnet'/.test(launcher) &&
  launcher.includes('crylo-mainnet-release-ed25519-public.pem') &&
  launcher.includes('mainnet') &&
  !/\$\{manifest\.version\}-testnet/.test(launcher),
  'Keep signed testnet releases unchanged; implement independent authenticated mainnet tag/key/rollback policy'
);
check(
  'Wallet isolates mainnet data and checks daemon identity',
  wallet.includes('wallets-mainnet') &&
  wallet.includes('CryLo-mainnet') &&
  wallet.includes('assertDaemonNetwork()') &&
  wallet.includes('info.nettype !== CRYLO_NETWORK_MODE'),
  'Separate mainnet/testnet wallet data and refuse wrong-network mining'
);
check(
  'Bridge status requires private capability and HTTPS',
  wallet.includes('saveBridgeStatusCapability(') &&
  wallet.includes("'X-Bridge-Status-Token': token") &&
  wallet.includes("nexusApiUrl('/bridge/status')") &&
  wallet.includes("redirect: 'error'") &&
  !wallet.includes('34.19.201.107') &&
  !renderer.includes('if (res.processed)'),
  'Do not expose bridge status tokens to renderer, URLs, logs or HTTP'
);

for (const c of checks) {
  console.log((c.passed ? 'PASS' : 'BLOCK') + ' ' + c.name);
  if (!c.passed) console.log('  Needed: ' + c.remediation);
}
const blocked = checks.filter(c => !c.passed);
console.log('');
console.log(blocked.length
  ? 'MAINNET SOURCE PREFLIGHT BLOCKED (' + blocked.length + ' unresolved items).'
  : 'SOURCE PREFLIGHT PASS — native consensus tests, deployment, signed artifacts and operator approval still required.');
if (blocked.length) process.exitCode = 1;
