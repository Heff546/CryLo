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
  ; CryLo-managed MinGit runtime for Windows lifecycle commands.
  ;
  ; The authenticated MinGit archive is staged by before-pack.js and
  ; embedded in the normal CryLo Windows installer. System Git is never used.
  ; ============================================================

  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$paths=@('$LOCALAPPDATA\CryLo','$LOCALAPPDATA\CryLo\runtime','$LOCALAPPDATA\CryLo\runtime\mingit-2.56.0.windows.1-x64'); foreach ($$p in $$paths) { if (Test-Path -LiteralPath $$p) { $$i=Get-Item -LiteralPath $$p -Force; if (($$i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 } } }; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_paths_safe crylo_git_failed

crylo_git_paths_safe:
  IfFileExists "$LOCALAPPDATA\CryLo\runtime\mingit-2.56.0.windows.1-x64\cmd\git.exe" 0 crylo_git_install

  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$d='$LOCALAPPDATA\CryLo\runtime\mingit-2.56.0.windows.1-x64'; $$g=Join-Path $$d 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $$d -PathType Container) -or -not (Test-Path -LiteralPath $$g -PathType Leaf)) { exit 1 }; $$di=Get-Item -LiteralPath $$d -Force; $$gi=Get-Item -LiteralPath $$g -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$gi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $$r=Get-ChildItem -LiteralPath $$d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { exit 1 }; $$v=(& $$g --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'git version 2.56.0.windows.1') { exit 1 }; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_ready crylo_git_install

crylo_git_install:
  File /oname=$PLUGINSDIR\MinGit-2.56.0-64-bit.zip "${BUILD_RESOURCES_DIR}\MinGit-2.56.0-64-bit.zip"

  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$h=(Get-FileHash -LiteralPath '$PLUGINSDIR\MinGit-2.56.0-64-bit.zip' -Algorithm SHA256).Hash.ToLowerInvariant(); if ($$h -ne '064b440ff870ed5198527e8f3a92cdf5bd2fd0fedf5e718af95e3fdaddeff718') { exit 1 }; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_stage crylo_git_failed

crylo_git_stage:
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$s='$PLUGINSDIR\crylo-git-stage'; if (Test-Path -LiteralPath $$s) { Remove-Item -LiteralPath $$s -Recurse -Force }; New-Item -ItemType Directory -Path $$s -Force | Out-Null; Expand-Archive -LiteralPath '$PLUGINSDIR\MinGit-2.56.0-64-bit.zip' -DestinationPath $$s -Force; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_verify_stage crylo_git_failed

