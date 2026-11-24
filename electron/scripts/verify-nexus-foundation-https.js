'use strict';

// Operator-only, read-only HTTPS preflight. Does not start or modify a service.
// Usage: node electron/scripts/verify-nexus-foundation-https.js https://HOST/PREFIX
// Do not paste credentials, wallet addresses or tokens into this command.
const config = require('../security/nexus-foundation-endpoints.json');
const { verifyPublicFoundationEndpoint } =
  require('../security/nexus-foundation-public-proof');

async function main() {
  if (process.argv.length !== 3) {
    throw new Error(
      'Supply one approved HTTPS Foundation API base URL. No DNS guesses or fallback are allowed.'
    );
  }
  const proof = await verifyPublicFoundationEndpoint(process.argv[2], config);
  console.log('===== NEXUS TESTNET HTTPS FOUNDATION PROOF =====');
  console.log('Foundation origin....... ' + proof.foundationOrigin);
  console.log('RPC origin.............. ' + proof.rpcOrigin);
  console.log('CryLo L1 network........ ' + proof.cryloL1Network);
  console.log('Nexus chain ID.......... ' + proof.chainId);
  console.log('Blockchain ID........... ' + proof.blockchainId);
  console.log('Required contracts...... ' + proof.contractsChecked);
  console.log('Private status gate..... VERIFIED (unauthorized denied)');
  console.log('Read-only verification.. PASS');
  console.log('NOTE: API/RPC connectivity is not a custody or live bridge E2E proof.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('READ-ONLY PRECHECK FAILED: ' + String(error?.message || error));
    process.exitCode = 1;
  });
}
