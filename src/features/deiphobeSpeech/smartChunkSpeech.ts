/**
 * Smart-chunk speech render and sequential playback for Deiphobe VoiceDesign.
 * Dev-only. Does not affect chat content, reply text, or deiphobe_chat.py.
 */

import type { LipSync } from "@/features/lipSync/lipSync";
import {
  playDeiphobeSpeechUrls,
  stopDeiphobeSpeechPlayback,
  type DeiphobeSpeechPlaybackMetadata,
} from "./deiphobeSpeechPlaybackManager";
import { resolveHostAwareLocalUrl } from "@/utils/hostAwareUrl";

export type SmartChunkStatus =
  | "idle"
  | "rendering"
  | "ready"
  | "playing"
  | "complete"
  | "error";

export type SmartChunkChunkMeta = {
  index: number;
  render_engine?: string;
  voice_profile?: string;
  model_id?: string;
  render_mode?: string;
  batch_id?: string;
  instruct_hash?: string;
  instruct_preview?: string;
};

export type SmartChunkRenderResult = {
  ok: boolean;
  audioUrls: string[];
  chunkCount: number;
  renderEngine?: string;
  voiceProfile?: string;
  renderMode?: string;
  batchId?: string;
  instructHash?: string;
  endpoint: string;
  mode: "smart_chunks";
  chunkMeta?: SmartChunkChunkMeta[];
  error?: string;
};

const SMART_CHUNKS_ENDPOINT = resolveHostAwareLocalUrl(
  process.env.NEXT_PUBLIC_DEIPHOBE_SMART_CHUNKS_URL ??
  "http://127.0.0.1:8771/debug/render_smart_chunks",
);

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
      return {
        ok: false,
        audioUrls: [],
        chunkCount: 0,
        endpoint,
        mode: "smart_chunks",
        error: `HTTP ${resp.status}`,
      };
    }
    const data: {
      ok: boolean;
      engine?: string;
      render_engine?: string;
      voice_profile?: string;
      render_mode?: string;
      batch_id?: string;
      instruct_hash?: string;
      mode?: "smart_chunks";
      chunks?: Array<{
        audio_url: string;
        index?: number;
        render_engine?: string;
        voice_profile?: string;
        model_id?: string;
        render_mode?: string;
        batch_id?: string;
        instruct_hash?: string;
        instruct_preview?: string;
      }>;
      chunk_count?: number;
      error?: string;
    } = await resp.json();
    if (!data.ok) {
      return {
        ok: false,
        audioUrls: [],
        chunkCount: 0,
        renderEngine: data.render_engine ?? data.engine,
        voiceProfile: data.voice_profile ?? "deiphobe_voicedesign_v1",
        endpoint,
        mode: "smart_chunks",
        error: data.error ?? "render failed",
      };
    }
    const rawChunks = data.chunks ?? [];

    // Reject mixed-engine responses — never silently mix Qwen3 and other engines.
    const engines = new Set(rawChunks.map((c) => c.render_engine).filter(Boolean));
    if (engines.size > 1) {
      return {
        ok: false,
        audioUrls: [],
        chunkCount: 0,
        endpoint,
        mode: "smart_chunks",
        error: `mixed render_engine across chunks: ${[...engines].join(", ")}`,
      };
    }

    const audioUrls = rawChunks.map((c) => c.audio_url);
    const chunkMeta: SmartChunkChunkMeta[] = rawChunks.map((c, i) => ({
      index: c.index ?? i,
      render_engine: c.render_engine,
      voice_profile: c.voice_profile,
      model_id: c.model_id,
      render_mode: c.render_mode,
      batch_id: c.batch_id,
      instruct_hash: c.instruct_hash,
      instruct_preview: c.instruct_preview,
    }));
    return {
      ok: true,
      audioUrls,
      chunkCount: data.chunk_count ?? audioUrls.length,
      renderEngine: data.render_engine ?? data.engine ?? "qwen3_voice_design",
      voiceProfile: data.voice_profile ?? "deiphobe_voicedesign_v1",
      renderMode: data.render_mode,
      batchId: data.batch_id,
      instructHash: data.instruct_hash,
      endpoint,
      mode: "smart_chunks",
      chunkMeta,
    };
  } catch (err) {
    return {
      ok: false,
      audioUrls: [],
      chunkCount: 0,
      endpoint,
      mode: "smart_chunks",
      error: String(err),
    };
  }
}

export function stopSmartChunkPlayback(): void {
  stopDeiphobeSpeechPlayback();
}

// ── public API ────────────────────────────────────────────────────────────────

export async function playSmartChunks(
  audioUrls: string[],
  onStatus: (s: SmartChunkStatus) => void,
  lipSync?: LipSync,
  metadata?: DeiphobeSpeechPlaybackMetadata,
): Promise<void> {
  if (audioUrls.length === 0) {
    onStatus("complete");
    return;
  }
  await playDeiphobeSpeechUrls(audioUrls, {
    ownerId: metadata?.endpoint ?? "smart_chunks",
    lipSync,
    metadata,
    onStatus,
  });
}
