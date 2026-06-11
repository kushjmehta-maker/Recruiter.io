#!/usr/bin/env bash
# Install macOS launchd schedule for the daily job finder run.
# Runs at 08:30 local time every day. Logs to data/last_run.log.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="io.recruiter.linkedinfinder"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

# Locate the python interpreter inside the project venv if present, else fall back.
if [ -x "${PROJECT_DIR}/.venv/bin/python" ]; then
  PYTHON_BIN="${PROJECT_DIR}/.venv/bin/python"
else
  PYTHON_BIN="$(command -v python3)"
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "${PROJECT_DIR}/data"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_BIN}</string>
        <string>-m</string>
        <string>linkedin_finder</string>
        <string>daily</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>
    <key>StandardOutPath</key>
    <string>${PROJECT_DIR}/data/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_DIR}/data/launchd.err.log</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST

launchctl unload "${PLIST_PATH}" 2>/dev/null || true
launchctl load "${PLIST_PATH}"

echo "Installed: ${PLIST_PATH}"
echo "Will run daily at 08:30 local. View status:  launchctl list | grep ${LABEL}"
