#!/bin/zsh

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

heading "RUGS NSM — First Setup"
printf 'Project: %s\n' "$PROJECT_ROOT"

if ! activate_local_node; then
  download_local_node
fi

printf 'Using Node.js %s from the app folder.\n' "$(node --version)"
mkdir -p "$PROJECT_ROOT/data/nsm100k"

if [[ ! -f "$APP_ROOT/.env.local" ]]; then
  api_key=""
  if [[ "${RUGS_NONINTERACTIVE:-0}" != "1" && -t 0 ]]; then
    printf '\nEnter this Mac’s LaoZhang API key, or leave blank for safe mock mode.\n'
    printf 'The key will be hidden while typing: '
    IFS= read -rs api_key
    printf '\n'
  fi

  provider_mode="mock"
  [[ -n "$api_key" ]] && provider_mode="laozhang"

  umask 077
  {
    printf 'APP_PORT=8787\n'
    printf 'APP_PRODUCT_ROOT=../data/nsm100k\n'
    printf 'PROVIDER_MODE=%s\n' "$provider_mode"
    printf 'LAOZHANG_API_KEY=%s\n' "$api_key"
    printf 'LAOZHANG_ENDPOINT=https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent\n'
  } > "$APP_ROOT/.env.local"
  chmod 600 "$APP_ROOT/.env.local"
  printf 'Created a private configuration for this Mac (%s mode).\n' "$provider_mode"
else
  printf 'Keeping the existing private configuration in app/.env.local.\n'
fi

heading "Installing application dependencies"
cd "$APP_ROOT"
npm ci

heading "Verifying the application"
npm test
npm run build

heading "Setup complete"
printf 'Double-click “2 Start RUGS NSM.command” whenever you want to use the app.\n'
pause_for_user
