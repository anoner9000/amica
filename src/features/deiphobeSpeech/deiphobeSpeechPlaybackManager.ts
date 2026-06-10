import { readSpeechPlaybackMuted, readSpeechPlaybackVolume } from "./playbackSettings";
import type { LipSync } from "@/features/lipSync/lipSync";

export type DeiphobeSpeechPlaybackMode = "smart_chunks" | "single_file" | "piper" | "async_chunks" | "stream";

export type DeiphobeSpeechPlaybackMetadata = {
  render_engine?: string | null;
  profile?: string | null;
  endpoint?: string | null;
  mode: DeiphobeSpeechPlaybackMode;
  error_stage?: string | null;
  error_status?: number | null;
  error_detail?: string | null;
  fallback_used?: boolean;
  fallback_reason?: string | null;
  chunk_count?: number | null;
  chunk_status?: string | null;
  first_audio_latency_ms?: number | null;
  first_audio_chunk_latency_ms?: number | null;
  server_time_to_first_audio_chunk_ms?: number | null;
  total_render_ms?: number | null;
  total_stream_duration_ms?: number | null;
  stream_endpoint?: string | null;
  stream_chunk_count?: number | null;
  total_pcm_bytes?: number | null;
  batch_id?: string | null;
  instruct_hash?: string | null;
  render_mode?: string | null;
  selected_provider?: string | null;
  provider_latency_class?: string | null;
  provider_supports_streaming?: boolean | null;
};

export type DeiphobeSpeechPlaybackStatus =
  | "idle"
  | "ready"
  | "playing"
  | "complete"
  | "error";

export type DeiphobeSpeechPlaybackResult = {
  outcome: "complete" | "cancelled" | "blocked" | "error";
  error?: string;
};

type PlaybackOptions = {
  ownerId: string;
  lipSync?: LipSync;
  metadata?: DeiphobeSpeechPlaybackMetadata;
  onStatus?: (status: DeiphobeSpeechPlaybackStatus) => void;
};

type PlaybackQueueState = {
  urls: string[];
  closed: boolean;
  failedError?: string;
  waiters: Array<() => void>;
};

export type DeiphobeSpeechPlaybackQueue = {
  enqueueUrls: (urls: string[]) => void;
  close: () => void;
  fail: (error?: string) => void;
  result: Promise<DeiphobeSpeechPlaybackResult>;
};

let _sessionId = 0;
let _currentAudio: HTMLAudioElement | null = null;
let _volumePoller: ReturnType<typeof setInterval> | null = null;
let _currentLipSync: LipSync | null = null;
let _activeOwnerId: string | null = null;
let _activeMetadata: DeiphobeSpeechPlaybackMetadata | null = null;

function applyVolumeCurve(raw: number): number {
  return Math.pow(raw, 2);
}

function readCurrentVolume(): number {
  if (readSpeechPlaybackMuted()) return 0;
  return applyVolumeCurve(readSpeechPlaybackVolume());
}

function makeAudio(url: string): HTMLAudioElement {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = readCurrentVolume();
  audio.muted = readSpeechPlaybackMuted();
  return audio;
}

function startVolumePoller(): void {
  stopVolumePoller();
  _volumePoller = setInterval(() => {
    if (_currentAudio) {
      _currentAudio.volume = readCurrentVolume();
      _currentAudio.muted = readSpeechPlaybackMuted();
    }
  }, 100);
}

function stopVolumePoller(): void {
  if (_volumePoller !== null) {
    clearInterval(_volumePoller);
    _volumePoller = null;
  }
}

function resetLipSync(lipSync: LipSync | null): void {
  if (!lipSync) return;
  lipSync.stopCurrent();
  if (typeof (lipSync as LipSync & { reset?: () => void }).reset === "function") {
    (lipSync as LipSync & { reset: () => void }).reset();
  }
}

function cleanupPlayback(): void {
  stopVolumePoller();

  if (_currentAudio) {
    try {
      _currentAudio.pause();
    } catch (_) {
      // ignore
    }
    _currentAudio.src = "";
    _currentAudio = null;
  }

  if (_currentLipSync) {
    resetLipSync(_currentLipSync);
    _currentLipSync = null;
  }
}

