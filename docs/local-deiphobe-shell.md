---
title: Local Deiphobe Shell
---

This launcher starts the local Amica + Deiphobe development shell and brings up the Piper shim if it is not already running.

## Setup

1. Make sure the Amica repo is available:
   ```bash
   cd ~/ClawDawg/amica
   ```

2. Create the local Piper virtualenv once:
   ```bash
   python3 -m venv .venv-piper
   source .venv-piper/bin/activate
   pip install piper-tts
   ```

3. Keep the default local voice:
   - `PIPER_MODEL=en_US-amy-medium`

## One-Command Startup

Preferred:
```bash
cd ~/ClawDawg/amica
npm run dev:deiphobe
```

Equivalent:
```bash
cd ~/ClawDawg/amica
bash scripts/start_deiphobe_shell.sh
```

What it does:
- Checks `http://127.0.0.1:5000/health`
- Starts the Piper shim on `http://127.0.0.1:5000` if needed
- Waits for Piper to become healthy before continuing
- Starts the Amica dev server
- Prints the browser URL: `http://localhost:3000`
- Leaves an existing Piper service alone
- Does not kill unrelated processes on port `5000`

## Piper Commands

Use these directly when you want to manage Piper without the full launcher:

```bash
npm run piper:health
npm run piper:start
npm run piper:smoke
npm run piper:stop
```

## Expected Settings

In the Amica UI:
- `ChatBot Backend = Deiphobe`
- `TTS Backend = Piper`
- `Piper URL = http://127.0.0.1:5000/tts`

SpeechT5 stays available as the fallback backend.

## Troubleshooting

### Port 5000 already in use
- Another Piper-compatible server is already running, or something else is bound to the port.
- The launcher will not kill it.
- If `npm run piper:health` passes, keep the server and reuse it.
- If it fails, check the diagnostic output from the launcher or run `npm run piper:stop` only for a stale `scripts/local_piper_server.py` process.

### `.venv-piper` is missing
- Create it first:
  ```bash
  cd ~/ClawDawg/amica
  python3 -m venv .venv-piper
  source .venv-piper/bin/activate
  pip install piper-tts
  ```

### Address already in use
- This usually means `scripts/local_piper_server.py` is already running on port `5000`.
- If `npm run piper:health` passes, do not start another copy.
- If the port is stale and unhealthy, stop only the `local_piper_server.py` process with `npm run piper:stop`.
- The known-good model is `en_US-amy-medium`.

### `npm run dev` is already running
- Stop the existing Amica dev server before starting the launcher again.
- The browser URL remains `http://localhost:3000`.

### Browser URL
- Open `http://localhost:3000`
