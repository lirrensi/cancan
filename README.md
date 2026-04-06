# CanCan

Portable local kanban app powered by Luminka.

## Usage

- Build `cancan.exe` with `build.bat`.
- Put `cancan.exe` on your `PATH`.
- Open any folder in a terminal.
- Run `cancan`.

`build.bat` is preconfigured for MSYS2 MinGW at `C:\msys64\mingw64\bin\gcc.exe` so the Luminka webview build can compile on Windows.
The build also embeds the app icon from `winres/icon.png` into the Windows executable using `go-winres`, writing the Windows resource object to `rsrc.syso_windows_amd64.syso` before `go build`.

CanCan uses detached root mode, so the current working directory becomes the active workspace. Board files live in `.kanban/boards/` under that folder.
