; The exact staged helper hash is calculated automatically by before-pack.js.
; This include MUST exist at compile time. NSIS will fail closed if missing.
!include "${BUILD_RESOURCES_DIR}\crylo-installer-helper-staged\helper-sha256.generated.nsh"

!macro customInstall
  ; ============================================================
  ; CryLo-managed Windows runtime bootstrap.
  ;
  ; Normal users never need PowerShell. The installer uses Windows
  ; certutil.exe/findstr.exe/tar.exe plus the bundled NSIS nsExec plugin
  ; long enough to authenticate and unpack the exact CryLo-managed Node.js
  ; runtime. All subsequent transactional runtime, source-checkout, and
  ; per-user command work is performed by the authenticated CryLo-managed
  ; Node.js binary through windows-installer-runtime.js.
  ;
  ; installer-bootstrap.log records bootstrap stages and return codes so
  ; installer failures can be diagnosed without requiring a visible console.
  ; ============================================================

  CreateDirectory "$LOCALAPPDATA\CryLo"
  CreateDirectory "$LOCALAPPDATA\CryLo\runtime"

  ; Start a fresh bootstrap diagnostic log for this installer invocation.
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" w
  FileWrite $8 "===== CRYLO WINDOWS INSTALLER BOOTSTRAP =====$\r$\n"
  FileWrite $8 "START$\r$\n"
  FileClose $8

  ; Embed authenticated installer resources staged by before-pack.js.
  ; The helper and its generated hash pin refer to the SAME canonical bytes.
  ; No release-by-release manual SHA256 maintenance is required.
  File /oname=$PLUGINSDIR\node-v24.21.0-win-x64.zip "${BUILD_RESOURCES_DIR}\node-v24.21.0-win-x64.zip"
  File /oname=$PLUGINSDIR\MinGit-2.56.0-64-bit.zip "${BUILD_RESOURCES_DIR}\MinGit-2.56.0-64-bit.zip"
  File /oname=$PLUGINSDIR\windows-installer-runtime.js "${BUILD_RESOURCES_DIR}\crylo-installer-helper-staged\windows-installer-runtime.js"

  ; Fail closed if required Windows inbox tools are unavailable.
  StrCpy $R9 "REQUIRED_CERTUTIL"
  IfFileExists "$SYSDIR\certutil.exe" crylo_certutil_present crylo_runtime_failed

crylo_certutil_present:
  StrCpy $R9 "REQUIRED_FINDSTR"
  IfFileExists "$SYSDIR\findstr.exe" crylo_findstr_present crylo_runtime_failed

crylo_findstr_present:
  StrCpy $R9 "REQUIRED_TAR"
  IfFileExists "$SYSDIR\tar.exe" crylo_tar_present crylo_runtime_failed

crylo_tar_present:

  ; ============================================================
  ; AUTHENTICATE INSTALLER HELPER
  ; ============================================================

  StrCpy $R9 "HELPER_CERTUTIL"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=HELPER_CERTUTIL$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\windows-installer-runtime.js" SHA256`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "HELPER_CERTUTIL_RC=$R0$\r$\n"
  FileWrite $8 "HELPER_CERTUTIL_OUTPUT_BEGIN$\r$\n"
  FileWrite $8 "$R1$\r$\n"
  FileWrite $8 "HELPER_CERTUTIL_OUTPUT_END$\r$\n"
  FileClose $8

  StrCmp $R0 "0" crylo_helper_certutil_ok crylo_runtime_failed

crylo_helper_certutil_ok:
  StrCpy $R9 "HELPER_HASH_OUTPUT_FILE"

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  ClearErrors
  FileOpen $0 "$PLUGINSDIR\crylo-hash-output.txt" w
  IfErrors crylo_runtime_failed

  FileWrite $0 "$R1"
  IfErrors crylo_helper_hash_write_failed

  FileClose $0

  StrCpy $R9 "HELPER_HASH_COMPARE"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=HELPER_HASH_COMPARE$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\findstr.exe" /I /X /C:"${CRYLO_INSTALLER_HELPER_SHA256}" "$PLUGINSDIR\crylo-hash-output.txt"`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "HELPER_HASH_COMPARE_RC=$R0$\r$\n"
  FileWrite $8 "HELPER_HASH_COMPARE_OUTPUT=$R1$\r$\n"
  FileClose $8

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  StrCmp $R0 "0" crylo_helper_verified crylo_runtime_failed

crylo_helper_hash_write_failed:
  FileClose $0
  StrCpy $R9 "HELPER_HASH_OUTPUT_WRITE"
  Goto crylo_runtime_failed

