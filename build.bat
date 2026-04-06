@echo off
setlocal
cd /d "%~dp0"
set "CC=C:\msys64\mingw64\bin\gcc.exe"
set "PATH=C:\msys64\mingw64\bin;%PATH%"
go run github.com/tc-hib/go-winres@latest simply --arch amd64 --out "rsrc.syso_windows_amd64.syso" --manifest gui --icon "winres/icon.png" --product-name "CanCan" --file-description "CanCan local kanban" --original-filename "cancan.exe"
go build -tags webview -ldflags "-H windowsgui" -o cancan.exe .
