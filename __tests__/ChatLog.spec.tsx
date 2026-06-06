import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import type { config as ConfigFn } from "../src/utils/config";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

// jsdom does not implement scrollIntoView
(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();

// ── module mocks ─────────────────────────────────────────────────────────────

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("../src/features/deiphobeSpeech/smartChunkSpeech", () => ({
  callSmartChunkRender: jest.fn(),
  playSmartChunks: jest.fn(),
  stopSmartChunkPlayback: jest.fn(),
}));

jest.mock("file-saver", () => ({ saveAs: jest.fn() }));

jest.mock("../src/components/iconButton", () => ({
  IconButton: ({ onClick, label }: { onClick?: () => void; label?: string }) => (
    <button type="button" aria-label={label} onClick={onClick} />
  ),
}));

jest.mock("../src/components/flexTextarea/flexTextarea", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

jest.mock("../src/utils/chatDisplayName", () => ({
  getAssistantChatDisplayName: () => "Deiphobe",
}));

jest.mock("../src/utils/config", () => ({
  config: jest.fn().mockImplementation((key: string) => {
    if (key === "deiphobe_speech_chat_controls_enabled") return "true";
    return "false";
  }),
}));

jest.mock("../src/features/chat/chatContext", () => {
  const { createContext } = require("react");
  return {
    ChatContext: createContext({
      chat: {
        setMessageList: jest.fn(),
        receiveMessageFromUser: jest.fn(),
        bubbleMessage: jest.fn(),
      },
    }),
  };
});

jest.mock("../src/features/vrmViewer/viewerContext", () => {
  const { createContext } = require("react");
  return {
    ViewerContext: createContext({ viewer: { model: undefined, resetCameraLerp: () => {} } }),
  };
});

jest.mock("../src/features/vrmViewer/animationState", () => ({
  resolveAnimationStatePath: jest.fn<() => Promise<string>>().mockResolvedValue("/animations/Relax.vrma"),
  selectAnimationStateFromExpression: jest.fn().mockReturnValue(null),
  selectAnimationStateFromPayload: jest.fn().mockReturnValue(null),
}));

jest.mock("../src/lib/VRMAnimation/loadVRMAnimation", () => ({
  loadVRMAnimation: jest.fn().mockResolvedValue({}),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_ENDPOINT = "/debug/deiphobe_speech_render";
const AUDIO_URL = "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav";

type MsgPartial = {
  role: "assistant" | "user";
  content: string;
  voice_posture?: string;
  animation_state?: string;
};

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockFetchSuccess(audio_url = AUDIO_URL) {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ rendered: true, status: "rendered", audio_url }),
  } as any);
}

function mockFetchFailure(error = "Piper unavailable") {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ rendered: false, status: "failed", error }),
  } as any);
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("ChatLog — voice_posture plumbing", () => {
  const originalFetch = global.fetch;
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    global.fetch = originalFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(messages: MsgPartial[]) {
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
    });
  }

  function getRenderButton(): HTMLButtonElement | null {
    return container.querySelector("button[aria-label='Render speech']");
  }

  function getAudio(): HTMLAudioElement | null {
    return container.querySelector("audio");
  }

  function getError(): string | null {
    return container.querySelector("p.text-red-500")?.textContent ?? null;
  }

  // ── message parsing preserves voice_posture ───────────────────────────────

  test("voice_posture is forwarded to render request when present", async () => {
    mockFetchSuccess();
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    const btn = getRenderButton();
    expect(btn).not.toBeNull();
    await act(async () => {
      Simulate.click(btn!);
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("memory_recall");
  });

  // ── message parsing preserves animation_state ─────────────────────────────

  test("animation_state is used as fallback when voice_posture is absent", async () => {
    mockFetchSuccess();
    await renderChatLog([
      { role: "assistant", content: "Searching now.", animation_state: "searching" },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("searching");
  });

  // ── voice_posture preferred over animation_state ──────────────────────────

  test("voice_posture is preferred over animation_state when both are present", async () => {
    mockFetchSuccess();
    await renderChatLog([
      {
        role: "assistant",
        content: "I held the line.",
        voice_posture: "memory_recall",
        animation_state: "warm",
      },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("memory_recall");
  });

  // ── messages without metadata render normally ─────────────────────────────

  test("messages without metadata send posture neutral to the render bridge", async () => {
    mockFetchSuccess();
    await renderChatLog([
      { role: "assistant", content: "Hello." },
    ]);
    const btn = getRenderButton();
    expect(btn).not.toBeNull();
    await act(async () => {
      Simulate.click(btn!);
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("neutral");
    expect(body.text).toBe("Hello.");
  });

  // ── render remains manual only ────────────────────────────────────────────

  test("no fetch call on initial render — render is manual only", async () => {
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── no autoplay attribute ─────────────────────────────────────────────────

  test("audio element has no autoplay attribute after successful render", async () => {
    mockFetchSuccess(AUDIO_URL);
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    const audio = getAudio();
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute("autoplay")).toBe(false);
    expect(audio?.getAttribute("src")).toBe(AUDIO_URL);
  });

  test("manual re-render replaces stale audio with the newest response", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rendered: true,
          status: "rendered",
          audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/first.wav",
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rendered: true,
          status: "rendered",
          audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/second.wav",
        }),
      } as any);
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    const firstAudio = getAudio();
    expect(firstAudio?.getAttribute("src")).toMatch(/first\.wav$/);

    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    const secondAudio = getAudio();
    expect(secondAudio).not.toBeNull();
    expect(secondAudio).not.toBe(firstAudio);
    expect(secondAudio?.getAttribute("src")).toMatch(/second\.wav$/);
  });

  // ── bridge failure ────────────────────────────────────────────────────────

  test("bridge failure shows error and no audio element", async () => {
    mockFetchFailure("Piper unavailable");
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await flush();
    });
    expect(getAudio()).toBeNull();
    expect(getError()).toContain("Piper unavailable");
  });

  // ── user messages are unaffected ──────────────────────────────────────────

  test("user messages do not render a speech render button", async () => {
    await renderChatLog([
      { role: "user", content: "Hello there." },
    ]);
    expect(getRenderButton()).toBeNull();
  });
});

