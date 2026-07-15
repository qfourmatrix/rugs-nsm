#!/bin/zsh

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

heading "RUGS NSM — Create Full Transfer Copy"

command -v git >/dev/null 2>&1 || die "Git is required to create clean update metadata for the recipient copy."
tracked_changes="$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=no)"
[[ -z "$tracked_changes" ]] || die "Commit or revert tracked app-code changes before creating a transfer copy."

if [[ "${RUGS_NONINTERACTIVE:-0}" == "1" ]]; then
  [[ -n "${RUGS_TRANSFER_DESTINATION:-}" ]] || die "Set RUGS_TRANSFER_DESTINATION for a non-interactive transfer test."
  selected_parent="$RUGS_TRANSFER_DESTINATION"
else
  selected_parent="$(osascript -e 'POSIX path of (choose folder with prompt "Choose the external drive or folder that should receive the RUGS NSM transfer copy")')" || exit 0
fi

selected_parent="${selected_parent%/}"
timestamp="$(date '+%Y-%m-%d %H%M%S')"
destination="$selected_parent/RUGS NSM Transfer $timestamp"

case "$destination/" in
  "$PROJECT_ROOT/"*) die "Choose a destination outside the current project folder." ;;
esac

printf 'Copying the complete working library to:\n%s\n\n' "$destination"
printf 'This can take several minutes because the current data library is large.\n'

git clone --quiet --no-hardlinks "$PROJECT_ROOT" "$destination"
source_remote="$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true)"
if [[ -n "$source_remote" ]]; then
  git -C "$destination" remote set-url origin "$source_remote"
else
  git -C "$destination" remote remove origin
fi

rsync -a \
  --exclude '.DS_Store' \
  --exclude '/.git/' \
  --exclude '/.runtime/' \
  --exclude '/app/node_modules/' \
  --exclude '/app/.env' \
  --exclude '/app/.env.local' \
  --exclude '/app/.env.*.local' \
  --exclude '/artifacts/dist/' \
  "$PROJECT_ROOT/" "$destination/"

cat > "$destination/START HERE.txt" <<'EOF'
RUGS NSM — START HERE

1. Copy this whole folder from the external drive into your Mac's Documents folder.
2. Control-click “1 First Setup.command” and choose Open.
3. When setup finishes, double-click “2 Start RUGS NSM.command”.
4. For future app updates, stop the running app and double-click “3 Update RUGS NSM.command”.

Your rugs, generated files, settings, and API key stay local and are not replaced by code updates.
EOF

heading "Transfer copy complete"
du -sh "$destination"
printf '\nThe copy includes the current code, rugs, source images, generated files, and project resources.\n'
printf 'Private API configuration, downloaded dependencies, and rebuildable output were intentionally excluded.\n'
printf 'The recipient should begin with “START HERE.txt”.\n'
pause_for_user
