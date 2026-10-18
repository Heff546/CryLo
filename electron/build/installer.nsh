!macro customInstall
  ; ============================================================
  ; CryLo-managed Windows runtime bootstrap.
  ;
  ; Normal users never need PowerShell. The installer uses only Windows
  ; cmd.exe/certutil.exe/tar.exe long enough to authenticate and unpack the
  ; exact CryLo-managed Node.js runtime. All subsequent transactional runtime,
  ; source-checkout, and per-user command work is performed by the authenticated
  ; CryLo-managed Node.js binary through windows-installer-runtime.js.
  ; ============================================================

  CreateDirectory "$LOCALAPPDATA\CryLo"
  CreateDirectory "$LOCALAPPDATA\CryLo\runtime"

  ; Embed authenticated installer resources staged by before-pack.js.
  File /oname=$PLUGINSDIR\node-v24.21.0-win-x64.zip "${BUILD_RESOURCES_DIR}\node-v24.21.0-win-x64.zip"
  File /oname=$PLUGINSDIR\MinGit-2.56.0-64-bit.zip "${BUILD_RESOURCES_DIR}\MinGit-2.56.0-64-bit.zip"
  File /oname=$PLUGINSDIR\windows-installer-runtime.js "${BUILD_RESOURCES_DIR}\windows-installer-runtime.js"

  ; Fail closed if required Windows inbox tools are unavailable.
  IfFileExists "$SYSDIR\cmd.exe" 0 crylo_runtime_failed
  IfFileExists "$SYSDIR\certutil.exe" 0 crylo_runtime_failed
  IfFileExists "$SYSDIR\tar.exe" 0 crylo_runtime_failed

  ; Verify the embedded installer helper before it is executed. The helper is
  ; security-sensitive because it owns transactional runtime repair, source
  ; bootstrap, and per-user command registration.
  ClearErrors
  ExecWait `"$SYSDIR\cmd.exe" /D /S /C ""$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\windows-installer-runtime.js" SHA256 | "$SYSDIR\findstr.exe" /I /C:"ebf3b7eecaaf972248297b17a3c0ed28402d6632357d12bba59a6ea40dda480e" >NUL"` $R0
  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_helper_verified crylo_runtime_failed

crylo_helper_verified:

  ; Verify the embedded Node.js archive before extracting or executing anything
  ; from it. This avoids trusting an unverified runtime to verify itself.
  ClearErrors
  ExecWait `"$SYSDIR\cmd.exe" /D /S /C ""$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\node-v24.21.0-win-x64.zip" SHA256 | "$SYSDIR\findstr.exe" /I /C:"158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541" >NUL"` $R0
  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_node_archive_verified crylo_runtime_failed

crylo_node_archive_verified:
  ; Extract into installer-private staging. Existing managed runtimes remain
  ; untouched until the authenticated helper completes all validation.
  RMDir /r "$PLUGINSDIR\crylo-node-stage"
  CreateDirectory "$PLUGINSDIR\crylo-node-stage"

  ClearErrors
  ExecWait `"$SYSDIR\tar.exe" -xf "$PLUGINSDIR\node-v24.21.0-win-x64.zip" -C "$PLUGINSDIR\crylo-node-stage"` $R0
  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_node_stage_ready crylo_runtime_failed

crylo_node_stage_ready:
  IfFileExists "$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" 0 crylo_runtime_failed

  ; Verify the staged node.exe independently before it is allowed to execute.
  ClearErrors
  ExecWait `"$SYSDIR\cmd.exe" /D /S /C ""$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" SHA256 | "$SYSDIR\findstr.exe" /I /C:"ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32" >NUL"` $R0
  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_runtime_helper crylo_runtime_failed

crylo_runtime_helper:
  ; The authenticated Node.js runtime now owns the security-sensitive work:
  ;   - reject symbolic-link/junction/reparse paths
  ;   - validate/repair Node.js transactionally with rollback
  ;   - verify, stage, validate, and repair MinGit transactionally
  ;   - validate or create the managed %USERPROFILE%\CryLo checkout
  ;   - pin a first-time checkout to the packaged runtime manifest commit
  ;   - preserve an existing valid CryLo checkout untouched
  ;   - register the per-user crylo.cmd wrapper and user PATH safely
  ; No system Node.js, system Git, or PowerShell is used.
  ClearErrors
  ExecWait `"$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" "$PLUGINSDIR\windows-installer-runtime.js" install "$PLUGINSDIR" "$INSTDIR\resources\bin\win\WINDOWS-BUILD-RUNTIME-MANIFEST.json"` $R0
  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_runtime_ready crylo_runtime_failed

crylo_runtime_failed:
  Delete "$PLUGINSDIR\node-v24.21.0-win-x64.zip"
  Delete "$PLUGINSDIR\MinGit-2.56.0-64-bit.zip"
  Delete "$PLUGINSDIR\windows-installer-runtime.js"
  RMDir /r "$PLUGINSDIR\crylo-node-stage"
  RMDir /r "$PLUGINSDIR\crylo-git-stage"
  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup could not safely provision the authenticated Windows runtime required by CryLo and the Nexus Node Service.$\r$\n$\r$\nNo system Node.js, system Git, or PowerShell is used. Any previous managed runtime was preserved or restored."
  Abort "CryLo managed Windows runtime installation failed."

crylo_runtime_ready:
  Delete "$PLUGINSDIR\node-v24.21.0-win-x64.zip"
  Delete "$PLUGINSDIR\MinGit-2.56.0-64-bit.zip"
  Delete "$PLUGINSDIR\windows-installer-runtime.js"
  RMDir /r "$PLUGINSDIR\crylo-node-stage"
  RMDir /r "$PLUGINSDIR\crylo-git-stage"

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
