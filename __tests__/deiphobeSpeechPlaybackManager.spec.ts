import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

describe("deiphobeSpeechPlaybackManager", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("stopDeiphobeSpeechPlayback resets lip-sync for an active session", async () => {
    const manager = await import("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager");
    const endedCallbacks: Array<() => void> = [];
    const lipSync = {
      audio: { state: "running", resume: jest.fn() },
      analyser: {},
      playFromArrayBuffer: jest.fn(async (_buffer, onEnded?: () => void) => {
        if (onEnded) endedCallbacks.push(onEnded);
      }),
      stopCurrent: jest.fn(),
      reset: jest.fn(),
    } as any;

    const playbackPromise = manager.playDeiphobeSpeechUrls(
      ["http://127.0.0.1:8771/audio/smart-00.wav"],
      { ownerId: "msg-1", lipSync },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(manager.stopDeiphobeSpeechPlayback("msg-1")).toBe(true);
    expect(lipSync.stopCurrent).toHaveBeenCalled();
    expect(lipSync.reset).toHaveBeenCalled();

    endedCallbacks.forEach((cb) => cb());
    await playbackPromise;
  });

  test("completed playback resets lip-sync after the final chunk", async () => {
    const manager = await import("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager");
    const lipSync = {
      audio: { state: "running", resume: jest.fn() },
      analyser: {},
      playFromArrayBuffer: jest.fn(async (_buffer, onEnded?: () => void) => {
        onEnded?.();
      }),
      stopCurrent: jest.fn(),
      reset: jest.fn(),
    } as any;

    const result = await manager.playDeiphobeSpeechUrls(
      ["http://127.0.0.1:8771/audio/smart-00.wav", "http://127.0.0.1:8771/audio/smart-01.wav"],
      { ownerId: "msg-1", lipSync },
    );

    expect(result.outcome).toBe("complete");
    expect(lipSync.stopCurrent).toHaveBeenCalled();
    expect(lipSync.reset).toHaveBeenCalled();
  });

  test("failed playback resets lip-sync and reports an error", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any);
    const manager = await import("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager");
    const lipSync = {
      audio: { state: "running", resume: jest.fn() },
      analyser: {},
      playFromArrayBuffer: jest.fn(),
      stopCurrent: jest.fn(),
      reset: jest.fn(),
    } as any;

    const result = await manager.playDeiphobeSpeechUrls(
      ["http://127.0.0.1:8771/audio/smart-00.wav"],
      { ownerId: "msg-1", lipSync },
    );

    expect(result.outcome).toBe("error");
    expect(lipSync.stopCurrent).toHaveBeenCalled();
    expect(lipSync.reset).toHaveBeenCalled();
  });
});
