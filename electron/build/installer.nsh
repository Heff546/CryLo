!macro customInstall
  ; Install the CryLo network bootstrap configuration for the Windows user
  ; performing the installation. $APPDATA resolves per user and contains no
  ; hard-coded account name.
  CreateDirectory "$APPDATA\CryLo"

  FileOpen $0 "$APPDATA\CryLo\CryLo.conf" w
  FileWrite $0 "testnet=1$\r$\n"
  FileWrite $0 "add-priority-node=relay-us-1.crylo.network:22640$\r$\n"
  FileClose $0

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
!macroend
