export const SPEECH_RENDER_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_RENDER_BRIDGE_URL ?? "/debug/deiphobe_speech_render";

export type SpeechRenderResult = {
  rendered: boolean;
  status: string;
  content_type?: string | null;
  bytes_received?: number | null;
  output_path?: string | null;
  error?: string | null;
  audio_url?: string | null;
  render_engine?: string | null;
};

function slugifyText(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "speech";
}

export function makeUniqueSpeechOutputFilename(prefix: string, text: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${slugifyText(text)}-${stamp}.wav`;
}

export function isDeiphobeSpeechRenderBridgeConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_RENDER_BRIDGE_URL);
}
