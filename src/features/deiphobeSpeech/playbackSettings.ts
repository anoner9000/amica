const DEFAULT_TTS_VOLUME = 0.6;
const LOCAL_PREFIX = "chatvrm_";

function readLocalConfig(key: string): string | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  return window.localStorage.getItem(`${LOCAL_PREFIX}${key}`);
}

export function readSpeechPlaybackMuted(): boolean {
  return readLocalConfig("tts_muted") === "true";
}

export function readSpeechPlaybackVolume(): number {
  const stored = readLocalConfig("tts_volume");
  const parsed = Number.parseFloat(stored ?? "");
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TTS_VOLUME;
  }
  return Math.min(1, Math.max(0, parsed));
}
