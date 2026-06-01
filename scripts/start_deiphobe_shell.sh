#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AMICA_URL="http://localhost:3000"
PIPER_CONTROL="$REPO_ROOT/scripts/piper_control.sh"

check_amica_running() {
  curl -fsS --max-time 2 "$AMICA_URL" >/dev/null 2>&1
}

echo "Amica repo: $REPO_ROOT"
cd "$REPO_ROOT"

if check_amica_running; then
  echo "Amica already appears to be running at $AMICA_URL."
else
  echo "Starting Amica dev server..."
fi

bash "$PIPER_CONTROL" start-detached

echo "Browser URL: $AMICA_URL"
echo "Settings: ChatBot Backend = Deiphobe | TTS Backend = Piper | Piper URL = http://127.0.0.1:5000/tts"

if check_amica_running; then
  echo "Amica is already up."
  exit 0
fi

echo "Running npm run dev..."
npm run dev
