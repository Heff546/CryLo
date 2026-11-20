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
const treasuryProof = source('src/cryptonote_core/crylo_gas_treasury_proof.h');
const liquidityProof = source('src/cryptonote_core/crylo_liquidity_proof.h');
const txExtra = source('src/cryptonote_basic/tx_extra.h');
const txExtraParser = source('src/cryptonote_basic/cryptonote_format_utils.cpp');
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
const liquidity = numberMacro('CryLo_LIQUIDITY_FUND_FEE_BPS');
const gas = numberMacro('CryLo_GAS_TREASURY_FEE_BPS');

console.log('Observed consensus treasury allocation (basis points): Dev=' + dev +
  ', Liquidity=' + liquidity + ', Gas=' + gas);
console.log('APPROVED mainnet allocation: Dev=75, Liquidity=25, Gas=50');
console.log('');

check(
  'Development consensus allocation is 0.75%',
  dev === 75,
  'Set and test the intended 75 bp Development payout'
);
check(
  'All networks allocate 0.25% to the Liquidity Fund',
  liquidity === 25 &&
  /liquidity_fund_amount\s*=\s*block_reward\s*\*\s*CryLo_LIQUIDITY_FUND_FEE_BPS\s*\/\s*10000/.test(miner) &&
  /liquidity_fund_expected\s*=\s*total_reward\s*\*\s*CryLo_LIQUIDITY_FUND_FEE_BPS\s*\/\s*10000/.test(blockchain) &&
  blockchain.includes('b.miner_tx.vout[3].amount != liquidity_fund_expected'),
  'Enforce 25 bp Liquidity output index 3; source recipient-proof wiring and native proof validity are separate gates'
);
check(
  'All networks allocate 0.50% to the Gas Treasury',
  gas === 50 &&
  !config.includes('CryLo_GAS_TREASURY_FEE_BPS_MAINNET') &&
  /gas_treasury_amount\s*=\s*block_reward\s*\*\s*CryLo_GAS_TREASURY_FEE_BPS\s*\/\s*10000/.test(miner) &&
  /gas_treasury_expected\s*=\s*total_reward\s*\*\s*CryLo_GAS_TREASURY_FEE_BPS\s*\/\s*10000/.test(blockchain) &&
  blockchain.includes('b.miner_tx.vout[4].amount != gas_treasury_expected'),
  'Enforce 50 bp Gas Treasury output index 4 and prevent unapproved mainnet-specific rates'
);
check(
  'HF19+ coinbase has five validated outputs on all networks',
  /const size_t required_outs = 5;/.test(blockchain) &&
  /size_t max_outs = hf_version >= HF_VERSION_VESTING \?\s*5\s*:/.test(blockchain) &&
  miner.includes('gas_treasury_addr.m_spend_public_key, 4)') &&
  blockchain.includes('gas_treasury_view_pkey, gas_treasury_spend_pkey, 4)'),
  'Validate instant, vested, Dev, Liquidity, Gas output order (5) on every network'
);
check(
  'Mainnet block-template padding preserves canonical dual-proof suffix (source-only)',
  blockchain.includes('blobdata consensus_extra_nonce = ex_nonce;') &&
  blockchain.includes('consensus_extra_nonce.append(added_nonce_bytes') &&
  blockchain.includes('added_nonce_bytes > TX_EXTRA_NONCE_MAX_COUNT - original_nonce_length') &&
  blockchain.includes('original_nonce_length >= 128 ? 1 : 0') &&
  blockchain.includes('new_nonce_length >= 128 ? 1 : 0') &&
  miner.includes('tx_extra_field field = canonical_nonce;') &&
  miner.includes('binary_archive<true> ar(stream);') &&
  miner.includes('!::do_serialize(ar, field)') &&
  /m_nettype == MAINNET && height > 0 &&\s*hf_version >= HF_VERSION_VESTING/.test(blockchain) &&
  (blockchain.match(/construct_miner_tx\(this, m_nettype, height, median_weight, already_generated_coins,[^;]+consensus_extra_nonce, max_outs, hf_version\)/g) || []).length === 2,
  'Rebuild the MAINNET coinbase with nonce padding BEFORE Liquidity and Gas proofs; never add trailing bytes after the proof fields'
);
// STRUCTURAL ONLY: this is not a native consensus or cryptographic audit.
// The earlier gate required a treasury view secret in public validator source.
// The current mainnet candidate instead uses a public, height-bound DLEQ proof.
const verifyProof = treasuryProof.slice(
  treasuryProof.indexOf('inline bool verify_crylo_mainnet_treasury_proof(')
);
check(
  'Mainnet Gas Treasury public recipient proof is wired into consensus (source-only)',
  treasuryProof.includes('inline bool verify_crylo_mainnet_treasury_proof(') &&
  miner.includes('!add_crylo_mainnet_treasury_proof(') &&
  blockchain.includes('!verify_crylo_mainnet_treasury_proof(') &&
  blockchain.includes('generation->height') &&
  blockchain.includes('CryLo_GAS_TREASURY_VIEWKEY') &&
  blockchain.includes('CryLo_GAS_TREASURY_SPENDKEY') &&
  blockchain.includes('Gas Treasury output key MISMATCH or invalid proof') &&
  verifyProof.includes('crypto::check_tx_proof(') &&
  verifyProof.includes('crylo_treasury_proof_message(without_proof, height)') &&
  verifyProof.includes('if (count != 1)') &&
  verifyProof.includes('tx.extra[proof_start] != TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF') &&
  verifyProof.includes('crypto::derive_public_key(') &&
  verifyProof.includes('expected_output != actual_output') &&
  verifyProof.includes('get_output_view_tag(tx.vout[treasury_index])') &&
  !treasuryProof.includes('CryLo_GAS_TREASURY_VIEWKEY_SECRET') &&
  !blockchain.includes('CryLo_GAS_TREASURY_VIEWKEY_SECRET'),
  'Independently review DLEQ proof, run native malformed-proof/recipient/height/replay tests and verify testnet history before mainnet release'
);
const liquidityVerify = liquidityProof.slice(
  liquidityProof.indexOf('inline bool verify_crylo_mainnet_liquidity_proof(')
);
check(
  'Mainnet Liquidity public recipient proof is wired into consensus (source-only)',
  liquidityProof.includes('inline bool verify_crylo_mainnet_liquidity_proof(') &&
  liquidityProof.includes('crylo_liquidity_proof_message(') &&
  liquidityProof.includes('LiquidityCoinbase:DLEQ:v1') &&
  miner.includes('!add_crylo_mainnet_liquidity_proof(') &&
  blockchain.includes('!verify_crylo_mainnet_liquidity_proof(') &&
  blockchain.includes('CryLo_LIQUIDITY_FUND_VIEWKEY') &&
  blockchain.includes('CryLo_LIQUIDITY_FUND_SPENDKEY') &&
  blockchain.includes('liquidity_view_pkey, liquidity_spend_pkey, 3') &&
  blockchain.includes('gas_treasury_view_pkey, gas_treasury_spend_pkey, 4') &&
  txExtra.includes('TX_EXTRA_TAG_CRYLO_LIQUIDITY_PROOF') &&
  txExtra.includes('tx_extra_crylo_liquidity_proof') &&
  txExtraParser.includes('pick<tx_extra_crylo_liquidity_proof>') &&
  liquidityVerify.includes('liquidity_count != 1 || gas_count != 1') &&
  liquidityVerify.includes('tx.extra[proof_start] != TX_EXTRA_TAG_CRYLO_LIQUIDITY_PROOF') &&
  liquidityVerify.includes('tx.extra[gas_start] != TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF') &&
  liquidityVerify.includes('crypto::check_tx_proof(') &&
  liquidityVerify.includes('crylo_liquidity_proof_message(without_proof, height)') &&
  liquidityVerify.includes('crypto::derive_public_key(') &&
  liquidityVerify.includes('expected_output != actual_output') &&
  liquidityVerify.includes('get_output_view_tag(tx.vout[liquidity_index])') &&
  !liquidityProof.includes('CryLo_LIQUIDITY_FUND_VIEWKEY_SECRET'),
  'Independently verify Liquidity DLEQ cryptographic soundness and canonical two-proof suffix in actual mainnet block consensus'
);

// 75/25/50 economics are owner-approved. Static wiring for BOTH recipient
// proofs is necessary but insufficient for native full-block, historical
// chain replay, cross-platform consensus and independent cryptographic audit.
// This unconditional release hold must only be removed via reviewed approval.
check(
  'Mainnet dual-recipient native consensus and replay evidence',
  false,
  'Execute native dual-proof adversarial and full-block tests, testnet history replay, independent review and five-platform consensus checks before any signed mainnet release'
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