function classifyPlaybackError(error: unknown): DeiphobeSpeechPlaybackResult {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("notallowed") || lowered.includes("blocked")) {
    return { outcome: "blocked", error: message };
  }
  return { outcome: "error", error: message };
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio fetch failed (${response.status})`);
  }
  return response.arrayBuffer();
}

function resolveQueueWaiters(state: PlaybackQueueState): void {
  const pending = state.waiters.splice(0, state.waiters.length);
  pending.forEach((resolve) => resolve());
}

async function takeNextUrl(
  state: PlaybackQueueState,
  mySessionId: number,
): Promise<{ kind: "url"; url: string } | { kind: "end" } | { kind: "error"; error: string }> {
  while (true) {
    if (_sessionId !== mySessionId) {
      return { kind: "end" };
    }
    const nextUrl = state.urls.shift();
    if (nextUrl) {
      return { kind: "url", url: nextUrl };
    }
    if (state.failedError) {
      return { kind: "error", error: state.failedError };
    }
    if (state.closed) {
      return { kind: "end" };
    }
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }
}

async function playWithLipSync(
  urls: string[],
  lipSync: LipSync,
  mySessionId: number,
): Promise<DeiphobeSpeechPlaybackResult> {
  if (lipSync.audio.state === "suspended") {
    try {
      await lipSync.audio.resume();
    } catch (_) {
      // ignore
    }
  }

  let prefetched: Promise<ArrayBuffer> = fetchBuffer(urls[0]);

  for (let index = 0; index < urls.length; index++) {
    if (_sessionId !== mySessionId) {
      return { outcome: "cancelled" };
    }

    let buffer: ArrayBuffer;
    try {
      buffer = await prefetched;
    } catch (error) {
      return classifyPlaybackError(error);
    }

    if (_sessionId !== mySessionId) {
      return { outcome: "cancelled" };
    }

    prefetched = index + 1 < urls.length
      ? fetchBuffer(urls[index + 1])
      : Promise.resolve(new ArrayBuffer(0));

    await new Promise<void>((resolve) => {
      lipSync.playFromArrayBuffer(buffer, resolve, readCurrentVolume()).catch(() => {
        resolve();
      });
    });
  }

  return { outcome: "complete" };
}

async function playQueueWithLipSync(
  state: PlaybackQueueState,
  lipSync: LipSync,
  mySessionId: number,
): Promise<DeiphobeSpeechPlaybackResult> {
  if (lipSync.audio.state === "suspended") {
    try {
      await lipSync.audio.resume();
    } catch (_) {
      // ignore
    }
  }

  while (true) {
    const next = await takeNextUrl(state, mySessionId);
    if (next.kind === "end") return { outcome: _sessionId === mySessionId ? "complete" : "cancelled" };
    if (next.kind === "error") return { outcome: "error", error: next.error };

    let buffer: ArrayBuffer;
    try {
      buffer = await fetchBuffer(next.url);
    } catch (error) {
      return classifyPlaybackError(error);
    }
    if (_sessionId !== mySessionId) {
      return { outcome: "cancelled" };
    }
    await new Promise<void>((resolve) => {
      lipSync.playFromArrayBuffer(buffer, resolve, readCurrentVolume()).catch(() => {
        resolve();
      });
    });
  }
}

async function playWithHtmlAudio(
  urls: string[],
  mySessionId: number,
): Promise<DeiphobeSpeechPlaybackResult> {
  startVolumePoller();

  let prefetched: HTMLAudioElement | null = makeAudio(urls[0]);

  for (let index = 0; index < urls.length; index++) {
    if (_sessionId !== mySessionId) {
      return { outcome: "cancelled" };
    }

    const audio = prefetched ?? makeAudio(urls[index]);
    audio.volume = readCurrentVolume();
    audio.muted = readSpeechPlaybackMuted();
    _currentAudio = audio;

    prefetched = index + 1 < urls.length ? makeAudio(urls[index + 1]) : null;

    const result = await new Promise<DeiphobeSpeechPlaybackResult>((resolve) => {
      const done = (finalResult: DeiphobeSpeechPlaybackResult) => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        if (_currentAudio === audio) {
          _currentAudio = null;
        }
        resolve(finalResult);
      };

      const handleEnded = () => done(_sessionId === mySessionId ? { outcome: "complete" } : { outcome: "cancelled" });
      const handleError = () => done({ outcome: "error", error: "audio playback failed" });

      audio.addEventListener("ended", handleEnded, { once: true });
      audio.addEventListener("error", handleError, { once: true });

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch((error) => {
          done(classifyPlaybackError(error));
        });
      }
    });

    if (result.outcome !== "complete") {
      return result;
    }
  }

  return { outcome: "complete" };
}

async function playQueueWithHtmlAudio(
  state: PlaybackQueueState,
  mySessionId: number,
): Promise<DeiphobeSpeechPlaybackResult> {
  startVolumePoller();

  while (true) {
    const next = await takeNextUrl(state, mySessionId);
    if (next.kind === "end") return { outcome: _sessionId === mySessionId ? "complete" : "cancelled" };
    if (next.kind === "error") return { outcome: "error", error: next.error };

    const audio = makeAudio(next.url);
    audio.volume = readCurrentVolume();
    audio.muted = readSpeechPlaybackMuted();
    _currentAudio = audio;

    const result = await new Promise<DeiphobeSpeechPlaybackResult>((resolve) => {
      const done = (finalResult: DeiphobeSpeechPlaybackResult) => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        if (_currentAudio === audio) {
          _currentAudio = null;
        }
        resolve(finalResult);
      };

      const handleEnded = () => done(_sessionId === mySessionId ? { outcome: "complete" } : { outcome: "cancelled" });
      const handleError = () => done({ outcome: "error", error: "audio playback failed" });

      audio.addEventListener("ended", handleEnded, { once: true });
      audio.addEventListener("error", handleError, { once: true });

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch((error) => {
          done(classifyPlaybackError(error));
        });
      }
    });

    if (result.outcome !== "complete") {
      return result;
    }
  }
}

export function stopDeiphobeSpeechPlayback(ownerId?: string): boolean {
  if (ownerId && _activeOwnerId !== ownerId) {
    return false;
  }
  _sessionId++;
  cleanupPlayback();
  _activeOwnerId = null;
  _activeMetadata = null;
  return true;
}

export function playDeiphobeSpeechUrls(
  urls: string[],
  options: PlaybackOptions,
): Promise<DeiphobeSpeechPlaybackResult> {
  const queue = createDeiphobeSpeechPlaybackQueue(options);
  if (urls.length === 0) {
    queue.close();
    return queue.result;
  }
  queue.enqueueUrls(urls);
  queue.close();
  return queue.result;
}

export function createDeiphobeSpeechPlaybackQueue(options: PlaybackOptions): DeiphobeSpeechPlaybackQueue {
  stopDeiphobeSpeechPlayback();

  const mySessionId = _sessionId;
  _activeOwnerId = options.ownerId;
  _activeMetadata = options.metadata ?? null;

  const state: PlaybackQueueState = {
    urls: [],
    closed: false,
    waiters: [],
  };

  if (options.lipSync) {
    _currentLipSync = options.lipSync;
  }

  options.onStatus?.("playing");

  const result = (async () => {
    const playbackResult = options.lipSync
      ? await playQueueWithLipSync(state, options.lipSync, mySessionId)
      : await playQueueWithHtmlAudio(state, mySessionId);

    if (_sessionId === mySessionId) {
      if (playbackResult.outcome === "complete") {
        options.onStatus?.("complete");
      } else if (playbackResult.outcome !== "cancelled") {
        options.onStatus?.("error");
      }
      cleanupPlayback();
      _activeOwnerId = null;
      _activeMetadata = null;
    }

    return playbackResult;
  })();

  return {
    enqueueUrls(urls: string[]) {
      if (urls.length === 0 || state.closed || _sessionId !== mySessionId) return;
      state.urls.push(...urls);
      resolveQueueWaiters(state);
    },
    close() {
      state.closed = true;
      resolveQueueWaiters(state);
    },
    fail(error?: string) {
      state.failedError = error ?? "audio playback failed";
      state.closed = true;
      resolveQueueWaiters(state);
    },
    result,
  };
}

export function getActiveDeiphobeSpeechOwnerId(): string | null {
  return _activeOwnerId;
}

export function getActiveDeiphobeSpeechMetadata(): DeiphobeSpeechPlaybackMetadata | null {
  return _activeMetadata;
}
