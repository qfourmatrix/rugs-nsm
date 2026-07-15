#!/bin/zsh

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

heading "RUGS NSM"
require_local_node

if app_is_running; then
  printf 'RUGS NSM is already running. Opening it now.\n'
  open_app
  exit 0
fi

[[ -d "$APP_ROOT/node_modules" ]] || die "Dependencies are missing. Double-click 1 First Setup.command first."
[[ -f "$APP_ROOT/.env.local" ]] || die "Private configuration is missing. Double-click 1 First Setup.command first."

printf 'Starting the app from:\n%s\n' "$PROJECT_ROOT"
printf '\nKeep this Terminal window open while using RUGS NSM.\n'
printf 'Press Control-C here when you want to stop the app.\n\n'

(
  for _ in {1..90}; do
    if app_is_running; then
      open_app
      exit 0
    fi
    sleep 1
  done
  printf '\nThe browser did not open automatically. Visit %s manually.\n' "$APP_URL" >&2
) &

cd "$APP_ROOT"
exec npm run dev:persistent
