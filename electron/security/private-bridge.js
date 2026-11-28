'use strict';

const { ethers } = require('ethers');

// Exact CryLo-Nexus Private V3 commitment encoding. The L1 destination and
// 256-bit salt remain off-chain; only the commitment is burned on Nexus.
function privateReleaseCommitment({
  chainId, bridgeManager, burnId, nexusAddress,
  amountAtomic, cryloAddress, salt
}) {
  if (!ethers.isHexString(burnId,32) || burnId === ethers.ZeroHash ||
      !ethers.isHexString(salt,32) || salt === ethers.ZeroHash ||
      !ethers.isAddress(bridgeManager) || !ethers.isAddress(nexusAddress) ||
      typeof cryloAddress !== 'string' || !cryloAddress.length ||
      Buffer.byteLength(cryloAddress,'utf8') > 128 ||
      !/^[1-9][0-9]*$/.test(String(amountAtomic))) {
    throw new Error('Invalid private bridge release intent');
  }
  const id=BigInt(chainId);
  if (id <= 0n) throw new Error('Invalid private bridge chain ID');
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['string','uint256','address','bytes32','address','uint256','bytes32','bytes32'],
    ['CryLoPrivateRelease:v1',id,ethers.getAddress(bridgeManager),
      burnId.toLowerCase(),ethers.getAddress(nexusAddress),BigInt(amountAtomic),
      ethers.keccak256(ethers.toUtf8Bytes(cryloAddress)),salt.toLowerCase()]
  ));
}

function requireBridgeApiUrl(url) {
  if (typeof url !== 'string' || !url.trim() ||
      url.trim() !== url) throw new Error('Bridge API URL is not configured');
  const parsed=new URL(url);
  const loopback=['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
  if (!((parsed.protocol === 'https:' && !loopback) ||
        (parsed.protocol === 'http:' && loopback)) ||
      parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error('Bridge API requires remote HTTPS or local loopback HTTP');
  }
  return parsed.href.replace(/\/$/,'');
}

module.exports={ privateReleaseCommitment, requireBridgeApiUrl };
