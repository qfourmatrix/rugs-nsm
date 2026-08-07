#!/bin/zsh

set -euo pipefail

PACK_ROOT="$(cd "$(dirname "$0")" && pwd -P)"

pause_for_user() {
  if [[ -t 0 ]]; then
    printf '\nPress Return to close this window...'
    IFS= read -r _
  fi
}

die() {
  printf '\nERROR: %s\n' "$1" >&2
  pause_for_user
  exit 1
}

if [[ -n "${RUGS_PROJECT_ROOT:-}" ]]; then
  PROJECT_ROOT="$RUGS_PROJECT_ROOT"
elif [[ -f "$HOME/Documents/RUGS NSM/app/package.json" ]]; then
  PROJECT_ROOT="$HOME/Documents/RUGS NSM"
else
  PROJECT_ROOT="$(osascript -e 'POSIX path of (choose folder with prompt "Choose your existing RUGS NSM folder")')" || exit 0
  PROJECT_ROOT="${PROJECT_ROOT%/}"
fi

[[ -f "$PROJECT_ROOT/app/package.json" ]] || die "Choose the RUGS NSM folder itself, not its data or app subfolder."

if [[ -x "$PROJECT_ROOT/.runtime/node/bin/node" ]]; then
  NODE_BIN="$PROJECT_ROOT/.runtime/node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  die "Node.js is unavailable. Run 1 First Setup.command in RUGS NSM, then retry this installer."
fi

printf '\nRUGS NSM — Runner Background Merge\n'
printf '==================================\n'
printf 'App folder: %s\n' "$PROJECT_ROOT"
printf '\nThis keeps the existing Area/Round library and adds only Runner Foyer/Hallway records.\n'
printf 'The original manifest is not replaced; a backup is also made before activation.\n\n'

"$NODE_BIN" "$PACK_ROOT/support/install-runner-backgrounds.mjs" \
  --pack-root "$PACK_ROOT" \
  --project-root "$PROJECT_ROOT" || die "No active library was changed. Read the INSTALL FAILED message above."

printf '\nDone. Start RUGS NSM and press Rescan in Manage Library if it is already open.\n'
pause_for_user
