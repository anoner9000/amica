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
});
