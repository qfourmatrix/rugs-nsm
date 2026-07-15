#!/bin/zsh

set -euo pipefail

MAC_SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$MAC_SCRIPTS_DIR/../.." && pwd -P)"
APP_ROOT="$PROJECT_ROOT/app"
RUNTIME_ROOT="$PROJECT_ROOT/.runtime"
NODE_ROOT="$RUNTIME_ROOT/node"
NODE_VERSION="$(tr -d '[:space:]' < "$APP_ROOT/.node-version")"
APP_URL="${RUGS_APP_URL:-http://127.0.0.1:5173}"
API_URL="${RUGS_API_URL:-http://127.0.0.1:8787}"

export PROJECT_ROOT APP_ROOT RUNTIME_ROOT NODE_ROOT NODE_VERSION APP_URL API_URL

heading() {
  printf '\n%s\n' "$1"
  printf '%*s\n' "${#1}" '' | tr ' ' '='
}

pause_for_user() {
  if [[ "${RUGS_NONINTERACTIVE:-0}" != "1" && -t 0 ]]; then
    printf '\nPress Return to close this window...'
    IFS= read -r _
  fi
}

die() {
  printf '\nERROR: %s\n' "$1" >&2
  pause_for_user
  exit 1
}

activate_local_node() {
  [[ -x "$NODE_ROOT/bin/node" ]] || return 1

  export PATH="$NODE_ROOT/bin:$PATH"
  local installed_version
  installed_version="$(node -p 'process.versions.node')"
  [[ "$installed_version" == "$NODE_VERSION" ]]
}

download_local_node() {
  local machine_arch node_arch archive_name base_url temp_dir archive_path expected actual extracted_dir
  machine_arch="$(uname -m)"

  case "$machine_arch" in
    arm64) node_arch="darwin-arm64" ;;
    x86_64) node_arch="darwin-x64" ;;
    *) die "Unsupported Mac architecture: $machine_arch" ;;
  esac

  archive_name="node-v${NODE_VERSION}-${node_arch}.tar.gz"
  base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/rugs-node.XXXXXX")"
  archive_path="$temp_dir/$archive_name"
  extracted_dir="$temp_dir/node-v${NODE_VERSION}-${node_arch}"

  printf 'Downloading the private Node.js runtime for %s...\n' "$machine_arch"
  curl --fail --location --retry 3 --progress-bar "$base_url/$archive_name" --output "$archive_path" || {
    rm -rf "$temp_dir"
    die "Could not download Node.js. Check the internet connection and run First Setup again."
  }

  expected="$(curl --fail --silent --show-error "$base_url/SHASUMS256.txt" | awk -v file="$archive_name" '$2 == file { print $1 }')"
  [[ -n "$expected" ]] || {
    rm -rf "$temp_dir"
    die "Node.js did not publish a checksum for $archive_name."
  }

  actual="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] || {
    rm -rf "$temp_dir"
    die "The Node.js download failed its SHA-256 integrity check."
  }

  tar -xzf "$archive_path" -C "$temp_dir"
  mkdir -p "$RUNTIME_ROOT"
  rm -rf "$NODE_ROOT"
  mv "$extracted_dir" "$NODE_ROOT"
  rm -rf "$temp_dir"

  activate_local_node || die "The local Node.js runtime was installed but could not be activated."
}

require_local_node() {
  activate_local_node || die "The private app runtime is missing. Double-click 1 First Setup.command first."
}

app_is_running() {
  local client_html
  client_html="$(curl --fail --silent --max-time 1 "$APP_URL" 2>/dev/null)" || return 1
  [[ "$client_html" == *"<title>Product Shot Queue</title>"* ]] || return 1
  curl --fail --silent --max-time 2 "$API_URL/api/products" >/dev/null 2>&1
}

open_app() {
  if [[ "${RUGS_SKIP_OPEN:-0}" != "1" ]]; then
    open "$APP_URL"
  fi
}
