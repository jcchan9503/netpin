; Electron-builder supplies the NSIS installer and uninstaller. Do not erase user data.
!include "WinVer.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "NetPin requires Windows 10 or newer (64-bit)."
    Abort
  ${EndIf}
!macroend
