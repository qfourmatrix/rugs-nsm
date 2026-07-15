#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
exec "$SCRIPT_DIR/scripts/mac/setup.sh"
