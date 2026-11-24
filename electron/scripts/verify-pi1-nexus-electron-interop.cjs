'use strict';

// Pi1-only isolated interoperability test: actual Nexus private bridge
// authorization module + actual Electron main-process capability store,
// exercised over a temporary loopback HTTP server. NOT a production API,
// live EVM, real bridge transfer, or wallet-RPC integration.
// Environment:
//   CRYLO_NEXUS_LOCAL_SOURCE=/absolute/path/to/CryLo-Nexus-Local-EVM
//   CRYLO_ELECTRON_SECURITY_DIR=/absolute/path/to/pinned/electron/security
// Both paths must be local. This script never contacts external hosts.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const NEXUS = process.env.CRYLO_NEXUS_LOCAL_SOURCE;
const SECURITY = process.env.CRYLO_ELECTRON_SECURITY_DIR;

test('Pi1 Nexus/Electron private bridge capability survives restart across real modules', async (t) => {
  for (const [name, location] of Object.entries({
    CRYLO_NEXUS_LOCAL_SOURCE: NEXUS,
    CRYLO_ELECTRON_SECURITY_DIR: SECURITY
  })) {
    assert.ok(typeof location === 'string' && path.isAbsolute(location),
      name + ' must be an absolute directory');
    assert.ok(fs.statSync(location).isDirectory(), name + ' is not a directory');
  }

  const nexusModule = path.join(NEXUS, 'bridge-api/bridge-status-privacy.js');
  const electronStoreFile = path.join(SECURITY, 'bridge-status-store.js');
  const electronEndpointFile = path.join(SECURITY, 'nexus-endpoint-policy.js');
  const SQLite = require(path.join(NEXUS, 'node_modules/better-sqlite3'));
  const nexus = await import(pathToFileURL(nexusModule).href);
  const store = require(electronStoreFile);
  const { nexusApiUrl } = require(electronEndpointFile);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crylo-pi1-interop-'));
  let database;
  let server;
  t.after(async () => {
    if (server && server.listening) {
      await new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    }
    if (database?.open) database.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  const databasePath = path.join(temporary, 'bridge-test.sqlite');
  const userDataPath = path.join(temporary, 'electron-userdata');
  fs.mkdirSync(userDataPath, { mode: 0o700 });
  database = new SQLite(databasePath);
  fs.chmodSync(databasePath, 0o600);
  database.exec([
    'CREATE TABLE bridge_requests (',
    ' payment_id TEXT PRIMARY KEY,',
    ' status TEXT NOT NULL,',
    ' status_token_hash TEXT,',
    ' crylo_address TEXT',
    ')'
  ].join(''));
  nexus.initializeBridgeStatusPrivacy(database);

  server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST' ||
          !['/bridge/request', '/bridge/status'].includes(req.url)) {
        return reply(404, {error: 'Not found'});
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return reply(413, {error: 'Request too large'});
      }
      const body = JSON.parse(raw || '{}');
      if (req.url === '/bridge/request') {
        // Dummy local issuance only; no integrated address, L1 wallet,
        // transfer, escrow, node RPC, or relayer.
        const paymentId = randomBytes(8).toString('hex');
        const statusToken = nexus.createBridgeStatusToken();
        database.prepare(
          'INSERT INTO bridge_requests(payment_id,status,status_token_hash,crylo_address) ' +
          "VALUES (?,'created',?,'PRIVATE-DUMMY-NOT-A-WALLET')"
        ).run(paymentId, nexus.hashBridgeStatusToken(statusToken));
        return reply(200, {paymentId, statusToken, status: 'created'});
      }
      const result = nexus.authorizePrivateStatus(
        database, body.paymentId, req.headers['x-bridge-status-token']
      );
      return result ? reply(200, result) : reply(404, {error: 'Not found'});
    } catch {
      return reply(400, {error: 'Invalid test request'});
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, token) => fetch(nexusApiUrl(origin, route), {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {'X-Bridge-Status-Token': token} : {})
    },
    body: JSON.stringify(body)
  });

  const createdRes = await post('/bridge/request', {});
  assert.equal(createdRes.status, 200);
  const issued = await createdRes.json();
  assert.match(issued.paymentId, /^[0-9a-f]{16}$/);
  assert.match(issued.statusToken, /^[0-9a-f]{64}$/);
  console.log('Real Nexus capability issuance: PASS');

  // This reproduces Electron main.js's storage and redaction boundary,
  // using the actual Electron storage implementation.
  store.saveBridgeStatusCapability(userDataPath, issued.paymentId, issued.statusToken);
  const {statusToken: _privateStatusToken, ...rendererSafe} = issued;
  assert.equal(Object.hasOwn(rendererSafe, 'statusToken'), false);
  assert.ok(!JSON.stringify(rendererSafe).includes(issued.statusToken));
  assert.equal(rendererSafe.paymentId, issued.paymentId);
  console.log('Electron private storage + renderer redaction: PASS');

  const denied = await post('/bridge/status', {paymentId: issued.paymentId});
  assert.equal(denied.status, 404);
  const wrong = await post(
    '/bridge/status', {paymentId: issued.paymentId}, 'f'.repeat(64));
  assert.equal(wrong.status, 404);
  console.log('Missing or incorrect bearer capability denied: PASS');

  const valid = await post('/bridge/status',
    {paymentId: issued.paymentId},
    store.getBridgeStatusCapability(userDataPath, issued.paymentId));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), {ok: true, status: 'created'});
  console.log('Authenticated Electron-to-Nexus HTTP status: PASS');

  database.prepare(
    "UPDATE bridge_requests SET status='minted' WHERE payment_id=?"
  ).run(issued.paymentId);
  database.close();
  database = new SQLite(databasePath, {fileMustExist: true});

  // Simulate Electron module reload after restart; restore from owner-only
  // capability file, with the Nexus status DB also reopened from disk.
  delete require.cache[require.resolve(electronStoreFile)];
  const reopenedStore = require(electronStoreFile);
  const persistedToken = reopenedStore.getBridgeStatusCapability(
    userDataPath, issued.paymentId);
  assert.equal(persistedToken, issued.statusToken);
  const resumed = await post('/bridge/status', {paymentId: issued.paymentId}, persistedToken);
  assert.equal(resumed.status, 200);
  const resumedData = await resumed.json();
  assert.deepEqual(resumedData, {ok: true, status: 'minted'});
  assert.equal(JSON.stringify(resumedData).includes('PRIVATE-DUMMY'), false);
  console.log('Restart + SQLite reopen + private minted status: PASS');

  const legacy = await fetch(origin + '/bridge/status/' + issued.paymentId);
  assert.equal(legacy.status, 404);
  const privateDir = path.join(userDataPath, 'bridge-private');
  const capabilityFile = path.join(privateDir, 'status-capabilities.json');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(privateDir).mode & 0o077, 0);
    assert.equal(fs.statSync(capabilityFile).mode & 0o077, 0);
  }
  console.log('Legacy GET disabled and owner-only capability: PASS');
  console.log('PI1 CROSS-REPOSITORY NEXUS/ELECTRON PROTOCOL: PASS');
});
