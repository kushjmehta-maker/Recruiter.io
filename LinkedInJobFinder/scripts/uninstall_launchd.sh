#!/usr/bin/env bash
set -euo pipefail

LABEL="io.recruiter.linkedinfinder"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ -f "${PLIST_PATH}" ]; then
  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  rm "${PLIST_PATH}"
  echo "Removed ${PLIST_PATH}"
else
  echo "Not installed."
fi
