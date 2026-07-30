#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/CryLo"

STAMP="$(date +%Y%m%d-%H%M%S)"

cp electron/main.js \
  "electron/main.js.operator-gating-$STAMP.bak"

cp electron/src/app.js \
  "electron/src/app.js.operator-gating-$STAMP.bak"

python3 <<'PY'
from pathlib import Path

main_path = Path("electron/main.js")
app_path = Path("electron/src/app.js")

main = main_path.read_text()
app = app_path.read_text()

# Require the operator service to be actively running before
# Electron can issue or renew an authorization.
old_main = """      if (!service.installed) {
        throw new Error(
          'The CryLoNexus operator service is not installed'
        );
      }

      const runtime ="""

new_main = """      if (!service.installed) {
        throw new Error(
          'Install the CryLoNexus operator service before authorizing this node'
        );
      }

      const serviceRunning =
        service.active === true ||
        service.running === true ||
        service.status === 'active' ||
        service.state === 'active' ||
        service.activeState === 'active';

      if (!serviceRunning) {
        throw new Error(
          'Start the CryLoNexus operator service before authorizing this node'
        );
      }

      const runtime ="""

if old_main not in main:
    raise SystemExit(
        "Main-process service-gating anchor was not found"
    )

main = main.replace(old_main, new_main, 1)

# Show the panel only when:
# - the wallet is registered as an Operator/Validator; and
# - the operator service is installed and actively running.
old_app = """    setNexusNodeDashboardVisible(
      'nexus-operator-authorization-panel',
      registered
    );"""

new_app = """    const operatorServiceRunning =
      result.service?.installed === true &&
      (
        result.service?.active === true ||
        result.service?.running === true ||
        result.service?.status === 'active' ||
        result.service?.state === 'active' ||
        result.service?.activeState === 'active'
      );

    setNexusNodeDashboardVisible(
      'nexus-operator-authorization-panel',
      registered && operatorServiceRunning
    );"""

if old_app not in app:
    raise SystemExit(
        "Renderer authorization visibility anchor was not found"
    )

app = app.replace(old_app, new_app, 1)

main_path.write_text(main)
app_path.write_text(app)

print("Operator authorization service gating corrected.")
PY

echo
echo '===== SYNTAX CHECKS ====='
node --check electron/main.js
node --check electron/src/app.js

echo
echo '===== CORRECTED GATING ====='
grep -n \
  "serviceRunning\|operatorServiceRunning\|Start the CryLoNexus operator service" \
  electron/main.js \
  electron/src/app.js

echo
echo "Correction complete."
echo "Backup suffix: operator-gating-$STAMP.bak"