crylo_helper_verified:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "HELPER_HASH=PASS$\r$\n"
  FileClose $8

  ; ============================================================
  ; AUTHENTICATE NODE ARCHIVE
  ; ============================================================

  StrCpy $R9 "NODE_ARCHIVE_CERTUTIL"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=NODE_ARCHIVE_CERTUTIL$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\node-v24.21.0-win-x64.zip" SHA256`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_ARCHIVE_CERTUTIL_RC=$R0$\r$\n"
  FileWrite $8 "NODE_ARCHIVE_CERTUTIL_OUTPUT_BEGIN$\r$\n"
  FileWrite $8 "$R1$\r$\n"
  FileWrite $8 "NODE_ARCHIVE_CERTUTIL_OUTPUT_END$\r$\n"
  FileClose $8

  StrCmp $R0 "0" crylo_node_archive_certutil_ok crylo_runtime_failed

crylo_node_archive_certutil_ok:
  StrCpy $R9 "NODE_ARCHIVE_HASH_OUTPUT_FILE"

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  ClearErrors
  FileOpen $0 "$PLUGINSDIR\crylo-hash-output.txt" w
  IfErrors crylo_runtime_failed

  FileWrite $0 "$R1"
  IfErrors crylo_node_archive_hash_write_failed

  FileClose $0

  StrCpy $R9 "NODE_ARCHIVE_HASH_COMPARE"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=NODE_ARCHIVE_HASH_COMPARE$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\findstr.exe" /I /X /C:"158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541" "$PLUGINSDIR\crylo-hash-output.txt"`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_ARCHIVE_HASH_COMPARE_RC=$R0$\r$\n"
  FileWrite $8 "NODE_ARCHIVE_HASH_COMPARE_OUTPUT=$R1$\r$\n"
  FileClose $8

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  StrCmp $R0 "0" crylo_node_archive_verified crylo_runtime_failed

crylo_node_archive_hash_write_failed:
  FileClose $0
  StrCpy $R9 "NODE_ARCHIVE_HASH_OUTPUT_WRITE"
  Goto crylo_runtime_failed

crylo_node_archive_verified:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_ARCHIVE_HASH=PASS$\r$\n"
  FileClose $8

  ; ============================================================
  ; EXTRACT NODE
  ; ============================================================

  StrCpy $R9 "NODE_EXTRACTION"

  RMDir /r "$PLUGINSDIR\crylo-node-stage"
  CreateDirectory "$PLUGINSDIR\crylo-node-stage"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=NODE_EXTRACTION$\r$\n"
  FileClose $8

  ClearErrors
  ExecWait `"$SYSDIR\tar.exe" -xf "$PLUGINSDIR\node-v24.21.0-win-x64.zip" -C "$PLUGINSDIR\crylo-node-stage"` $R0

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_EXTRACTION_RC=$R0$\r$\n"
  FileClose $8

  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_node_stage_ready crylo_runtime_failed

crylo_node_stage_ready:
  StrCpy $R9 "NODE_EXE_EXISTS"

  IfFileExists "$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" crylo_node_exe_present crylo_runtime_failed

crylo_node_exe_present:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_EXTRACTION=PASS$\r$\n"
  FileClose $8

  ; ============================================================
  ; AUTHENTICATE EXTRACTED NODE.EXE
  ; ============================================================

  StrCpy $R9 "NODE_EXE_CERTUTIL"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=NODE_EXE_CERTUTIL$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\certutil.exe" -hashfile "$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" SHA256`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_EXE_CERTUTIL_RC=$R0$\r$\n"
  FileWrite $8 "NODE_EXE_CERTUTIL_OUTPUT_BEGIN$\r$\n"
  FileWrite $8 "$R1$\r$\n"
  FileWrite $8 "NODE_EXE_CERTUTIL_OUTPUT_END$\r$\n"
  FileClose $8

  StrCmp $R0 "0" crylo_node_exe_certutil_ok crylo_runtime_failed

crylo_node_exe_certutil_ok:
  StrCpy $R9 "NODE_EXE_HASH_OUTPUT_FILE"

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  ClearErrors
  FileOpen $0 "$PLUGINSDIR\crylo-hash-output.txt" w
  IfErrors crylo_runtime_failed

  FileWrite $0 "$R1"
  IfErrors crylo_node_exe_hash_write_failed

  FileClose $0

  StrCpy $R9 "NODE_EXE_HASH_COMPARE"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "STAGE=NODE_EXE_HASH_COMPARE$\r$\n"
  FileClose $8

  nsExec::ExecToStack `"$SYSDIR\findstr.exe" /I /X /C:"ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32" "$PLUGINSDIR\crylo-hash-output.txt"`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_EXE_HASH_COMPARE_RC=$R0$\r$\n"
  FileWrite $8 "NODE_EXE_HASH_COMPARE_OUTPUT=$R1$\r$\n"
  FileClose $8

  Delete "$PLUGINSDIR\crylo-hash-output.txt"

  StrCmp $R0 "0" crylo_runtime_helper crylo_runtime_failed

crylo_node_exe_hash_write_failed:
  FileClose $0
  StrCpy $R9 "NODE_EXE_HASH_OUTPUT_WRITE"
  Goto crylo_runtime_failed

