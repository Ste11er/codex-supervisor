#!/usr/bin/env bash
# Render the codex-supervisor MCP entry for a DSH profile.
#
# Usage:
#   ./scripts/install-dsh.sh [profile]           # dry-run: print the rendered patch entry
#   ./scripts/install-dsh.sh [profile] --write   # append to the profile patch (with backup)
#
# The append requires write access to $DSH_HOME/profiles/<profile>/cordis.patch.yml,
# so run it outside the DSH sandbox (or approve the write). A DSH restart / profile
# reload is required before the mcp__codex_supervisor__* tools appear.
set -euo pipefail

PROFILE="${1:-web}"
MODE="${2:-}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO/dsh/cordis.patch.yml"
TARGET="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/cordis.patch.yml"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
sed "s#__REPO__#$REPO#g" "$TEMPLATE" > "$RENDERED"

echo "repo:    $REPO"
echo "profile: $PROFILE"
echo "target:  $TARGET"
echo
echo "rendered patch entry:"
echo "----------------------------------------"
cat "$RENDERED"
echo "----------------------------------------"
echo

if [[ "$MODE" == "--write" ]]; then
  if [[ ! -f "$TARGET" ]]; then
    echo "target not found: $TARGET" >&2
    echo "create the profile first, or pass the correct profile name" >&2
    exit 1
  fi
  BACKUP="$TARGET.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$TARGET" "$BACKUP"
  cat "$RENDERED" >> "$TARGET"
  echo "appended to $TARGET"
  echo "backup: $BACKUP"
  echo "restart DSH (or reload the profile) to load mcp__codex_supervisor__* tools"
else
  echo "dry-run only. Re-run with --write to append the entry with a backup."
fi
