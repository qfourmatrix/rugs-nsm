#!/bin/zsh

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

heading "RUGS NSM — Update"
require_local_node

app_is_running && die "The app is currently running. Stop its Terminal window with Control-C, then run Update again."
command -v git >/dev/null 2>&1 || die "Git is not available on this Mac. Install GitHub Desktop, then run Update again."
git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "This transfer does not contain its update information. Contact the app owner."
git -C "$PROJECT_ROOT" remote get-url origin >/dev/null 2>&1 || die "The private GitHub update source has not been connected yet. Contact the app owner."

tracked_changes="$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=no)"
[[ -z "$tracked_changes" ]] || die "App code was changed locally on this Mac. Those changes must be saved or reverted before updating."

heading "Downloading the latest approved code"
git -C "$PROJECT_ROOT" pull --ff-only

heading "Refreshing dependencies"
cd "$APP_ROOT"
npm ci

heading "Checking the update"
npm test
npm run build

heading "Update complete"
printf 'Your rugs, generated images, settings, and private API key were not replaced.\n'
printf 'You can now double-click “2 Start RUGS NSM.command”.\n'
pause_for_user
