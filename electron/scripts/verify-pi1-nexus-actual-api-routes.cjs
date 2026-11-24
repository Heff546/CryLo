'use strict';

// Pi1-only route-level integration: execute the exact Foundation bridge API
// route handlers from an explicitly supplied pinned Nexus server.ts source.
// A temporary localhost HTTP adapter and fake make_integrated_address RPC
// substitute for Express and the *real* L1 wallet-RPC. No user keys, remote
// servers, real deposits, production manifests, or blockchain transactions.
// This is not a full production Express/middleware or EVM integration test.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { readFileSync, mkdtempSync, rmSync, mkdirSync, chmodSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const vm = require('node:vm');

const ROOT = process.env.CRYLO_NEXUS_LOCAL_SOURCE;
const API_SOURCE = process.env.CRYLO_NEXUS_PINNED_API_SOURCE;
const SECURITY = process.env.CRYLO_ELECTRON_SECURITY_DIR;
const NETWORK_ID = 'EPA2TKpkcmYRdaa4QKMYdFHkjzy5SWuGHEiBwznNspdTqexrQ';

function selectedSource(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'API route not found: ' + from);
  return source.slice(start, end)
    // Compile only the explicitly selected route callback in memory; this
    // narrow annotation is the only TS syntax present in these handlers.
    .replaceAll('catch (err: any)', 'catch (err)');
}

