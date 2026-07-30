#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/CryLo"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILES=(
  electron/main.js
  electron/preload.js
  electron/src/index.html
  electron/src/app.js
)

for file in "${FILES[@]}"; do
  test -f "$file" || {
    echo "Missing required file: $file"
    exit 1
  }

  cp "$file" "$file.operator-auth-$STAMP.bak"
done

python3 <<'PY'
from pathlib import Path
import re

MAIN = Path("electron/main.js")
PRELOAD = Path("electron/preload.js")
HTML = Path("electron/src/index.html")
APP = Path("electron/src/app.js")

main = MAIN.read_text()
preload = PRELOAD.read_text()
html = HTML.read_text()
app = APP.read_text()

FEATURE_MARKER = "CRYLONEXUS_OPERATOR_AUTHORIZATION_V1"

if FEATURE_MARKER in main:
    raise SystemExit(
        "Operator authorization is already present in electron/main.js"
    )

# ---------------------------------------------------------------------------
# electron/main.js: add authorization path
# ---------------------------------------------------------------------------

old_paths = """    config: path.join(operatorDir, 'operator.json'),
    statusCandidates: ["""

new_paths = """    config: path.join(operatorDir, 'operator.json'),
    authorization: path.join(
      operatorDir,
      'authorization.json'
    ),
    statusCandidates: ["""

if old_paths not in main:
    raise SystemExit(
        "Could not find getOperatorPaths() insertion anchor"
    )

main = main.replace(old_paths, new_paths, 1)

# ---------------------------------------------------------------------------
# Main-process authorization helpers and IPC
# ---------------------------------------------------------------------------

dashboard_anchor = (
    "ipcMain.handle('nexus-operator-dashboard', "
    "async (_, linkedAddress) => {"
)

if dashboard_anchor not in main:
    raise SystemExit(
        "Could not find nexus-operator-dashboard handler"
    )

