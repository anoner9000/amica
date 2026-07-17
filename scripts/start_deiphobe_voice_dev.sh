#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AMICA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAWDAWG_ROOT="$(cd "$AMICA_ROOT/.." && pwd)"
AMICA_URL="http://127.0.0.1:3000"
BRIDGE_HEALTH_URL="http://127.0.0.1:8767/health"
ENV_FILE="$AMICA_ROOT/.env.local"
REQUIRED_ENV_VARS=(
  "NEXT_PUBLIC_DEVELOPMENT_BASE_URL=http://127.0.0.1:3000"
  "NEXT_PUBLIC_DEIPHOBE_SPEECH_DEBUG_BRIDGE_URL=http://127.0.0.1:8767/debug/deiphobe_speech_payload"
  "NEXT_PUBLIC_DEIPHOBE_SPEECH_RENDER_BRIDGE_URL=http://127.0.0.1:8767/debug/deiphobe_speech_render"
)

die() {
  echo "start_deiphobe_voice_dev: $*" >&2
  exit 1
}

check_http() {
  local url="$1"
  curl -fsS --max-time 2 "$url" >/dev/null 2>&1
}

require_environment() {
  [[ -d "$AMICA_ROOT" ]] || die "Amica root missing: $AMICA_ROOT"
  [[ -f "$ENV_FILE" ]] || die ".env.local missing: $ENV_FILE"

  for expected in "${REQUIRED_ENV_VARS[@]}"; do
    if ! grep -Fqx "$expected" "$ENV_FILE"; then
      die ".env.local is missing required URL: $expected"
    fi
  done
}

check_bridge() {
  if check_http "$BRIDGE_HEALTH_URL"; then
    echo "Bridge healthy: $BRIDGE_HEALTH_URL"
    return 0
  fi

  echo "WARNING: bridge missing or unhealthy: $BRIDGE_HEALTH_URL" >&2
  echo "WARNING: start the ClawDawg bridge separately before using Amica speech debug/render." >&2
  return 0
}

start_amica() {
  cd "$AMICA_ROOT"
  if check_http "$AMICA_URL"; then
    echo "Amica already appears to be running at $AMICA_URL."
    return 0
  fi

  echo "Starting Amica dev server..."
  exec npm run dev:deiphobe
}

main() {
  require_environment
  check_bridge
  echo "Amica env verified: $ENV_FILE"
  echo "Development base URL: http://127.0.0.1:3000"
  echo "Speech debug bridge URL: http://127.0.0.1:8767/debug/deiphobe_speech_payload"
  echo "Speech render bridge URL: http://127.0.0.1:8767/debug/deiphobe_speech_render"
  start_amica
}

main "$@"
