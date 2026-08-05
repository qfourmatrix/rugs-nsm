#!/bin/zsh

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

heading "RUGS NSM — Update"
require_local_node

app_is_running && die "The app is currently running. Stop its Terminal window with Control-C, then run Update again."
if ! git --version >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  die "macOS started the free Command Line Tools installer. Finish that installation, then run Update again. No GitHub account is required."
fi
git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "This transfer does not contain its update information. Contact the app owner."
git -C "$PROJECT_ROOT" remote get-url origin >/dev/null 2>&1 || die "The public update source has not been connected yet. Contact the app owner."

tracked_changes="$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=no)"
[[ -z "$tracked_changes" ]] || die "App code was changed locally on this Mac. Those changes must be saved or reverted before updating."

previous_commit="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
upstream_ref="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" || die "This copy is not connected to an approved update branch. Contact the app owner."

heading "Checking the approved update"
git -C "$PROJECT_ROOT" fetch --prune origin
candidate_commit="$(git -C "$PROJECT_ROOT" rev-parse "$upstream_ref")"
git -C "$PROJECT_ROOT" merge-base --is-ancestor "$previous_commit" "$candidate_commit" || die "The update is not a safe fast-forward. Nothing was changed. Contact the app owner."

if [[ "$previous_commit" == "$candidate_commit" ]]; then
  heading "Already up to date"
  printf 'No code or rug data was changed.\n'
  pause_for_user
  exit 0
fi

update_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/rugs-update.XXXXXX")"
candidate_dir="$update_temp_dir/candidate"
before_inventory="$update_temp_dir/catalog-before.json"
after_inventory="$update_temp_dir/catalog-after.json"
live_updated=0

cleanup_update() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ -d "$candidate_dir" ]]; then
    git -C "$PROJECT_ROOT" worktree remove --force "$candidate_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$update_temp_dir"
  if (( exit_status != 0 )) && [[ "$live_updated" == "1" ]]; then
    heading "Restoring the previous code"
    if git -C "$PROJECT_ROOT" reset --hard "$previous_commit" >/dev/null 2>&1; then
      printf 'The verified update could not be installed cleanly, so the app code was restored to %s.\n' "$previous_commit" >&2
    else
      printf 'WARNING: Automatic code rollback failed. Contact the app owner and report previous commit %s.\n' "$previous_commit" >&2
    fi
  fi
  exit "$exit_status"
}
trap cleanup_update EXIT
trap 'exit 130' INT TERM

node "$APP_ROOT/scripts/catalog-inventory.mjs" --output "$before_inventory"

heading "Testing the update in an isolated copy"
git -C "$PROJECT_ROOT" worktree add --detach "$candidate_dir" "$candidate_commit" >/dev/null
cd "$candidate_dir/app"
npm ci
npm test
npm run build

heading "Installing the verified update"
git -C "$PROJECT_ROOT" merge --ff-only "$candidate_commit"
live_updated=1

heading "Refreshing dependencies"
cd "$APP_ROOT"
npm ci

heading "Building the verified release"
npm run build

node "$APP_ROOT/scripts/catalog-inventory.mjs" --output "$after_inventory"
cmp -s "$before_inventory" "$after_inventory" || die "The catalog inventory changed during a code-only update. Stop here and contact the app owner. Previous code: $previous_commit"
live_updated=0

heading "Update complete"
printf 'Previous code: %s\n' "$previous_commit"
printf 'Current code:  %s\n' "$candidate_commit"
printf 'Your rugs, generated images, settings, and private API key were not replaced.\n'
printf 'You can now double-click “2 Start RUGS NSM.command”.\n'
pause_for_user
