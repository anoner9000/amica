import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const originalFetch = global.fetch;
const originalLocation = window.location;

function setWindowLocation(hostname: string, protocol = "http:", port = "3000") {
  Object.defineProperty(window, "location", {
    value: {
      hostname,
      protocol,
      port,
      origin: `${protocol}//${hostname}:${port}`,
    },
    writable: true,
    configurable: true,
  });
}

function restoreWindowLocation() {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
}

describe("callSpeechRenderBridge", () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreWindowLocation();
  });

  test("normalizes bridge-local audio_url for LAN-hosted mobile pages", async () => {
    setWindowLocation("192.168.1.81");
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        rendered: true,
        status: "rendered",
        audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav",
      }),
    } as any);

    const { callSpeechRenderBridge } = await import("../src/features/deiphobeSpeech/renderBridge");
    const result = await callSpeechRenderBridge(
      { text: "I held the line.", posture: "ordinary_chat" },
      "/api/deiphobeSpeech/debug/deiphobe_speech_render/",
    );

    expect(result.audio_url).toBe(
      "http://192.168.1.81:3000/api/deiphobeSpeech/debug/deiphobe_speech_audio/render.wav",
    );
  });

  test("accepts chunked render metadata and normalizes final stitched audio_url", async () => {
    setWindowLocation("192.168.1.81");
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        rendered: true,
        status: "rendered_chunked",
        render_mode: "chunked_file",
        chunk_count: 2,
        chunks: [
          { index: 0, text_sha256: "a", text_len: 12, preview_start: "Alabama, ", preview_end: "Alaska, " },
          { index: 1, text_sha256: "b", text_len: 12, preview_start: "Arizona.", preview_end: "Arizona." },
        ],
        timings_ms: {
          chunk_count: 2,
          chunk_render_ms_total: 42,
          per_chunk_render_ms: [20, 22],
        },
        audio_governor_action: "chunked_xtts_render",
        audio_governor_policy: {
          action: "chunk_xtts",
          requires_chunking_for_safe_xtts: true,
        },
        audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/states.wav",
      }),
    } as any);

    const { callSpeechRenderBridge } = await import("../src/features/deiphobeSpeech/renderBridge");
    const result = await callSpeechRenderBridge(
      { text: "Alabama, Alaska, Arizona.", posture: "ordinary_chat" },
      "/api/deiphobeSpeech/debug/deiphobe_speech_render/",
    );

    expect(result.render_mode).toBe("chunked_file");
    expect(result.chunk_count).toBe(2);
    expect(result.chunks?.[0]).not.toHaveProperty("text");
    expect(result.timings_ms?.per_chunk_render_ms).toEqual([20, 22]);
    expect(result.audio_governor_action).toBe("chunked_xtts_render");
    expect(result.audio_url).toBe(
      "http://192.168.1.81:3000/api/deiphobeSpeech/debug/deiphobe_speech_audio/states.wav",
    );
  });
});
