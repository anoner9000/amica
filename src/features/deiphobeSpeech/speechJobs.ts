import { resolveHostAwareLocalUrl } from "@/utils/hostAwareUrl";

export const DEIPHOBE_SPEECH_ASYNC_ENABLED =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_ASYNC_ENABLED === "true";

export const DEIPHOBE_SPEECH_ORCHESTRATOR_URL =
  resolveHostAwareLocalUrl(
    process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_ORCHESTRATOR_URL ?? "http://127.0.0.1:8767",
  );

export type DeiphobeSpeechJobMode = "async_chunks" | "stream" | "auto" | "smart_chunks";

function normalizeSpeechMode(value: string | undefined): DeiphobeSpeechJobMode {
  if (value === "stream" || value === "auto" || value === "async_chunks") {
    return value;
  }
  return "async_chunks";
}

export function readDeiphobeSpeechMode(): DeiphobeSpeechJobMode {
  return normalizeSpeechMode(process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_MODE);
}

export const DEIPHOBE_SPEECH_MODE = readDeiphobeSpeechMode();

export type SpeechAsyncErrorStage =
  | "create_job"
  | "poll_job"
  | "chunk_audio"
  | "playback"
  | "cancelled"
  | "disabled";

export type SpeechJobChunk = {
  index: number;
  status: "queued" | "rendering" | "ready" | "failed" | "cancelled" | "cache_hit";
  text: string;
  audio_url: string | null;
  duration_ms: number | null;
  cache_hit: boolean;
  error: string | null;
  voice_profile?: string | null;
};

export type SpeechJobState = {
  job_id: string;
  status: "queued" | "rendering" | "first_audio_ready" | "complete" | "failed" | "cancelled";
  render_engine: string;
  speech_mode: DeiphobeSpeechJobMode;
  stream_endpoint?: string | null;
  first_audio_chunk_latency_ms?: number | null;
  server_time_to_first_audio_chunk_ms?: number | null;
  total_stream_duration_ms?: number | null;
  stream_chunk_count?: number | null;
  total_pcm_bytes?: number | null;
  fallback_used?: boolean | null;
  fallback_reason?: string | null;
  chunks: SpeechJobChunk[];
  error: string | null;
  timing: {
    job_created_at: string;
    render_started_at: string | null;
    first_audio_ready_at: string | null;
    completed_at: string | null;
    first_audio_latency_ms: number | null;
    total_render_ms: number | null;
  };
};

export type CreateSpeechJobParams = {
  text: string;
  posture: string;
  operator_name?: string;
  private_mode?: boolean;
  engine?: "auto" | "xtts" | "qwen3_tts" | "piper";
  chunking?: boolean;
  speech_mode?: DeiphobeSpeechJobMode;
  provider?: string;
};

function buildEndpoint(path: string): string {
  return `${DEIPHOBE_SPEECH_ORCHESTRATOR_URL.replace(/\/+$/, "")}${path}`;
}

export class SpeechJobRequestError extends Error {
  stage: SpeechAsyncErrorStage;
  endpoint: string;
  status?: number;
  responseText?: string;

  constructor(
    stage: SpeechAsyncErrorStage,
    endpoint: string,
    message: string,
    options: { status?: number; responseText?: string } = {},
  ) {
    super(message);
    this.name = "SpeechJobRequestError";
    this.stage = stage;
    this.endpoint = endpoint;
    this.status = options.status;
    this.responseText = options.responseText;
  }
}

async function safeResponseText(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

export async function createSpeechJob(params: CreateSpeechJobParams): Promise<SpeechJobState> {
  const endpoint = buildEndpoint("/speech/jobs");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      posture: params.posture,
      operator_name: params.operator_name,
      private_mode: params.private_mode ?? false,
      engine: params.engine ?? "auto",
      chunking: params.chunking ?? true,
      ...(params.speech_mode ? { speech_mode: params.speech_mode } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
    }),
  });
  if (!response.ok) {
    const responseText = await safeResponseText(response);
    throw new SpeechJobRequestError(
      "create_job",
      endpoint,
      `speech job creation failed (${response.status})`,
      { status: response.status, responseText },
    );
  }
  return response.json() as Promise<SpeechJobState>;
}

export async function getSpeechJob(jobId: string): Promise<SpeechJobState> {
  const endpoint = buildEndpoint(`/speech/jobs/${jobId}`);
  const response = await fetch(endpoint);
  if (!response.ok) {
    const responseText = await safeResponseText(response);
    throw new SpeechJobRequestError(
      "poll_job",
      endpoint,
      `speech job fetch failed (${response.status})`,
      { status: response.status, responseText },
    );
  }
  return response.json() as Promise<SpeechJobState>;
}

export async function cancelSpeechJob(jobId: string): Promise<SpeechJobState> {
  const endpoint = buildEndpoint(`/speech/jobs/${jobId}/cancel`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const responseText = await safeResponseText(response);
    throw new SpeechJobRequestError(
      "cancelled",
      endpoint,
      `speech job cancel failed (${response.status})`,
      { status: response.status, responseText },
    );
  }
  return response.json() as Promise<SpeechJobState>;
}