test('actual Foundation request/status/config routes interoperable with Electron on Pi1', async t => {
  for (const [key, value] of Object.entries({
    CRYLO_NEXUS_LOCAL_SOURCE: ROOT,
    CRYLO_NEXUS_PINNED_API_SOURCE: API_SOURCE,
    CRYLO_ELECTRON_SECURITY_DIR: SECURITY
  })) {
    assert.ok(typeof value === 'string' && path.isAbsolute(value), key + ' must be absolute');
  }

  const serverSource = readFileSync(API_SOURCE, 'utf8');
  const manifest = JSON.parse(readFileSync(
    path.join(ROOT, 'state/v2-testnet/manifest.json'), 'utf8'
  ));
  assert.equal(manifest.chainId, 5546);
  assert.equal(manifest.blockchainId, NETWORK_ID);
  const Sqlite = require(path.join(ROOT, 'node_modules/better-sqlite3'));
  const nexus = await import(pathToFileURL(
    path.join(ROOT, 'bridge-api/bridge-status-privacy.js')
  ).href);
  const electronStorePath = path.join(SECURITY, 'bridge-status-store.js');
  const electronStore = require(electronStorePath);
  const { nexusApiUrl } = require(path.join(SECURITY, 'nexus-endpoint-policy.js'));

  const temp = mkdtempSync(path.join(tmpdir(), 'crylo-foundation-routes-'));
  let db;
  let httpServer;
  t.after(async () => {
    if (httpServer?.listening) {
      await new Promise((resolve, reject) =>
        httpServer.close(err => err ? reject(err) : resolve()));
    }
    if (db?.open) db.close();
    rmSync(temp, {recursive: true, force: true});
  });
  const databaseFile = path.join(temp, 'bridge.sqlite');
  const walletData = path.join(temp, 'wallet-data');
  mkdirSync(walletData, {mode: 0o700});
  db = new Sqlite(databaseFile);
  chmodSync(databaseFile, 0o600);
  db.exec([
    'CREATE TABLE bridge_requests (',
    ' payment_id TEXT UNIQUE NOT NULL,',
    ' integrated_address TEXT NOT NULL,',
    ' reserve_address TEXT NOT NULL,',
    ' nexus_address TEXT NOT NULL,',
    ' crylo_address TEXT NOT NULL,',
    ' amount_atomic TEXT NOT NULL,',
    ' status TEXT NOT NULL,',
    ' created_at TEXT NOT NULL,',
    ' updated_at TEXT NOT NULL,',
    ' status_token_hash TEXT',
    ')'
  ].join(''));
  nexus.initializeBridgeStatusPrivacy(db);

  const routes = new Map();
  const calls = [];
  const address = 'CryLo-local-reserve-fake-' + 'a'.repeat(65);
  const sandbox = vm.createContext({
    db, manifest, cryloL1Network: 'testnet',
    reserveAddress: address,
    crypto,
    createBridgeStatusToken: nexus.createBridgeStatusToken,
    hashBridgeStatusToken: nexus.hashBridgeStatusToken,
    authorizePrivateStatus: nexus.authorizePrivateStatus,
    walletRpc: async (method, params) => {
      assert.equal(method, 'make_integrated_address');
      assert.equal(params.standard_address, address);
      assert.match(params.payment_id, /^[0-9a-f]{16}$/);
      calls.push(method);
      return { integrated_address: 'CRYLO-FAKE-INTEGRATED-' + 'b'.repeat(80) };
    },
    app: {
      get(route, handler) { routes.set('GET ' + route, handler); },
      post(route, handler) { routes.set('POST ' + route, handler); }
    }
  });

  const segments = [
    selectedSource(serverSource,
      'app.get("/nexus/bridge-config"', 'app.get("/health"'),
    selectedSource(serverSource,
      'app.get("/health"', 'app.post("/nexus/onboarding-challenge"'),
    selectedSource(serverSource,
      'app.post("/bridge/request"', '// Payment IDs and L1 transaction hashes'),
    selectedSource(serverSource,
      'app.post("/bridge/status"', '\nconst port =')
  ];
  for (const segment of segments) {
    vm.runInContext(segment, sandbox, {timeout: 2000});
  }
  assert.equal(routes.size, 4, 'All four exact Foundation source routes must register');

  httpServer = createServer(async (req, res) => {
    const handler = routes.get(req.method + ' ' + req.url);
    if (!handler) {
      res.writeHead(404);
      return res.end('Not found');
    }
    try {
      let body = '';
      if (req.method === 'POST') {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) throw Error('Oversized mock input');
        }
      }
      const payload = body ? JSON.parse(body) : {};
      let responseStatus = 200;
      const mockResponse = {
        status(code) { responseStatus = code; return this; },
        json(data) {
          res.writeHead(responseStatus, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          });
          res.end(JSON.stringify(data));
          return this;
        }
      };
      await handler({
        body: payload,
        get(name) {return req.headers[String(name).toLowerCase()];}
      }, mockResponse);
    } catch {
      res.writeHead(400);
      res.end('Invalid local test request');
    }
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + httpServer.address().port;
  const post = (route, body, token) => fetch(nexusApiUrl(base, route), {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {'X-Bridge-Status-Token': token} : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });

  const configResponse = await fetch(nexusApiUrl(base, '/nexus/bridge-config'));
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.chainId, 5546);
  assert.equal(config.blockchainId, NETWORK_ID);
  assert.equal(config.cryloL1Network, 'testnet');
  console.log('Actual Foundation /nexus/bridge-config identity: PASS');

  const health = await fetch(nexusApiUrl(base, '/health'));
  assert.deepEqual(await health.json(), {ok: true});
  console.log('Actual Foundation /health handler: PASS');

  const requestBody = {
    nexusAddress: '0x' + 'c'.repeat(40),
    cryloAddress: 'CryLo-TEST-SENDER-FAKE-' + 'd'.repeat(65),
    amountAtomic: '100000000000'
  };
  const issueResponse = await post('/bridge/request', requestBody);
  assert.equal(issueResponse.status, 200);
  const issued = await issueResponse.json();
  assert.match(issued.paymentId, /^[0-9a-f]{16}$/);
  assert.match(issued.statusToken, /^[0-9a-f]{64}$/);
  assert.equal(issued.amountAtomic, '100000000000');
  assert.deepEqual(calls, ['make_integrated_address']);
  console.log('Actual Foundation deposit request + fake wallet-RPC: PASS');

  const invalidInput = await post('/bridge/request', {
    ...requestBody, amountAtomic: '-1'
  });
  assert.equal(invalidInput.status, 400);
  assert.deepEqual(calls, ['make_integrated_address']);
  console.log('Input rejected before mock wallet-RPC: PASS');

  electronStore.saveBridgeStatusCapability(walletData, issued.paymentId, issued.statusToken);
  const {statusToken: _private, ...safe} = issued;
  assert.equal(Object.hasOwn(safe, 'statusToken'), false);

  const denied = await post('/bridge/status', {paymentId: issued.paymentId});
  assert.equal(denied.status, 404);
  const wrong = await post('/bridge/status', {paymentId: issued.paymentId}, 'f'.repeat(64));
  assert.equal(wrong.status, 404);
  const success = await post('/bridge/status',
    {paymentId: issued.paymentId},
    electronStore.getBridgeStatusCapability(walletData, issued.paymentId));
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {ok: true, status: 'created'});
  console.log('Actual Foundation private status authorization: PASS');

  db.prepare("UPDATE bridge_requests SET status='minted' WHERE payment_id=?")
    .run(issued.paymentId);
  db.close();
  db = new Sqlite(databaseFile, {fileMustExist: true});
  sandbox.db = db;
  delete require.cache[require.resolve(electronStorePath)];
  const restored = require(electronStorePath);
  const savedToken = restored.getBridgeStatusCapability(walletData, issued.paymentId);
  assert.equal(savedToken, issued.statusToken);
  const minted = await post('/bridge/status', {paymentId: issued.paymentId}, savedToken);
  assert.equal(minted.status, 200);
  assert.deepEqual(await minted.json(), {ok: true, status: 'minted'});
  console.log('Actual Foundation status after SQLite/Electron reopen: PASS');

  const legacy = await fetch(base + '/bridge/status/' + issued.paymentId);
  assert.equal(legacy.status, 404);
  if (process.platform !== 'win32') {
    assert.equal(statSync(path.join(walletData, 'bridge-private')).mode & 0o077, 0);
    assert.equal(statSync(path.join(walletData, 'bridge-private/status-capabilities.json')).mode & 0o077, 0);
  }
  console.log('Legacy GET disabled + private capability owner-only: PASS');
  console.log('PI1 ACTUAL FOUNDATION ROUTES ↔ ELECTRON: PASS');
});