// ── D4: avatar cue button in ChatLog ─────────────────────────────────────────

describe("ChatLog — avatar cue button (D4)", () => {
  const originalFetch = global.fetch;
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    global.fetch = originalFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(messages: MsgPartial[]) {
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
    });
  }

  function getCueButton(): HTMLButtonElement | null {
    return container.querySelector("button[aria-label='Cue avatar']");
  }

  function getRenderButton(): HTMLButtonElement | null {
    return container.querySelector("button[aria-label='Render speech']");
  }

  // ── cue button present for assistant, absent for user ─────────────────────

  test("assistant messages show a cue avatar button", async () => {
    await renderChatLog([{ role: "assistant", content: "I held the line." }]);
    expect(getCueButton()).not.toBeNull();
  });

  test("user messages do not show a cue avatar button", async () => {
    await renderChatLog([{ role: "user", content: "Hello there." }]);
    expect(getCueButton()).toBeNull();
  });

  // ── model not ready when viewer.model is undefined ────────────────────────

  test("cue button is disabled when model is not ready (viewer.model is undefined in mock)", async () => {
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    const btn = getCueButton();
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
  });

  // ── no cue dispatch on mount ──────────────────────────────────────────────

  test("no cue dispatch on initial render", async () => {
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    // viewer.model is undefined in mock → handler is undefined → button disabled, no dispatch
    expect(getCueButton()?.disabled).toBe(true);
  });

  // ── render speech button does not dispatch avatar cue ─────────────────────

  test("clicking render speech button does not interact with cue button", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rendered: true, status: "rendered", audio_url: AUDIO_URL }),
    } as any);
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    await act(async () => {
      Simulate.click(getRenderButton()!);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Cue button remains disabled — model not ready, no cue dispatched
    expect(getCueButton()?.disabled).toBe(true);
    // Only one fetch call (the render, not a cue)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── no autoplay from cue button ───────────────────────────────────────────

  test("no audio element created by the cue avatar button", async () => {
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);
    // Cue button is disabled (model not ready) — clicking does nothing
    // No audio element should appear from the cue path
    expect(container.querySelector("audio")).toBeNull();
  });
});

