/**
 * Smart-chunk speech render and sequential playback for Deiphobe VoiceDesign.
 * Dev-only. Does not affect chat content, reply text, or deiphobe_chat.py.
 */

import { readSpeechPlaybackMuted, readSpeechPlaybackVolume } from "./playbackSettings";
import type { LipSync } from "@/features/lipSync/lipSync";

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
let _currentLipSync: LipSync | null = null;

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
  if (_currentLipSync) {
    _currentLipSync.stopCurrent();
    _currentLipSync = null;
  }
}

function _makeAudio(url: string): HTMLAudioElement {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = readCurrentVolume();
  return audio;
}

async function _fetchBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  return resp.arrayBuffer();
}

// ── LipSync path ──────────────────────────────────────────────────────────────
// Routes audio through the model's AudioContext + AnalyserNode so the avatar
// mouth moves during playback. Requires CORS headers on the audio server
// (the Qwen3 VoiceDesign server already sets Access-Control-Allow-Origin: *).

async function _playWithLipSync(
  audioUrls: string[],
  onStatus: (s: SmartChunkStatus) => void,
  lipSync: LipSync,
  mySessionId: number,
): Promise<void> {
  // Resume AudioContext if the browser auto-suspended it.
  if (lipSync.audio.state === "suspended") {
    try { await lipSync.audio.resume(); } catch (_) {}
  }

  onStatus("playing");

  // Pre-fetch the first chunk immediately.
  let prefetched: Promise<ArrayBuffer> = _fetchBuffer(audioUrls[0]);

  for (let i = 0; i < audioUrls.length; i++) {
    if (_sessionId !== mySessionId) return;

    let buffer: ArrayBuffer;
    try {
      buffer = await prefetched;
    } catch {
      if (_sessionId === mySessionId) onStatus("error");
      return;
    }

    if (_sessionId !== mySessionId) return;

    // Pre-fetch next chunk while this one plays.
    prefetched = i + 1 < audioUrls.length
      ? _fetchBuffer(audioUrls[i + 1])
      : Promise.resolve(new ArrayBuffer(0));

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      lipSync.playFromArrayBuffer(buffer, done, readCurrentVolume()).catch(() => {
        if (_sessionId === mySessionId) onStatus("error");
        resolve();
      });
    });
  }

  if (_sessionId === mySessionId) {
    _currentLipSync = null;
    onStatus("complete");
  }
}

// ── HTML audio fallback ───────────────────────────────────────────────────────
// Used when no LipSync is available. No mouth movement, but audio still plays.

async function _playWithAudio(
  audioUrls: string[],
  onStatus: (s: SmartChunkStatus) => void,
  mySessionId: number,
): Promise<void> {
  onStatus("playing");
  startVolumePoller();

  let prefetched: HTMLAudioElement | null = _makeAudio(audioUrls[0]);

  for (let i = 0; i < audioUrls.length; i++) {
    if (_sessionId !== mySessionId) { stopVolumePoller(); return; }

    const audio = prefetched ?? _makeAudio(audioUrls[i]);
    audio.volume = readCurrentVolume();
    _currentAudio = audio;

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

// ── public API ────────────────────────────────────────────────────────────────

export async function playSmartChunks(
  audioUrls: string[],
  onStatus: (s: SmartChunkStatus) => void,
  lipSync?: LipSync,
): Promise<void> {
  stopSmartChunkPlayback();
  const mySessionId = _sessionId;

  if (audioUrls.length === 0) {
    onStatus("complete");
    return;
  }

  if (lipSync) {
    _currentLipSync = lipSync;
    await _playWithLipSync(audioUrls, onStatus, lipSync, mySessionId);
  } else {
    await _playWithAudio(audioUrls, onStatus, mySessionId);
  }
}
