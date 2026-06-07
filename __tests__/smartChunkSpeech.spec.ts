import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager", () => ({
  playDeiphobeSpeechUrls: jest.fn(),
  stopDeiphobeSpeechPlayback: jest.fn(),
}));

describe("smartChunkSpeech", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as any;
    const manager = require("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager") as {
      playDeiphobeSpeechUrls: jest.Mock;
      stopDeiphobeSpeechPlayback: jest.Mock;
    };
    manager.playDeiphobeSpeechUrls.mockReset().mockResolvedValue({ outcome: "complete" });
    manager.stopDeiphobeSpeechPlayback.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("playSmartChunks delegates playback to the shared manager", async () => {
    const { playSmartChunks } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const manager = require("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager") as {
      playDeiphobeSpeechUrls: jest.Mock;
    };

    const onStatus = jest.fn();
    const lipSync = { audio: {}, analyser: {} } as any;
    await playSmartChunks(
      ["http://127.0.0.1:8771/audio/smart-00.wav"],
      onStatus,
      lipSync,
      {
        render_engine: "qwen3_voice_design",
        profile: "deiphobe_voicedesign_v1",
        endpoint: "http://127.0.0.1:8771/debug/render_smart_chunks",
        mode: "smart_chunks",
      },
    );

    expect(manager.playDeiphobeSpeechUrls).toHaveBeenCalledWith(
      ["http://127.0.0.1:8771/audio/smart-00.wav"],
      expect.objectContaining({
        lipSync,
        metadata: expect.objectContaining({ mode: "smart_chunks" }),
        onStatus,
      }),
    );
  });

  test("callSmartChunkRender preserves render metadata from the server response", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        render_engine: "qwen3_voice_design",
        voice_profile: "deiphobe_voicedesign_v1",
        mode: "smart_chunks",
        chunk_count: 1,
        chunks: [{ audio_url: "http://127.0.0.1:8771/audio/smart-00.wav" }],
      }),
    } as any);

    const { callSmartChunkRender } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const result = await callSmartChunkRender("Hello.");

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        renderEngine: "qwen3_voice_design",
        voiceProfile: "deiphobe_voicedesign_v1",
        mode: "smart_chunks",
        endpoint: "http://127.0.0.1:8771/debug/render_smart_chunks",
      }),
    );
  });

  test("callSmartChunkRender preserves batch_id, instruct_hash, and render_mode", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        engine: "qwen3_voice_design",
        voice_profile: "deiphobe_voicedesign_v1",
        render_mode: "batch",
        batch_id: "smart-abc12345",
        instruct_hash: "abcd1234abcd1234",
        mode: "smart_chunks",
        chunk_count: 2,
        chunks: [
          {
            audio_url: "http://127.0.0.1:8771/audio/smart-abc12345-00.wav",
            render_engine: "qwen3_voice_design",
            voice_profile: "deiphobe_voicedesign_v1",
            render_mode: "batch",
            batch_id: "smart-abc12345",
            instruct_hash: "abcd1234abcd1234",
          },
          {
            audio_url: "http://127.0.0.1:8771/audio/smart-abc12345-01.wav",
            render_engine: "qwen3_voice_design",
            voice_profile: "deiphobe_voicedesign_v1",
            render_mode: "batch",
            batch_id: "smart-abc12345",
            instruct_hash: "abcd1234abcd1234",
          },
        ],
      }),
    } as any);

    const { callSmartChunkRender } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const result = await callSmartChunkRender("Hello there. How are you.");

    expect(result.ok).toBe(true);
    expect(result.renderMode).toBe("batch");
    expect(result.batchId).toBe("smart-abc12345");
    expect(result.instructHash).toBe("abcd1234abcd1234");
    expect(result.chunkCount).toBe(2);
    expect(result.audioUrls).toHaveLength(2);
  });

  test("callSmartChunkRender returns per-chunk metadata", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        engine: "qwen3_voice_design",
        voice_profile: "deiphobe_voicedesign_v1",
        render_mode: "batch",
        batch_id: "smart-xyz",
        instruct_hash: "hash0001",
        mode: "smart_chunks",
        chunk_count: 2,
        chunks: [
          {
            audio_url: "http://127.0.0.1:8771/audio/smart-xyz-00.wav",
            index: 0,
            render_engine: "qwen3_voice_design",
            voice_profile: "deiphobe_voicedesign_v1",
            model_id: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
            render_mode: "batch",
            batch_id: "smart-xyz",
            instruct_hash: "hash0001",
          },
          {
            audio_url: "http://127.0.0.1:8771/audio/smart-xyz-01.wav",
            index: 1,
            render_engine: "qwen3_voice_design",
            voice_profile: "deiphobe_voicedesign_v1",
            model_id: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
            render_mode: "batch",
            batch_id: "smart-xyz",
            instruct_hash: "hash0001",
          },
        ],
      }),
    } as any);

    const { callSmartChunkRender } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const result = await callSmartChunkRender("Chunk one. Chunk two.");

    expect(result.chunkMeta).toHaveLength(2);
    expect(result.chunkMeta![0]).toMatchObject({
      index: 0,
      render_engine: "qwen3_voice_design",
      voice_profile: "deiphobe_voicedesign_v1",
      batch_id: "smart-xyz",
      instruct_hash: "hash0001",
    });
    expect(result.chunkMeta![1]).toMatchObject({
      index: 1,
      instruct_hash: "hash0001",
    });
  });

  test("callSmartChunkRender rejects mixed render_engine across chunks", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        engine: "qwen3_voice_design",
        mode: "smart_chunks",
        chunk_count: 2,
        chunks: [
          {
            audio_url: "http://127.0.0.1:8771/audio/smart-00.wav",
            render_engine: "qwen3_voice_design",
          },
          {
            audio_url: "http://127.0.0.1:8767/audio/out.wav",
            render_engine: "piper",
          },
        ],
      }),
    } as any);

    const { callSmartChunkRender } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const result = await callSmartChunkRender("Mixed engine utterance.");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mixed render_engine/i);
    expect(result.audioUrls).toHaveLength(0);
  });

  test("callSmartChunkRender: all chunk instruct_hash values match the batch hash", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        engine: "qwen3_voice_design",
        render_mode: "batch",
        batch_id: "smart-consist",
        instruct_hash: "deadbeef1234",
        mode: "smart_chunks",
        chunk_count: 3,
        chunks: [0, 1, 2].map((i) => ({
          audio_url: `http://127.0.0.1:8771/audio/smart-consist-0${i}.wav`,
          render_engine: "qwen3_voice_design",
          voice_profile: "deiphobe_voicedesign_v1",
          batch_id: "smart-consist",
          instruct_hash: "deadbeef1234",
        })),
      }),
    } as any);

    const { callSmartChunkRender } = await import("../src/features/deiphobeSpeech/smartChunkSpeech");
    const result = await callSmartChunkRender("One. Two. Three.");

    expect(result.ok).toBe(true);
    expect(result.chunkMeta).toHaveLength(3);
    for (const chunk of result.chunkMeta!) {
      expect(chunk.instruct_hash).toBe(result.instructHash);
      expect(chunk.batch_id).toBe(result.batchId);
    }
  });
});