authorization_code = r"""
// CRYLONEXUS_OPERATOR_AUTHORIZATION_V1
const OPERATOR_AUTHORIZATION_LIFETIME_MS =
  72 * 60 * 60 * 1000;

function writePrivateJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700
  });

  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'w'
    }
  );

  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readOperatorAuthorization(filePath, expectedAddress) {
  const result = readJsonFileSafe(filePath);

  if (!result.exists) {
    return {
      exists: false,
      valid: false,
      expired: false,
      status: 'Not Authorized',
      expiresAt: null,
      remainingSeconds: 0,
      sessionAddress: null,
      error: null
    };
  }

  if (!result.data) {
    return {
      exists: true,
      valid: false,
      expired: false,
      status: 'Invalid Authorization',
      expiresAt: null,
      remainingSeconds: 0,
      sessionAddress: null,
      error: result.error || 'Authorization file is invalid'
    };
  }

  const authorization = result.data;
  const expiresMs =
    Date.parse(authorization.delegation?.expiresAt || '');

  const addressMatches =
    ethers.isAddress(expectedAddress) &&
    ethers.isAddress(
      authorization.delegation?.operatorAddress
    ) &&
    ethers.getAddress(
      authorization.delegation.operatorAddress
    ) === ethers.getAddress(expectedAddress);

  const validExpiration =
    Number.isFinite(expiresMs);

  const remainingSeconds =
    validExpiration
      ? Math.max(
          0,
          Math.floor((expiresMs - Date.now()) / 1000)
        )
      : 0;

  const expired =
    validExpiration && remainingSeconds === 0;

  const structurallyValid =
    authorization.version === 1 &&
    authorization.delegation?.purpose ===
      'operator-heartbeat' &&
    authorization.delegation?.chainId === 5546 &&
    ethers.isAddress(
      authorization.delegation?.sessionAddress
    ) &&
    typeof authorization.sessionPrivateKey ===
      'string' &&
    typeof authorization.delegationSignature ===
      'string';

  const valid =
    structurallyValid &&
    addressMatches &&
    validExpiration &&
    !expired;

  return {
    exists: true,
    valid,
    expired,
    status: valid
      ? 'Authorized'
      : expired
        ? 'Authorization Expired'
        : 'Invalid Authorization',
    issuedAt:
      authorization.delegation?.issuedAt || null,
    expiresAt:
      authorization.delegation?.expiresAt || null,
    remainingSeconds,
    sessionAddress:
      authorization.delegation?.sessionAddress ||
      null,
    sessionId:
      authorization.delegation?.sessionId || null,
    error:
      valid || expired
        ? null
        : 'Authorization does not match this registered operator'
  };
}

ipcMain.handle(
  'nexus-authorize-operator',
  async (_, walletName, cryloAddress) => {
    try {
      const paths = getOperatorPaths();
      const configResult =
        readJsonFileSafe(paths.config);

      if (!configResult.data) {
        throw new Error(
          'Install and configure the node operator service first'
        );
      }

      const service =
        await readOperatorServiceStatus();

      if (!service.installed) {
        throw new Error(
          'The CryLoNexus operator service is not installed'
        );
      }

      const runtime =
        await getNexusRuntimeConfig();

      const wallet =
        loadBoundNexusWallet(
          walletName,
          cryloAddress
        ).connect(runtime.provider);

      const configuredAddress =
        configResult.data.operatorAddress;

      if (
        !ethers.isAddress(configuredAddress) ||
        ethers.getAddress(configuredAddress) !==
          ethers.getAddress(wallet.address)
      ) {
        throw new Error(
          'The operator configuration does not match the bound Nexus wallet'
        );
      }

      const nodeStakingAddress =
        ethers.isAddress(
          configResult.data.nodeStakingContract
        )
          ? ethers.getAddress(
              configResult.data.nodeStakingContract
            )
          : runtime.contracts.NodeStaking;

      const nodeArtifact =
        require('./src/abis/CryLoNodeStaking.json');

      const node =
        new ethers.Contract(
          nodeStakingAddress,
          nodeArtifact.abi,
          runtime.provider
        );

      const [
        tier,
        network
      ] = await Promise.all([
        node.nodeTier(wallet.address),
        runtime.provider.getNetwork()
      ]);

      const tierText = tier.toString();

      if (
        tierText !== '1' &&
        tierText !== '2'
      ) {
        throw new Error(
          'Only registered Operators and Validators can authorize a node'
        );
      }

      if (network.chainId !== 5546n) {
        throw new Error(
          `Unexpected CryLoNexus chain ID: ${network.chainId}`
        );
      }

      const nodeId =
        configResult.data.nodeIdentity?.publicId ||
        `operator-${wallet.address.slice(2)}`;

      const confirmation =
        await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [
            'Authorize Node',
            'Cancel'
          ],
          defaultId: 0,
          cancelId: 1,
          title: 'Authorize CryLoNexus Node',
          message:
            'Authorize this registered node for 72 hours?',
          detail:
            'Electron will create a temporary session key. ' +
            'Your bound Nexus wallet private key remains inside Electron ' +
            'and is not stored in the operator service.'
        });

      if (confirmation.response !== 0) {
        return {
          ok: false,
          cancelled: true,
          error: 'Authorization cancelled'
        };
      }

      const sessionWallet =
        ethers.Wallet.createRandom();

      const issuedAt =
        new Date().toISOString();

      const expiresAt =
        new Date(
          Date.now() +
          OPERATOR_AUTHORIZATION_LIFETIME_MS
        ).toISOString();

      const delegation = {
        version: 1,
        purpose: 'operator-heartbeat',
        chainId: 5546,
        operatorAddress:
          ethers.getAddress(wallet.address),
        nodeId,
        sessionAddress:
          ethers.getAddress(
            sessionWallet.address
          ),
        issuedAt,
        expiresAt,
        sessionId:
          ethers.hexlify(
            ethers.randomBytes(32)
          ),
        nonce:
          ethers.hexlify(
            ethers.randomBytes(32)
          )
      };

      /*
       * JSON insertion order is intentionally fixed.
       * The runtime verifier will use the same canonical field order.
       */
      const delegationMessage =
        JSON.stringify(delegation);

      const delegationSignature =
        await wallet.signMessage(
          delegationMessage
        );

      const recoveredAddress =
        ethers.verifyMessage(
          delegationMessage,
          delegationSignature
        );

      if (
        ethers.getAddress(recoveredAddress) !==
        ethers.getAddress(wallet.address)
      ) {
        throw new Error(
          'Delegation signature self-verification failed'
        );
      }

      const authorization = {
        version: 1,
        delegation,
        delegationSignature,
        sessionPrivateKey:
          sessionWallet.privateKey,
        createdBy: 'CryLo Electron',
        createdAt: issuedAt
      };

      writePrivateJsonAtomic(
        paths.authorization,
        authorization
      );

      return {
        ok: true,
        status: 'Authorized',
        operatorAddress:
          delegation.operatorAddress,
        sessionAddress:
          delegation.sessionAddress,
        issuedAt,
        expiresAt,
        remainingSeconds:
          Math.floor(
            OPERATOR_AUTHORIZATION_LIFETIME_MS /
            1000
          ),
        authorizationPath:
          paths.authorization
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.shortMessage ||
          error.reason ||
          error.message
      };
    }
  }
);

"""