// ── D5: setting-gated background pre-render ───────────────────────────────────

describe("ChatLog — D5 setting-gated pre-render", () => {
  const originalFetch = global.fetch;
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let originalPlayDescriptor: PropertyDescriptor | undefined;
  let originalMediaPlayDescriptor: PropertyDescriptor | undefined;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let playMock: jest.Mock;

  function getConfigMock() {
    return (require("../src/utils/config") as { config: typeof ConfigFn }).config as jest.Mock;
  }

  function setSpeechConfig(prerenderEnabled = false, autoplayEnabled = false) {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "true";
      if (key === "deiphobe_speech_prerender_enabled") {
        return prerenderEnabled ? "true" : "false";
      }
      if (key === "deiphobe_speech_autoplay_enabled") {
        return autoplayEnabled ? "true" : "false";
      }
      return "false";
    });
  }

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    setSpeechConfig(false, false);
    originalPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, "play");
    originalMediaPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
    playMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLAudioElement.prototype, "play", {
      configurable: true,
      value: playMock,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: playMock,
    });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    global.fetch = originalFetch;
    if (originalPlayDescriptor) {
      Object.defineProperty(HTMLAudioElement.prototype, "play", originalPlayDescriptor);
    }
    if (originalMediaPlayDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, "play", originalMediaPlayDescriptor);
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(
    messages: MsgPartial[],
    prerenderEnabled = false,
    autoplayEnabled = false,
  ) {
    setSpeechConfig(prerenderEnabled, autoplayEnabled);
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function getAudio(): HTMLAudioElement | null {
    return container.querySelector("audio");
  }

  // ── setting disabled → no auto fetch ─────────────────────────────────────

  test("setting disabled — no fetch fires on message arrival", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      false,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── setting enabled → one render per assistant message ────────────────────

  test("setting enabled — fetch fires once for assistant message on mount", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ rendered: true, status: "rendered", audio_url: AUDIO_URL }),
    } as any);
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── autoplay only when both settings are enabled ─────────────────────────

  test("setting enabled without autoplay — assistant message does not call play()", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ rendered: true, status: "rendered", audio_url: AUDIO_URL }),
    } as any);
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      false,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playMock).not.toHaveBeenCalled();
  });

  test("setting enabled with autoplay — assistant message calls play() after successful pre-render", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ rendered: true, status: "rendered", audio_url: AUDIO_URL }),
    } as any);
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  // ── user messages never pre-render ────────────────────────────────────────

  test("setting enabled — user messages do not trigger pre-render", async () => {
    await renderChatLog(
      [{ role: "user", content: "Hello there." }],
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("setting enabled — user messages never autoplay", async () => {
    await renderChatLog(
      [{ role: "user", content: "Hello there." }],
      true,
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();
  });

  // ── private_memory is not pre-rendered ───────────────────────────────────

  test("setting enabled — private_memory messages are not pre-rendered", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "This stays private.", voice_posture: "private_memory" }],
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("setting enabled — private_memory messages never autoplay", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "This stays private.", voice_posture: "private_memory" }],
      true,
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();
  });

  // ── no avatar cue from pre-render ─────────────────────────────────────────

  test("pre-render does not dispatch avatar cue — fetch called exactly once", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ rendered: true, status: "rendered", audio_url: AUDIO_URL }),
    } as any);
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("bridge failure does not autoplay", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ rendered: false, status: "failed", error: "Piper unavailable" }),
    } as any);
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    expect(playMock).not.toHaveBeenCalled();
    expect(getAudio()).toBeNull();
  });
});

// ── D6: smart-chunk autoplay ──────────────────────────────────────────────────

