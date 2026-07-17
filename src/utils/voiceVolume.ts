const DEFAULT_VOICE_VOLUME = 0.6;

export function resolveVoiceVolume(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VOICE_VOLUME;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function voiceVolumePercent(value: string | number | null | undefined): number {
  return Math.round(resolveVoiceVolume(value) * 100);
}
