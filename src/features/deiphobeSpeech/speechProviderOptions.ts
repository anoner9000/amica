import { config, updateConfig } from "@/utils/config";

export type SpeechProviderKey = "xtts_stream" | "qwen3_voicedesign" | "piper";

export type SpeechProviderOption = {
  key: SpeechProviderKey;
  label: string;
  provider: string;
  speech_mode: string;
  latency_class: string;
  supports_streaming: boolean;
};

export const SPEECH_PROVIDER_OPTIONS: readonly SpeechProviderOption[] = [
  {
    key: "xtts_stream",
    label: "Live Mode — XTTS Stream",
    provider: "xtts_stream",
    speech_mode: "stream",
    latency_class: "live",
    supports_streaming: true,
  },
  {
    key: "qwen3_voicedesign",
    label: "Quality Mode — Qwen3 VoiceDesign",
    provider: "qwen3_voicedesign",
    speech_mode: "smart_chunks",
    latency_class: "slow_quality",
    supports_streaming: false,
  },
  {
    key: "piper",
    label: "Fallback — Piper",
    provider: "piper",
    speech_mode: "async_chunks",
    latency_class: "fallback_fast",
    supports_streaming: false,
  },
];

const PROVIDER_CONFIG_KEY = "deiphobe_speech_provider";
export const SPEECH_PROVIDER_DEFAULT: SpeechProviderKey = "xtts_stream";

export function readSpeechProviderKey(): SpeechProviderKey {
  const value = config(PROVIDER_CONFIG_KEY);
  const found = SPEECH_PROVIDER_OPTIONS.find((opt) => opt.key === value);
  return found ? found.key : SPEECH_PROVIDER_DEFAULT;
}

export function writeSpeechProviderKey(key: SpeechProviderKey): void {
  updateConfig(PROVIDER_CONFIG_KEY, key);
}

export function getSpeechProviderOption(key: SpeechProviderKey): SpeechProviderOption {
  return SPEECH_PROVIDER_OPTIONS.find((opt) => opt.key === key) ?? SPEECH_PROVIDER_OPTIONS[0];
}

export function findSpeechProviderOption(key: string | null | undefined): SpeechProviderOption | null {
  if (!key) return null;
  return SPEECH_PROVIDER_OPTIONS.find((opt) => opt.key === key) ?? null;
}