describe("ChatLog — D6 smart-chunk autoplay", () => {
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  // Typed accessors for the mocked smartChunkSpeech module.
  function getSmartMocks() {
    const mod = require("../src/features/deiphobeSpeech/smartChunkSpeech") as {
      callSmartChunkRender: jest.Mock;
      playSmartChunks: jest.Mock;
      stopSmartChunkPlayback: jest.Mock;
    };
    return mod;
  }

  function getConfigMock() {
    return (require("../src/utils/config") as { config: typeof ConfigFn }).config as jest.Mock;
  }

  function setSmartConfig(autoRender = false, autoPlay = false) {
    getConfigMock().mockImplementation((key: string) => {
      // Manual chat controls remain hidden in D6 tests.
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_render_enabled") return autoRender ? "true" : "false";
      if (key === "deiphobe_speech_auto_play_enabled") return autoPlay ? "true" : "false";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "true";
      return "false";
    });
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setSmartConfig(false, false);
    // Reset mocks between tests.
    const { callSmartChunkRender, playSmartChunks, stopSmartChunkPlayback } = getSmartMocks();
    callSmartChunkRender.mockReset();
    playSmartChunks.mockReset();
    stopSmartChunkPlayback.mockReset();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(messages: MsgPartial[], autoRender = false, autoPlay = false) {
    setSmartConfig(autoRender, autoPlay);
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const CHUNK_URLS = ["http://127.0.0.1:8771/audio/smart-00.wav", "http://127.0.0.1:8771/audio/smart-01.wav"];

  function mockRenderSuccess() {
    getSmartMocks().callSmartChunkRender.mockResolvedValueOnce({
      ok: true,
      audioUrls: CHUNK_URLS,
      chunkCount: CHUNK_URLS.length,
    });
  }

  function mockRenderFailure(error = "Server unavailable") {
    getSmartMocks().callSmartChunkRender.mockResolvedValueOnce({
      ok: false,
      audioUrls: [],
      chunkCount: 0,
      error,
    });
  }

  function mockPlayCompletes() {
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        onStatus("complete");
      },
    );
  }

  function getStatusText(): string | null {
    return container.querySelector("[aria-live='polite']")?.textContent ?? null;
  }

  function getStopButton(): HTMLButtonElement | null {
    return container.querySelector("button[aria-label='Stop voice']");
  }

  function getRenderButton(): HTMLButtonElement | null {
    return container.querySelector("button[aria-label='Render speech']");
  }

  // ── auto-render disabled → no fetch ──────────────────────────────────────

  test("auto-render disabled — callSmartChunkRender does not fire on mount", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      false,
    );
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
  });

  // ── auto-render enabled → fetch fires once ────────────────────────────────

  test("auto-render enabled — callSmartChunkRender fires once for newest assistant message", async () => {
    mockRenderSuccess();
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
    );
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledWith("I held the line.");
  });

  // ── auto-play disabled → play not called ─────────────────────────────────

  test("auto-play disabled — playSmartChunks not called even after successful render", async () => {
    mockRenderSuccess();
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      false,
    );
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().playSmartChunks).not.toHaveBeenCalled();
  });

  // ── auto-play enabled → play fires after render ───────────────────────────

  test("auto-play enabled — playSmartChunks called after successful render", async () => {
    mockRenderSuccess();
    mockPlayCompletes();
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().playSmartChunks).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().playSmartChunks).toHaveBeenCalledWith(CHUNK_URLS, expect.any(Function));
  });

  // ── private_memory excluded ───────────────────────────────────────────────

  test("private_memory — callSmartChunkRender does not fire", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "This stays private.", voice_posture: "private_memory" }],
      true,
      true,
    );
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(getSmartMocks().playSmartChunks).not.toHaveBeenCalled();
  });

  // ── user messages excluded ────────────────────────────────────────────────

  test("user messages — callSmartChunkRender does not fire", async () => {
    await renderChatLog(
      [{ role: "user", content: "Hello there." }],
      true,
      true,
    );
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(getSmartMocks().playSmartChunks).not.toHaveBeenCalled();
  });

  // ── new assistant message cancels previous ────────────────────────────────

  test("new assistant message arrival calls stopSmartChunkPlayback on the previous message", async () => {
    // First message: render hangs on play (never completes) so it stays in "playing" state.
    mockRenderSuccess();
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        // never resolves — simulates ongoing playback
        await new Promise(() => {});
      },
    );
    const msgA: MsgPartial = { role: "assistant", content: "First reply.", voice_posture: "neutral" };
    const msgB: MsgPartial = { role: "assistant", content: "Second reply.", voice_posture: "neutral" };

    setSmartConfig(true, true);
    const { ChatLog } = await import("../src/components/chatLog");

    // Render with only msgA — it becomes the newest, fires render+play.
    await act(async () => {
      root.render(<ChatLog messages={[msgA] as any} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledTimes(1);

    const stopMock = getSmartMocks().stopSmartChunkPlayback;
    stopMock.mockReset();

    // Add msgB — msgA loses "newest" status, msgB becomes newest.
    // Mock render for msgB so it doesn't throw.
    getSmartMocks().callSmartChunkRender.mockResolvedValueOnce({
      ok: true, audioUrls: [], chunkCount: 0,
    });
    await act(async () => {
      root.render(<ChatLog messages={[msgA, msgB] as any} />);
      await new Promise((r) => setTimeout(r, 0));
    });

    // stopSmartChunkPlayback must have been called when msgA lost newest status.
    expect(stopMock).toHaveBeenCalled();
  });

  // ── stop button visible while playing ────────────────────────────────────

  test("stop button is visible while Speaking and absent otherwise", async () => {
    mockRenderSuccess();
    // Play hangs so we can inspect the "playing" state.
    let resolvePlay: () => void;
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        await new Promise<void>((r) => { resolvePlay = r; });
        onStatus("complete");
      },
    );
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    // Status should be "playing" → stop button visible.
    expect(getStopButton()).not.toBeNull();
    expect(getStatusText()).toContain("Speaking");

    // Resolve play → status transitions to "complete", stop button disappears.
    await act(async () => {
      resolvePlay!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getStopButton()).toBeNull();
    expect(getStatusText()).toContain("Voice complete");
  });

  // ── stop button cancels playback ──────────────────────────────────────────

  test("clicking stop button calls stopSmartChunkPlayback and returns to Voice ready", async () => {
    mockRenderSuccess();
    let resolvePlay: () => void;
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        await new Promise<void>((r) => { resolvePlay = r; });
      },
    );
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    const stopBtn = getStopButton();
    expect(stopBtn).not.toBeNull();

    const stopMock = getSmartMocks().stopSmartChunkPlayback;
    stopMock.mockReset();

    await act(async () => {
      Simulate.click(stopBtn!);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(stopMock).toHaveBeenCalled();
    expect(getStatusText()).toContain("Voice ready");
    expect(getStopButton()).toBeNull();

    resolvePlay!(); // cleanup hanging promise
  });

  // ── failed render does not mutate text ───────────────────────────────────

  test("failed render shows Voice unavailable and leaves message text unchanged", async () => {
    mockRenderFailure("Server unavailable");
    const content = "I held the line.";
    await renderChatLog(
      [{ role: "assistant", content, voice_posture: "memory_recall" }],
      true,
    );
    // Text unchanged.
    expect(container.textContent).toContain(content);
    // Status shows error.
    expect(getStatusText()).toContain("Voice unavailable");
    // No play attempted.
    expect(getSmartMocks().playSmartChunks).not.toHaveBeenCalled();
  });

  // ── manual controls remain hidden ─────────────────────────────────────────

  test("manual render/cue buttons remain hidden when only smart-chunk config is enabled", async () => {
    mockRenderSuccess();
    await renderChatLog(
      [{ role: "assistant", content: "I held the line.", voice_posture: "memory_recall" }],
      true,
      true,
    );
    // deiphobe_speech_chat_controls_enabled is "false" in D6 config helper.
    expect(getRenderButton()).toBeNull();
    expect(container.querySelector("button[aria-label='Cue avatar']")).toBeNull();
  });

  // ── only newest assistant message renders ─────────────────────────────────

  test("with two assistant messages only the newest triggers callSmartChunkRender", async () => {
    // Provide two return values: one for the newest message only.
    getSmartMocks().callSmartChunkRender.mockResolvedValue({
      ok: true, audioUrls: [], chunkCount: 0,
    });
    const msgA: MsgPartial = { role: "assistant", content: "First reply.", voice_posture: "neutral" };
    const msgB: MsgPartial = { role: "assistant", content: "Second reply.", voice_posture: "neutral" };
    await renderChatLog([msgA, msgB], true);
    // Only one render call — for the newest (msgB).
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().callSmartChunkRender).toHaveBeenCalledWith("Second reply.");
  });
});
