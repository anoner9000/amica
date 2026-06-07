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
  voice_profile?: string | null;
  render_mode?: "single_file" | "piper" | "smart_chunks" | null;
  fallback_used?: boolean | null;
};

export type SpeechRenderCallParams = {
  text: string;
  posture: string;
  operator_name?: string;
  private_mode?: boolean;
  include_render_request?: boolean;
  output_filename?: string;
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

export async function callSpeechRenderBridge(
  params: SpeechRenderCallParams,
  endpoint: string = SPEECH_RENDER_ENDPOINT,
): Promise<SpeechRenderResult> {
  const body = {
    text: params.text,
    posture: params.posture,
    operator_name: params.operator_name || undefined,
    private_mode: params.private_mode,
    include_render_request: params.include_render_request ?? true,
    output_filename: params.output_filename,
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (resp.status === 403) {
    throw new Error("Speech render bridge is disabled");
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text.trim() || `Speech render bridge request failed (${resp.status})`);
  }

  return resp.json() as Promise<SpeechRenderResult>;
}