main = main.replace(
    dashboard_anchor,
    authorization_code + dashboard_anchor,
    1
)

# ---------------------------------------------------------------------------
# Add authorization state to dashboard response
# ---------------------------------------------------------------------------

dashboard_setup_old = """  const service = await readOperatorServiceStatus();

  const now = Date.now();"""

dashboard_setup_new = """  const service = await readOperatorServiceStatus();

  const authorization =
    readOperatorAuthorization(
      paths.authorization,
      linkedAddress
    );

  const now = Date.now();"""

if dashboard_setup_old not in main:
    raise SystemExit(
        "Could not find dashboard setup anchor"
    )

main = main.replace(
    dashboard_setup_old,
    dashboard_setup_new,
    1
)

response_anchor = """    service,

    runtime: {"""

response_replacement = """    service,

    authorization: {
      ...authorization,
      available:
        response?.registration?.registered === true
    },

    runtime: {"""

# Avoid referencing response before initialization.
response_replacement = """    service,

    authorization,

    runtime: {"""

if response_anchor not in main:
    raise SystemExit(
        "Could not find dashboard response authorization anchor"
    )

main = main.replace(
    response_anchor,
    response_replacement,
    1
)

MAIN.write_text(main)

# ---------------------------------------------------------------------------
# electron/preload.js
# ---------------------------------------------------------------------------

preload_anchor = """  nexusOperatorDashboard: (linkedAddress) =>
    ipcRenderer.invoke('nexus-operator-dashboard', linkedAddress),
"""

preload_replacement = """  nexusOperatorDashboard: (linkedAddress) =>
    ipcRenderer.invoke('nexus-operator-dashboard', linkedAddress),

  nexusAuthorizeOperator: (walletName, cryloAddress) =>
    ipcRenderer.invoke(
      'nexus-authorize-operator',
      walletName,
      cryloAddress
    ),
"""

if preload_anchor not in preload:
    raise SystemExit(
        "Could not find preload operator dashboard anchor"
    )

preload = preload.replace(
    preload_anchor,
    preload_replacement,
    1
)

PRELOAD.write_text(preload)

# ---------------------------------------------------------------------------
# electron/src/index.html
# ---------------------------------------------------------------------------

actions_anchor = """              <div class="node-center-actions">
                <button
                  id="nexus-register-operator-btn"
"""

authorization_html = """              <div
                id="nexus-operator-authorization-panel"
                class="node-center-card hidden"
              >
                <div class="node-center-card-header">
                  <div>
                    <div class="node-center-label">
                      Operator Authorization
                    </div>
                    <strong id="nexus-operator-authorization-status">
                      Not Authorized
                    </strong>
                  </div>
                </div>

                <div class="node-center-detail-grid">
                  <div>
                    <span>Expires</span>
                    <strong id="nexus-operator-authorization-expires">
                      —
                    </strong>
                  </div>

                  <div>
                    <span>Time Remaining</span>
                    <strong id="nexus-operator-authorization-remaining">
                      —
                    </strong>
                  </div>
                </div>

                <button
                  id="nexus-authorize-operator-btn"
                  class="btn btn-primary"
                  type="button"
                  onclick="App.authorizeNexusOperator()"
                >
                  Authorize Node for 72 Hours
                </button>
              </div>

              <div class="node-center-actions">
                <button
                  id="nexus-register-operator-btn"
"""

if actions_anchor not in html:
    raise SystemExit(
        "Could not find Node Center actions anchor"
    )

html = html.replace(
    actions_anchor,
    authorization_html,
    1
)

HTML.write_text(html)

# ---------------------------------------------------------------------------
# electron/src/app.js
# Determine the exact wallet arguments already used by registration.
# ---------------------------------------------------------------------------

register_match = re.search(
    r"async function registerNexusOperator\(\)\s*\{"
    r"(?P<body>.*?)"
    r"\n\}",
    app,
    re.S
)

if not register_match:
    raise SystemExit(
        "Could not locate registerNexusOperator()"
    )