crylo_git_verify_stage:
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$d='$PLUGINSDIR\crylo-git-stage'; $$g=Join-Path $$d 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $$d -PathType Container) -or -not (Test-Path -LiteralPath $$g -PathType Leaf)) { exit 1 }; $$di=Get-Item -LiteralPath $$d -Force; $$gi=Get-Item -LiteralPath $$g -Force; if (($$di.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($$gi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }; $$r=Get-ChildItem -LiteralPath $$d -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { exit 1 }; $$v=(& $$g --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'git version 2.56.0.windows.1') { exit 1 }; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_swap crylo_git_failed

crylo_git_swap:
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$runtime='$LOCALAPPDATA\CryLo\runtime'; $$final=Join-Path $$runtime 'mingit-2.56.0.windows.1-x64'; $$staged='$PLUGINSDIR\crylo-git-stage'; $$backup=Join-Path $$runtime 'mingit-2.56.0.windows.1-x64.pre-crylo-install'; if (Test-Path -LiteralPath $$backup) { exit 1 }; foreach ($$p in @('$LOCALAPPDATA\CryLo',$$runtime,$$final)) { if (Test-Path -LiteralPath $$p) { $$i=Get-Item -LiteralPath $$p -Force; if (($$i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 } } }; $$hadOld=Test-Path -LiteralPath $$final; $$installed=$$false; try { if ($$hadOld) { $$r=Get-ChildItem -LiteralPath $$final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { throw 'Existing Git runtime contains a reparse point.' }; Move-Item -LiteralPath $$final -Destination $$backup }; Move-Item -LiteralPath $$staged -Destination $$final; $$installed=$$true; $$g=Join-Path $$final 'cmd\git.exe'; if (-not (Test-Path -LiteralPath $$g -PathType Leaf)) { throw 'Installed Git runtime is incomplete.' }; $$r=Get-ChildItem -LiteralPath $$final -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$r) { throw 'Installed Git runtime tree contains a reparse point.' }; $$v=(& $$g --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'git version 2.56.0.windows.1') { throw 'Installed Git version mismatch.' }; if ($$hadOld) { Remove-Item -LiteralPath $$backup -Recurse -Force }; exit 0 } catch { if ($$installed -and (Test-Path -LiteralPath $$final)) { Remove-Item -LiteralPath $$final -Recurse -Force -ErrorAction SilentlyContinue }; if ($$hadOld -and (Test-Path -LiteralPath $$backup) -and -not (Test-Path -LiteralPath $$final)) { Move-Item -LiteralPath $$backup -Destination $$final -ErrorAction SilentlyContinue }; exit 1 }"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_verify_final crylo_git_failed

crylo_git_verify_final:
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$g='$LOCALAPPDATA\CryLo\runtime\mingit-2.56.0.windows.1-x64\cmd\git.exe'; if (-not (Test-Path -LiteralPath $$g -PathType Leaf)) { exit 1 }; $$v=(& $$g --version).Trim(); if ($$LASTEXITCODE -ne 0 -or $$v -ne 'git version 2.56.0.windows.1') { exit 1 }; exit 0"` $R0
  IfErrors crylo_git_failed
  StrCmp $R0 "0" crylo_git_ready crylo_git_failed

crylo_git_failed:
  Delete "$PLUGINSDIR\MinGit-2.56.0-64-bit.zip"
  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup could not provision the authenticated MinGit 2.56.0.windows.1 x64 runtime required for CryLo lifecycle commands.$\r$\n$\r$\nNo system Git installation will be used. Any previous managed runtime was preserved or restored."
  Abort "CryLo managed MinGit runtime installation failed."

crylo_git_ready:
  Delete "$PLUGINSDIR\MinGit-2.56.0-64-bit.zip"

  ; ============================================================
  ; Managed CryLo source checkout used by the global crylo command.
  ;
  ; Existing valid %USERPROFILE%\CryLo checkouts are preserved untouched.
  ; A first-time install clones the official repository and checks out the exact
  ; commit recorded in the packaged Windows build/runtime manifest.
  ; ============================================================

  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$git='$LOCALAPPDATA\CryLo\runtime\mingit-2.56.0.windows.1-x64\cmd\git.exe'; $$manifestPath='$INSTDIR\resources\bin\win\WINDOWS-BUILD-RUNTIME-MANIFEST.json'; $$repo='https://github.com/Heff546/CryLo.git'; $$final=Join-Path $$env:USERPROFILE 'CryLo'; $$stage=Join-Path $$env:USERPROFILE 'CryLo.pre-crylo-install'; $$branch='crylo-managed'; if (-not (Test-Path -LiteralPath $$git -PathType Leaf)) { throw 'Managed CryLo Git runtime is missing.' }; if (-not (Test-Path -LiteralPath $$manifestPath -PathType Leaf)) { throw 'Packaged CryLo Windows runtime manifest is missing.' }; $$manifest=Get-Content -LiteralPath $$manifestPath -Raw | ConvertFrom-Json; $$commit=[string]$$manifest.gitCommit; if ($$manifest.product -ne 'CryLo' -or $$manifest.kind -ne 'windows-build-runtime' -or $$manifest.platform -ne 'win' -or $$manifest.architecture -ne 'x64' -or $$commit -notmatch '^[a-fA-F0-9]{40}$$') { throw 'Packaged CryLo Windows runtime manifest is invalid for source bootstrap.' }; if (-not $$env:USERPROFILE) { throw 'USERPROFILE is unavailable.' }; if (Test-Path -LiteralPath $$stage) { throw ('CryLo source recovery/staging path already exists: ' + $$stage) }; if (Test-Path -LiteralPath $$final) { $$fi=Get-Item -LiteralPath $$final -Force; if (($$fi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Existing CryLo checkout is a reparse point.' }; $$gitMeta=Join-Path $$final '.git'; if (-not (Test-Path -LiteralPath $$gitMeta)) { throw ('Existing CryLo path is not a Git checkout: ' + $$final) }; $$inside=(& $$git -C $$final rev-parse --is-inside-work-tree).Trim(); if ($$LASTEXITCODE -ne 0 -or $$inside -ne 'true') { throw 'Existing CryLo path is not a valid Git working tree.' }; $$origin=(& $$git -C $$final remote get-url origin).Trim(); if ($$LASTEXITCODE -ne 0 -or $$origin -ne $$repo) { throw ('Existing CryLo checkout origin mismatch: ' + $$origin) }; foreach ($$required in @('crylo.cmd','scripts\crylo.js')) { if (-not (Test-Path -LiteralPath (Join-Path $$final $$required) -PathType Leaf)) { throw ('Existing CryLo checkout is missing required file: ' + $$required) } }; exit 0 }; $$created=$$false; try { $$env:GIT_TERMINAL_PROMPT='0'; & $$git clone --origin origin --no-checkout $$repo $$stage; if ($$LASTEXITCODE -ne 0) { throw 'CryLo source clone failed.' }; $$origin=(& $$git -C $$stage remote get-url origin).Trim(); if ($$LASTEXITCODE -ne 0 -or $$origin -ne $$repo) { throw 'Cloned CryLo origin verification failed.' }; & $$git -C $$stage cat-file -e ($$commit + '^{commit}'); if ($$LASTEXITCODE -ne 0) { throw 'Installer release commit is unavailable in the cloned CryLo repository.' }; & $$git -C $$stage checkout -B $$branch $$commit; if ($$LASTEXITCODE -ne 0) { throw 'Unable to select the installer release commit.' }; $$head=(& $$git -C $$stage rev-parse HEAD).Trim(); if ($$LASTEXITCODE -ne 0 -or $$head.ToLowerInvariant() -ne $$commit.ToLowerInvariant()) { throw 'CryLo source checkout commit verification failed.' }; $$status=(& $$git -C $$stage status --porcelain --untracked-files=all); if ($$LASTEXITCODE -ne 0 -or $$status) { throw 'CryLo source checkout is not clean.' }; $$rp=Get-ChildItem -LiteralPath $$stage -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1; if ($$null -ne $$rp) { throw 'CryLo source checkout contains a reparse point.' }; foreach ($$required in @('crylo.cmd','scripts\crylo.js')) { if (-not (Test-Path -LiteralPath (Join-Path $$stage $$required) -PathType Leaf)) { throw ('Cloned CryLo checkout is missing required file: ' + $$required) } }; Move-Item -LiteralPath $$stage -Destination $$final; $$created=$$true; $$head=(& $$git -C $$final rev-parse HEAD).Trim(); $$origin=(& $$git -C $$final remote get-url origin).Trim(); if ($$LASTEXITCODE -ne 0 -or $$head.ToLowerInvariant() -ne $$commit.ToLowerInvariant() -or $$origin -ne $$repo) { throw 'Installed CryLo source checkout verification failed.' }; exit 0 } catch { if (Test-Path -LiteralPath $$stage) { Remove-Item -LiteralPath $$stage -Recurse -Force -ErrorAction SilentlyContinue }; if ($$created -and (Test-Path -LiteralPath $$final)) { Remove-Item -LiteralPath $$final -Recurse -Force -ErrorAction SilentlyContinue }; throw }"` $R0
  IfErrors crylo_source_failed
  StrCmp $R0 "0" crylo_source_ready crylo_source_failed

crylo_source_failed:
  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup could not prepare the managed %USERPROFILE%\CryLo source checkout required by the CryLo lifecycle command.$\r$\n$\r$\nAn existing checkout was not modified."
  Abort "CryLo managed source checkout installation failed."

crylo_source_ready:
  ; Register the global per-user crylo.cmd wrapper without modifying an
  ; unrelated command that may already exist at the same path.
  ClearErrors
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; $$checkout=Join-Path $$env:USERPROFILE 'CryLo'; $$launcher=Join-Path $$checkout 'crylo.cmd'; $$commandDirectory=Join-Path $$env:LOCALAPPDATA 'CryLo\bin'; $$commandPath=Join-Path $$commandDirectory 'crylo.cmd'; $$marker=':: CryLo managed launcher'; if (-not (Test-Path -LiteralPath $$launcher -PathType Leaf)) { throw 'Managed CryLo launcher is missing.' }; if (Test-Path -LiteralPath $$commandDirectory) { $$i=Get-Item -LiteralPath $$commandDirectory -Force; if (($$i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'CryLo command directory is a reparse point.' } } else { New-Item -ItemType Directory -Path $$commandDirectory -Force | Out-Null }; if (Test-Path -LiteralPath $$commandPath) { $$existing=Get-Content -LiteralPath $$commandPath -Raw; if (-not $$existing.Contains($$marker)) { throw ('Cannot replace existing CryLo command: ' + $$commandPath) } }; $$wrapper='@echo off' + [Environment]::NewLine + $$marker + [Environment]::NewLine + 'call "' + $$launcher + '" %*' + [Environment]::NewLine; [IO.File]::WriteAllText($$commandPath,$$wrapper,(New-Object Text.UTF8Encoding($$false))); $$userPath=[string][Environment]::GetEnvironmentVariable('Path','User'); $$entries=@($$userPath -split ';' | ForEach-Object { $$_.Trim() } | Where-Object { $$_ }); $$registered=$$false; foreach ($$entry in $$entries) { if ($$entry.TrimEnd('\') -ieq $$commandDirectory.TrimEnd('\')) { $$registered=$$true; break } }; if (-not $$registered) { $$updated=if ($$entries.Count) { ($$entries -join ';') + ';' + $$commandDirectory } else { $$commandDirectory }; [Environment]::SetEnvironmentVariable('Path',$$updated,'User') }; exit 0"` $R0
  IfErrors crylo_command_failed
  StrCmp $R0 "0" crylo_command_ready crylo_command_failed

crylo_command_failed:
  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup installed the application, but could not safely register the per-user CryLo lifecycle command."
  Abort "CryLo lifecycle command registration failed."

crylo_command_ready:

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
