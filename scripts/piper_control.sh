#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PIPER_URL="http://127.0.0.1:5000"
PIPER_TTS_URL="$PIPER_URL/tts"
PIPER_HEALTH_URL="$PIPER_URL/health"
PIPER_VENV_PYTHON="$REPO_ROOT/.venv-piper/bin/python"
PIPER_SERVER_SCRIPT="$REPO_ROOT/scripts/local_piper_server.py"
PIPER_LOG_FILE="${PIPER_LOG_FILE:-/tmp/amica-piper.log}"
PIPER_MODEL="${PIPER_MODEL:-en_US-amy-medium}"
PIPER_PID=""

usage() {
  cat <<'EOF'
Usage: scripts/piper_control.sh <health|start|start-detached|stop|smoke>
EOF
}

check_piper_health() {
  curl -fsS --max-time 2 "$PIPER_HEALTH_URL" >/dev/null 2>&1
}

print_port_5000_diagnostics() {
  echo "Port 5000 diagnostics:"

  local printed=0

  if command -v ss >/dev/null 2>&1; then
    if ss -ltnp 2>/dev/null | grep ':5000' >/dev/null 2>&1; then
      ss -ltnp 2>/dev/null | grep ':5000' || true
      printed=1
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:5000 -sTCP:LISTEN >/dev/null 2>&1; then
      lsof -nP -iTCP:5000 -sTCP:LISTEN || true
      printed=1
    fi
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser -n tcp 5000 >/dev/null 2>&1; then
      fuser -n tcp 5000 || true
      printed=1
    fi
  fi

  if [[ "$printed" -eq 0 ]]; then
    echo "No port listing tool was available or the port was not visible in this environment."
  fi
}

ensure_prereqs() {
  if [[ ! -x "$PIPER_VENV_PYTHON" ]]; then
    cat <<EOF
Piper venv not found at .venv-piper.
Create it first:
  cd ~/ClawDawg/amica
  python3 -m venv .venv-piper
  source .venv-piper/bin/activate
  pip install piper-tts
EOF
    exit 1
  fi

  if [[ ! -f "$PIPER_SERVER_SCRIPT" ]]; then
    echo "Missing scripts/local_piper_server.py"
    exit 1
  fi
}

start_foreground() {
  if check_piper_health; then
    echo "Piper already responding on $PIPER_URL."
    exit 0
  fi

  ensure_prereqs
  echo "Starting local Piper shim on $PIPER_URL using PIPER_MODEL=$PIPER_MODEL..."
  exec "$PIPER_VENV_PYTHON" "$PIPER_SERVER_SCRIPT"
}

start_detached() {
  if check_piper_health; then
    echo "Piper already responding on $PIPER_URL."
    return 0
  fi

  ensure_prereqs

  : > "$PIPER_LOG_FILE"
  echo "Starting local Piper shim on $PIPER_URL using PIPER_MODEL=$PIPER_MODEL..."
  echo "Logging Piper output to $PIPER_LOG_FILE."
  (
    "$PIPER_VENV_PYTHON" "$PIPER_SERVER_SCRIPT"
  ) >>"$PIPER_LOG_FILE" 2>&1 &
  PIPER_PID=$!

  for _ in $(seq 1 20); do
    if check_piper_health; then
      echo "Piper is ready."
      return 0
    fi

    if ! kill -0 "$PIPER_PID" 2>/dev/null; then
      echo "Local Piper shim exited before becoming ready."
      print_port_5000_diagnostics
      return 1
    fi

    sleep 1
  done

  echo "Timed out waiting for Piper to become ready at $PIPER_HEALTH_URL."
  print_port_5000_diagnostics
  echo "Piper logs: $PIPER_LOG_FILE"
  return 1
}

stop_piper() {
  local pids=()

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(pgrep -f 'scripts/local_piper_server\.py' || true)

  if [[ "${#pids[@]}" -eq 0 ]]; then
    echo "No local_piper_server.py process found."
    return 0
  fi

  echo "Stopping local_piper_server.py process(es): ${pids[*]}"
  kill "${pids[@]}"
}

smoke_piper() {
  if ! check_piper_health; then
    echo "Piper is not healthy at $PIPER_HEALTH_URL." >&2
    exit 1
  fi

  local wav_file
  wav_file="$(mktemp /tmp/amica-piper-smoke.XXXXXX.wav)"
  trap "rm -f '$wav_file'" RETURN

  curl -fsS --max-time 5 "$PIPER_TTS_URL?text=hello" -o "$wav_file"
  file "$wav_file"
}

cmd="${1:-}"
case "$cmd" in
  health)
    if check_piper_health; then
      echo "Piper is healthy at $PIPER_HEALTH_URL."
    else
      echo "Piper is not healthy at $PIPER_HEALTH_URL." >&2
      exit 1
    fi
    ;;
  start)
    start_foreground
    ;;
  start-detached)
    start_detached
    ;;
  stop)
    stop_piper
    ;;
  smoke)
    smoke_piper
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
