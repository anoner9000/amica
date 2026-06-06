/**
 * Smart-chunk speech render and sequential playback for Deiphobe VoiceDesign.
 * Dev-only. Does not affect chat content, reply text, or deiphobe_chat.py.
 */

import { readSpeechPlaybackMuted, readSpeechPlaybackVolume } from "./playbackSettings";

export type SmartChunkStatus =
  | "idle"
  | "rendering"
  | "ready"
  | "playing"
  | "complete"
  | "error";

export type SmartChunkRenderResult = {
  ok: boolean;
  audioUrls: string[];
  chunkCount: number;
  error?: string;
};

const SMART_CHUNKS_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SMART_CHUNKS_URL ??
  "http://127.0.0.1:8771/debug/render_smart_chunks";

// ── singleton session ─────────────────────────────────────────────────────────
// sessionId increments on every stop/new-play so stale async loops exit cleanly.
let _sessionId = 0;
let _currentAudio: HTMLAudioElement | null = null;
let _volumePoller: ReturnType<typeof setInterval> | null = null;

// Perceptual loudness: power-curve so mid-slider is actually mid-loudness.
function applyVolumeCurve(raw: number): number {
  return Math.pow(raw, 2);
}

function readCurrentVolume(): number {
  const muted = readSpeechPlaybackMuted();
  if (muted) return 0;
  return applyVolumeCurve(readSpeechPlaybackVolume());
}

function startVolumePoller(): void {
  stopVolumePoller();
  _volumePoller = setInterval(() => {
    if (_currentAudio) {
      _currentAudio.volume = readCurrentVolume();
    }
  }, 100);
}

function stopVolumePoller(): void {
  if (_volumePoller !== null) {
    clearInterval(_volumePoller);
    _volumePoller = null;
  }
}

export async function callSmartChunkRender(
  text: string,
  options: { endpoint?: string } = {},
): Promise<SmartChunkRenderResult> {
  const endpoint = options.endpoint ?? SMART_CHUNKS_ENDPOINT;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      return { ok: false, audioUrls: [], chunkCount: 0, error: `HTTP ${resp.status}` };
    }
    const data: {
      ok: boolean;
      chunks?: Array<{ audio_url: string }>;
      chunk_count?: number;
      error?: string;
    } = await resp.json();
    if (!data.ok) {
      return { ok: false, audioUrls: [], chunkCount: 0, error: data.error ?? "render failed" };
    }
    const audioUrls = (data.chunks ?? []).map((c) => c.audio_url);
    return { ok: true, audioUrls, chunkCount: data.chunk_count ?? audioUrls.length };
  } catch (err) {
    return { ok: false, audioUrls: [], chunkCount: 0, error: String(err) };
  }
}

export function stopSmartChunkPlayback(): void {
  _sessionId++;
  stopVolumePoller();
  if (_currentAudio) {
    try { _currentAudio.pause(); } catch (_) {}
    _currentAudio.src = "";
    _currentAudio = null;
  }
}

function _makeAudio(url: string): HTMLAudioElement {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = readCurrentVolume();
  return audio;
}

export async function playSmartChunks(
  audioUrls: string[],
  onStatus: (s: SmartChunkStatus) => void,
): Promise<void> {
  stopSmartChunkPlayback();
  const mySessionId = _sessionId;

  if (audioUrls.length === 0) {
    onStatus("complete");
    return;
  }

  onStatus("playing");
  startVolumePoller();

  // Pre-buffer the first chunk immediately so it's ready when the loop starts.
  let prefetched: HTMLAudioElement | null = _makeAudio(audioUrls[0]);

  for (let i = 0; i < audioUrls.length; i++) {
    if (_sessionId !== mySessionId) { stopVolumePoller(); return; }

    // Grab the pre-buffered element for this index (or create fresh on first iteration).
    const audio = prefetched ?? _makeAudio(audioUrls[i]);
    audio.volume = readCurrentVolume();
    _currentAudio = audio;

    // Start pre-buffering the next chunk while this one plays.
    prefetched = i + 1 < audioUrls.length ? _makeAudio(audioUrls[i + 1]) : null;

    await new Promise<void>((resolve) => {
      const done = () => {
        if (_currentAudio === audio) _currentAudio = null;
        resolve();
      };

      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(() => {
          // Browser rejected autoplay — treat as error but don't mutate text.
          onStatus("error");
          done();
        });
      }
    });
  }

  if (_sessionId === mySessionId) {
    stopVolumePoller();
    _currentAudio = null;
    onStatus("complete");
  }
}
