!macro customInstall
  ; ============================================================
  ; CryLo-managed Node.js runtime for the Windows Nexus Node Service.
  ;
  ; The authenticated Node.js archive is staged by before-pack.js and
  ; embedded only in the normal CryLo Windows installer. A valid existing
  ; managed runtime is preserved. System Node.js is never used.
  ; ============================================================

  ; Reject reparse points on the trusted CryLo runtime path before using it.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$paths=@('$LOCALAPPDATA\CryLo','$LOCALAPPDATA\CryLo\runtime','$LOCALAPPDATA\CryLo\runtime\node-v24.21.0-win-x64'); foreach ($$p in $$paths) { if (Test-Path -LiteralPath $$p) { $$i=Get-Item -LiteralPath $$p -Force; if (($$i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 } } }; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_paths_safe crylo_node_failed

crylo_node_paths_safe:
  CreateDirectory "$LOCALAPPDATA\CryLo"
  CreateDirectory "$LOCALAPPDATA\CryLo\runtime"

  ; Preserve an existing runtime only if the whole runtime tree is free of
  ; reparse points and node.exe matches the exact authenticated binary.
  IfFileExists "$LOCALAPPDATA\CryLo\runtime\node-v24.21.0-win-x64\node.exe" 0 crylo_node_install

  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$d='$LOCALAPPDATA\CryLo\runtime\node-v24.21.0-win-x64'; $$n=Join-Path $$d 'node.exe'; if (-not (Test-Path -LiteralPath $$d -PathType Container) -or -not (Test-Path -LiteralPath $$n -PathType Leaf)) { exit 1 }; $$di=Get-Item -LiteralPath $$d -Force; $$ni=Get-Item -LiteralPath $$n -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $$r=Get-ChildItem -LiteralPath $$d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { exit 1 }; $$h=(Get-FileHash -LiteralPath $$n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') { exit 1 }; $$v=(& $$n --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'v24.21.0') { exit 1 }; $$a=(& $$n -p 'process.arch').Trim(); if ($$LASTEXITCODE -ne 0 -or $$a -ne 'x64') { exit 1 }; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_ready crylo_node_install

crylo_node_install:
  ; Embed the authenticated Node.js archive directly into this CryLo installer.
  File /oname=$PLUGINSDIR\node-v24.21.0-win-x64.zip "${BUILD_RESOURCES_DIR}\node-v24.21.0-win-x64.zip"

  ; Verify the embedded archive before touching any existing managed runtime.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$h=(Get-FileHash -LiteralPath '$PLUGINSDIR\node-v24.21.0-win-x64.zip' -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541') { exit 1 }; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_stage crylo_node_failed

crylo_node_stage:
  ; Extract to installer-private staging. The existing runtime remains untouched.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$s='$PLUGINSDIR\crylo-node-stage'; if (Test-Path -LiteralPath $$s) { Remove-Item -LiteralPath $$s -Recurse -Force }; New-Item -ItemType Directory -Path $$s -Force | Out-Null; Expand-Archive -LiteralPath '$PLUGINSDIR\node-v24.21.0-win-x64.zip' -DestinationPath $$s -Force; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_verify_stage crylo_node_failed

crylo_node_verify_stage:
  ; Validate the staged tree completely before replacing any prior runtime.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$d='$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64'; $$n=Join-Path $$d 'node.exe'; if (-not (Test-Path -LiteralPath $$d -PathType Container) -or -not (Test-Path -LiteralPath $$n -PathType Leaf)) { exit 1 }; $$di=Get-Item -LiteralPath $$d -Force; $$ni=Get-Item -LiteralPath $$n -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $$r=Get-ChildItem -LiteralPath $$d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { exit 1 }; $$h=(Get-FileHash -LiteralPath $$n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') { exit 1 }; $$v=(& $$n --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'v24.21.0') { exit 1 }; $$a=(& $$n -p 'process.arch').Trim(); if ($$LASTEXITCODE -ne 0 -or $$a -ne 'x64') { exit 1 }; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_swap crylo_node_failed

crylo_node_swap:
  ; Transactional replacement: retain the previous runtime until the staged
  ; runtime has been moved into place and revalidated.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$runtime='$LOCALAPPDATA\CryLo\runtime'; $$final=Join-Path $$runtime 'node-v24.21.0-win-x64'; $$staged='$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64'; $$backup=Join-Path $$runtime 'node-v24.21.0-win-x64.pre-crylo-install'; if (Test-Path -LiteralPath $$backup) { exit 1 }; foreach ($$p in @('$LOCALAPPDATA\CryLo',$$runtime,$$final)) { if (Test-Path -LiteralPath $$p) { $$i=Get-Item -LiteralPath $$p -Force; if (($$i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 } } }; $$hadOld=Test-Path -LiteralPath $$final; $$installed=$$false; try { if ($$hadOld) { $$r=Get-ChildItem -LiteralPath $$final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { throw 'Existing runtime contains a reparse point.' }; Move-Item -LiteralPath $$final -Destination $$backup }; Move-Item -LiteralPath $$staged -Destination $$final; $$installed=$$true; $$n=Join-Path $$final 'node.exe'; if (-not (Test-Path -LiteralPath $$final -PathType Container) -or -not (Test-Path -LiteralPath $$n -PathType Leaf)) { throw 'Installed runtime is incomplete.' }; $$di=Get-Item -LiteralPath $$final -Force; $$ni=Get-Item -LiteralPath $$n -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installed runtime contains a reparse point.' }; $$r=Get-ChildItem -LiteralPath $$final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { throw 'Installed runtime tree contains a reparse point.' }; $$h=(Get-FileHash -LiteralPath $$n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') { throw 'Installed node.exe hash mismatch.' }; $$v=(& $$n --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'v24.21.0') { throw 'Installed Node.js version mismatch.' }; $$a=(& $$n -p 'process.arch').Trim(); if ($$LASTEXITCODE -ne 0 -or $$a -ne 'x64') { throw 'Installed Node.js architecture mismatch.' }; if ($$hadOld) { Remove-Item -LiteralPath $$backup -Recurse -Force }; exit 0 } catch { if ($$installed -and (Test-Path -LiteralPath $$final)) { Remove-Item -LiteralPath $$final -Recurse -Force -ErrorAction SilentlyContinue }; if ($$hadOld -and (Test-Path -LiteralPath $$backup) -and -not (Test-Path -LiteralPath $$final)) { Move-Item -LiteralPath $$backup -Destination $$final -ErrorAction SilentlyContinue }; exit 1 }"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_verify_final crylo_node_failed

crylo_node_verify_final:
  ; Final fail-closed verification after the transactional swap.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$d='$LOCALAPPDATA\CryLo\runtime\node-v24.21.0-win-x64'; $$n=Join-Path $$d 'node.exe'; if (-not (Test-Path -LiteralPath $$d -PathType Container) -or -not (Test-Path -LiteralPath $$n -PathType Leaf)) { exit 1 }; $$di=Get-Item -LiteralPath $$d -Force; $$ni=Get-Item -LiteralPath $$n -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$ni.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $$r=Get-ChildItem -LiteralPath $$d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { exit 1 }; $$h=(Get-FileHash -LiteralPath $$n -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') { exit 1 }; $$v=(& $$n --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'v24.21.0') { exit 1 }; $$a=(& $$n -p 'process.arch').Trim(); if ($$LASTEXITCODE -ne 0 -or $$a -ne 'x64') { exit 1 }; exit 0"` $R0
  IfErrors crylo_node_failed
  StrCmp $R0 "0" crylo_node_ready crylo_node_failed

crylo_node_failed:
  Delete "$PLUGINSDIR\node-v24.21.0-win-x64.zip"
  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup could not provision the authenticated Node.js 24.21.0 x64 runtime required by the Nexus Node Service.$\r$\n$\r$\nNo system Node.js installation will be used. Any previous managed runtime was preserved or restored."
  Abort "CryLo managed Node.js runtime installation failed."

crylo_node_ready:
  Delete "$PLUGINSDIR\node-v24.21.0-win-x64.zip"

  ; ============================================================
  ; CryLo network configuration.
  ; ============================================================

  ; Install the CryLo network bootstrap configuration for the Windows user
  ; performing the installation. $APPDATA resolves per user and contains no
  ; hard-coded account name.
  CreateDirectory "$APPDATA\CryLo"

  ; Preserve an existing user configuration on upgrade/reinstall.
  ; Only create the default bootstrap configuration for a first-time install.
  IfFileExists "$APPDATA\CryLo\CryLo.conf" crylo_config_ready 0

  FileOpen $0 "$APPDATA\CryLo\CryLo.conf" w
  FileWrite $0 "testnet=1$\r$\n"
  FileWrite $0 "add-priority-node=relay-us-1.crylo.network:22640$\r$\n"
  FileClose $0

crylo_config_ready:

  ; Interactive daemon: network selection and relay bootstrap come entirely
  ; from %APPDATA%\CryLo\CryLo.conf.
  CreateShortCut \
    "$SMPROGRAMS\CryLo Daemon.lnk" \
    "$INSTDIR\resources\bin\win\CryLo-daemon.exe"

  ; Background daemon: only the runtime mode is supplied on the shortcut.
  ; Testnet and relay bootstrap still come from CryLo.conf.
  CreateShortCut \
    "$SMPROGRAMS\CryLo Daemon - Background.lnk" \
    "$INSTDIR\resources\bin\win\CryLo-daemon.exe" \
    "--non-interactive" \
    "" \
    0 \
    SW_SHOWMINIMIZED
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\CryLo Daemon.lnk"
  Delete "$SMPROGRAMS\CryLo Daemon - Background.lnk"

  ; Preserve $APPDATA\CryLo\CryLo.conf on uninstall so network/user
  ; configuration survives an application reinstall.
  ;
  ; Preserve $LOCALAPPDATA\CryLo\runtime as CryLo-owned per-user runtime data.
  ; A later CryLo install/update can verify and repair it in place.
!macroend
