#!/bin/sh
set -eu

REPO="lirrensi/cancan"
VERSION="${CANCAN_VERSION:-latest}"
INSTALL_DIR="${CANCAN_INSTALL_DIR:-$HOME/.local/bin}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '%s\n' "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd tar
if command -v curl >/dev/null 2>&1; then
  FETCH='curl -fsSL'
elif command -v wget >/dev/null 2>&1; then
  FETCH='wget -qO-'
else
  printf '%s\n' "Missing required command: curl or wget" >&2
  exit 1
fi

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux) OS_NAME="linux" ;;
  Darwin) OS_NAME="macos" ;;
  *)
    printf '%s\n' "Unsupported operating system: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_NAME="amd64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *)
    printf '%s\n' "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET="cancan_${OS_NAME}_${ARCH_NAME}.tar.gz"
if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/$ASSET"
else
  URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
fi

TMP_DIR=$(mktemp -d)
ARCHIVE_PATH="$TMP_DIR/$ASSET"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

mkdir -p "$INSTALL_DIR"

printf '%s\n' "Downloading $URL"
sh -c "$FETCH \"$URL\" > \"$ARCHIVE_PATH\""
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
install -m 0755 "$TMP_DIR/cancan" "$INSTALL_DIR/cancan"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) PATH_PRESENT=1 ;;
  *) PATH_PRESENT=0 ;;
esac

if [ "$PATH_PRESENT" -eq 0 ]; then
  for profile in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$profile" ] || [ "$profile" = "$HOME/.profile" ]; then
      if [ -f "$profile" ] && grep -F "$INSTALL_DIR" "$profile" >/dev/null 2>&1; then
        continue
      fi
      printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$profile"
    fi
  done
  printf '%s\n' "Added $INSTALL_DIR to PATH in your shell profile files. Restart your shell if needed."
fi

printf '%s\n' "Installed cancan to $INSTALL_DIR/cancan"
