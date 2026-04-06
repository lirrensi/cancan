@echo off
setlocal
cd /d "%~dp0"
del /q rsrc* 2>nul
go run github.com/tc-hib/go-winres@latest simply --arch amd64 --out "rsrc.syso" --manifest gui --icon "winres/icon.png" --product-name "CanCan" --file-description "CanCan local kanban" --original-filename "cancan.exe"
go build -ldflags "-H windowsgui" -o cancan-browser.exe .