register_body = register_match.group("body")

call_match = re.search(
    r"\.nexusRegisterOperator\s*\(\s*(?P<args>.*?)\s*\)",
    register_body,
    re.S
)

if not call_match:
    raise SystemExit(
        "Could not determine existing wallet arguments "
        "from nexusRegisterOperator()"
    )

wallet_args = call_match.group("args").strip()

authorization_function = f"""
async function authorizeNexusOperator() {{
  try {{
    const button =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (button) {{
      button.disabled = true;
      button.textContent = 'Authorizing...';
    }}

    const result =
      await window.crylo
        .nexusAuthorizeOperator(
          {wallet_args}
        );

    if (!result?.ok) {{
      if (!result?.cancelled) {{
        alert(
          result?.error ||
          'Unable to authorize this node'
        );
      }}

      return;
    }}

    alert(
      'Node authorized for 72 hours.\\n\\n' +
      `Expires: ${{new Date(
        result.expiresAt
      ).toLocaleString()}}`
    );

    await refreshNexusOperatorDashboard();
  }} catch (error) {{
    console.error(
      'Operator authorization failed:',
      error
    );

    alert(
      error?.message ||
      'Unable to authorize this node'
    );
  }} finally {{
    const button =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (button) {{
      button.disabled = false;
      button.textContent =
        'Authorize Node for 72 Hours';
    }}
  }}
}}

"""

function_anchor = (
    "async function registerNexusOperator() {"
)

if function_anchor not in app:
    raise SystemExit(
        "Could not find renderer function insertion anchor"
    )

app = app.replace(
    function_anchor,
    authorization_function + function_anchor,
    1
)

# Add dashboard rendering immediately after registration visibility.
visibility_anchor = """    setNexusNodeDashboardVisible(
      'nexus-unregister-node-btn',
      registered
    );

    const configuration ="""

authorization_render = """    setNexusNodeDashboardVisible(
      'nexus-unregister-node-btn',
      registered
    );

    const authorization =
      result.authorization || {};

    setNexusNodeDashboardVisible(
      'nexus-operator-authorization-panel',
      registered
    );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-status',
      authorization.status ||
        'Not Authorized'
    );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-expires',
      authorization.expiresAt
        ? new Date(
            authorization.expiresAt
          ).toLocaleString()
        : '—'
    );

    const remainingSeconds =
      Number(
        authorization.remainingSeconds || 0
      );

    const remainingHours =
      Math.floor(
        remainingSeconds / 3600
      );

    const remainingMinutes =
      Math.floor(
        (remainingSeconds % 3600) / 60
      );

    setNexusNodeDashboardText(
      'nexus-operator-authorization-remaining',
      authorization.valid
        ? `${remainingHours}h ${remainingMinutes}m`
        : authorization.expired
          ? 'Expired'
          : '—'
    );

    const authorizationButton =
      document.getElementById(
        'nexus-authorize-operator-btn'
      );

    if (authorizationButton) {
      authorizationButton.textContent =
        authorization.valid
          ? 'Renew 72-Hour Authorization'
          : 'Authorize Node for 72 Hours';
    }

    const configuration ="""

if visibility_anchor not in app:
    raise SystemExit(
        "Could not find dashboard authorization-render anchor"
    )

app = app.replace(
    visibility_anchor,
    authorization_render,
    1
)

# Export through window.App.
app_export_anchor = """window.App = {
"""

if app_export_anchor not in app:
    raise SystemExit(
        "Could not find window.App export"
    )

app = app.replace(
    app_export_anchor,
    """window.App = {
  authorizeNexusOperator,
""",
    1
)

APP.write_text(app)

print("Operator authorization phase 1 patch applied.")
PY

echo
echo '===== JAVASCRIPT SYNTAX CHECKS ====='
node --check electron/main.js
node --check electron/preload.js
node --check electron/src/app.js

echo
echo '===== FEATURE ANCHORS ====='
grep -n \
  "CRYLONEXUS_OPERATOR_AUTHORIZATION_V1\|nexus-authorize-operator\|authorizeNexusOperator\|nexus-operator-authorization-panel" \
  electron/main.js \
  electron/preload.js \
  electron/src/app.js \
  electron/src/index.html

echo
echo "Phase 1 patch complete."
echo "Backups use suffix: operator-auth-$STAMP.bak"
echo
echo "Do not enable CRYLONEXUS_LOCAL_HEARTBEATS yet."