crylo_runtime_helper:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "NODE_EXE_HASH=PASS$\r$\n"
  FileWrite $8 "STAGE=RUNTIME_HELPER_EXECUTION$\r$\n"
  FileClose $8

  ; The authenticated Node.js runtime now owns the security-sensitive work:
  ;   - reject symbolic-link/junction/reparse paths
  ;   - validate/repair Node.js transactionally with rollback
  ;   - verify, stage, validate, and repair MinGit transactionally
  ;   - validate or create the managed %USERPROFILE%\CryLo checkout
  ;   - pin a first-time checkout to the packaged runtime manifest commit
  ;   - preserve an existing valid CryLo checkout untouched
  ;   - register the per-user crylo.cmd wrapper and user PATH safely
  ; No system Node.js, system Git, or PowerShell is used.

  StrCpy $R9 "RUNTIME_HELPER_EXECUTION"

  ; Diagnostic capture for the NSIS-only helper failure. This preserves the
  ; exact authenticated helper invocation while recording the environment,
  ; manifest identity, paths, return code, and helper stdout/stderr.
  ReadEnvStr $R2 "USERPROFILE"
  ReadEnvStr $R3 "LOCALAPPDATA"
  ReadEnvStr $R4 "SystemRoot"
  ReadEnvStr $R5 "TEMP"
  ReadEnvStr $R6 "TMP"

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "RUNTIME_HELPER_USERPROFILE=$R2$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_LOCALAPPDATA=$R3$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_SYSTEMROOT=$R4$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_TEMP=$R5$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_TMP=$R6$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_PLUGIN_DIR=$PLUGINSDIR$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_NODE_PATH=$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_SCRIPT_PATH=$PLUGINSDIR\windows-installer-runtime.js$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_MANIFEST_PATH=$INSTDIR\resources\bin\win\WINDOWS-BUILD-RUNTIME-MANIFEST.json$\r$\n"
  FileClose $8

  StrCpy $R9 "RUNTIME_HELPER_MANIFEST_CERTUTIL"

  nsExec::ExecToStack `"$SYSDIR\certutil.exe" -hashfile "$INSTDIR\resources\bin\win\WINDOWS-BUILD-RUNTIME-MANIFEST.json" SHA256`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "RUNTIME_HELPER_MANIFEST_CERTUTIL_RC=$R0$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_MANIFEST_CERTUTIL_OUTPUT_BEGIN$\r$\n"
  FileWrite $8 "$R1$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_MANIFEST_CERTUTIL_OUTPUT_END$\r$\n"
  FileClose $8

  StrCmp $R0 "0" crylo_runtime_helper_manifest_ok crylo_runtime_failed

crylo_runtime_helper_manifest_ok:
  StrCpy $R9 "RUNTIME_HELPER_EXECUTION"

  ClearErrors
  nsExec::ExecToStack `"$PLUGINSDIR\crylo-node-stage\node-v24.21.0-win-x64\node.exe" "$PLUGINSDIR\windows-installer-runtime.js" install "$PLUGINSDIR" "$INSTDIR\resources\bin\win\WINDOWS-BUILD-RUNTIME-MANIFEST.json"`
  Pop $R0
  Pop $R1

  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "RUNTIME_HELPER_RC=$R0$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_OUTPUT_BEGIN$\r$\n"
  FileWrite $8 "$R1$\r$\n"
  FileWrite $8 "RUNTIME_HELPER_OUTPUT_END$\r$\n"
  FileClose $8

  IfErrors crylo_runtime_failed
  StrCmp $R0 "0" crylo_runtime_ready crylo_runtime_failed

crylo_runtime_failed:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "FAIL_STAGE=$R9$\r$\n"
  FileWrite $8 "FAIL_RC=$R0$\r$\n"
  FileWrite $8 "RESULT=FAIL$\r$\n"
  FileClose $8

  Delete "$PLUGINSDIR\crylo-hash-output.txt"
  Delete "$PLUGINSDIR\node-v24.21.0-win-x64.zip"
  Delete "$PLUGINSDIR\MinGit-2.56.0-64-bit.zip"
  Delete "$PLUGINSDIR\windows-installer-runtime.js"
  RMDir /r "$PLUGINSDIR\crylo-node-stage"
  RMDir /r "$PLUGINSDIR\crylo-git-stage"

  ; A silent /S validation run must return immediately rather than wait on an
  ; invisible modal error dialog.
  IfSilent crylo_runtime_failed_abort

  MessageBox MB_ICONSTOP|MB_OK \
    "CryLo Setup could not safely provision the authenticated Windows runtime required by CryLo and the Nexus Node Service.$\r$\n$\r$\nNo system Node.js, system Git, or PowerShell is used. Any previous managed runtime was preserved or restored."

crylo_runtime_failed_abort:
  Abort "CryLo managed Windows runtime installation failed."

crylo_runtime_ready:
  FileOpen $8 "$LOCALAPPDATA\CryLo\installer-bootstrap.log" a
  FileWrite $8 "RUNTIME_HELPER=PASS$\r$\n"
  FileWrite $8 "RESULT=READY$\r$\n"
  FileClose $8

  Delete "$PLUGINSDIR\crylo-hash-output.txt"
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