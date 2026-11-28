'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const TOKEN=/^[a-f0-9]{64}$/i;
const PAYMENT=/^[a-f0-9]{16}$/i;
function statusFile(root) {
  if (!path.isAbsolute(root)) throw new Error('Absolute wallet user-data directory required');
  return path.join(root,'bridge-status-capabilities.json');
}
function readStatusCapabilities(root) {
  const file=statusFile(root);
  if (!fs.existsSync(file)) return {};
  const st=fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
    throw new Error('Insecure private bridge capability storage');
  }
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid bridge capability storage');
  }
  for (const [k,v] of Object.entries(data)) {
    if (!PAYMENT.test(k) || !TOKEN.test(v)) throw new Error('Corrupt bridge capability storage');
  }
  return data;
}
function rememberBridgeStatusCapability(root,paymentId,token) {
  if (!PAYMENT.test(paymentId||'') || !TOKEN.test(token||'')) {
    throw new Error('Invalid bridge status capability');
  }
  const existing=readStatusCapabilities(root);
  const key=paymentId.toLowerCase();
  if (existing[key] && existing[key]!==token.toLowerCase()) {
    throw new Error('Bridge status capability collision');
  }
  const file=statusFile(root);
  const nonce=crypto.randomBytes(12).toString('hex');
  const temp=path.join(root,'.bridge-status-'+nonce+'.tmp');
  const buf=Buffer.from(JSON.stringify({...existing,[key]:token.toLowerCase()})+'\n');
  const fd=fs.openSync(temp,'wx',0o600);
  try {
    fs.writeFileSync(fd,buf);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp,file); }
  finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
}
function bridgeStatusCapability(root,paymentId) {
  if (!PAYMENT.test(paymentId||'')) throw new Error('Invalid bridge payment ID');
  const token=readStatusCapabilities(root)[paymentId.toLowerCase()];
  if (!token) throw new Error('Private bridge status capability unavailable');
  return token;
}
module.exports={
  rememberBridgeStatusCapability,bridgeStatusCapability,readStatusCapabilities
};
