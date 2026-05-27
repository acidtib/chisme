#!/bin/sh
# chisme installer.
#
#   curl -fsSL https://raw.githubusercontent.com/acidtib/chisme/main/bin/install.sh | sh
#
# Overrides via environment:
#   CHISME_REPO         GitHub owner/repo            (default: acidtib/chisme)
#   CHISME_VERSION      release tag or "latest"      (default: latest)
#   CHISME_INSTALL_DIR  install directory            (default: $HOME/.local/bin)
set -eu

REPO="${CHISME_REPO:-acidtib/chisme}"
VERSION="${CHISME_VERSION:-latest}"
INSTALL_DIR="${CHISME_INSTALL_DIR:-$HOME/.local/bin}"

info() { printf '%s\n' "$*" >&2; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl is required"

os="$(uname -s)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) err "unsupported OS '$os'. On Windows, download chisme-windows-x64.exe from the releases page." ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) err "unsupported architecture '$arch'" ;;
esac

asset="chisme-${os}-${arch}"

if [ "$VERSION" = "latest" ]; then
  # Read the full API response before parsing, so curl is not interrupted by a
  # short-circuiting pipe (grep -m1 closing early printed a benign "curl: (23)").
  api_json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" \
    || err "could not reach the GitHub API for ${REPO}"
  tag="$(printf '%s\n' "$api_json" | grep '"tag_name":' | head -n1 | cut -d '"' -f4)"
  [ -n "$tag" ] || err "could not resolve the latest release of ${REPO}"
else
  tag="$VERSION"
fi

base="https://github.com/${REPO}/releases/download/${tag}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

info "Installing chisme ${tag} (${asset})..."
curl -fsSL "${base}/${asset}" -o "${tmp}/chisme" || err "download failed: ${base}/${asset}"

# Verify the checksum if SHA256SUMS is published alongside the release.
if curl -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS" 2>/dev/null; then
  expected="$(grep -E "[[:space:]]${asset}\$" "${tmp}/SHA256SUMS" | cut -d ' ' -f1 || true)"
  if [ -n "${expected}" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "${tmp}/chisme" | cut -d ' ' -f1)"
    elif command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "${tmp}/chisme" | cut -d ' ' -f1)"
    else
      actual=""
    fi
    [ -z "${actual}" ] || [ "${actual}" = "${expected}" ] || err "checksum mismatch for ${asset}"
  fi
fi

chmod +x "${tmp}/chisme"
mkdir -p "${INSTALL_DIR}"
mv "${tmp}/chisme" "${INSTALL_DIR}/chisme"
info "Installed chisme to ${INSTALL_DIR}/chisme"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    info ""
    info "${INSTALL_DIR} is not on your PATH. Add it:"
    info "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

info ""
info "Next steps:"
info "  chisme index            # index this repo's Entire checkpoints"
info "  chisme search \"...\"      # search your AI sessions locally"
