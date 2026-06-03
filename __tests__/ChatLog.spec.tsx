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
  config: jest.fn().mockReturnValue("false"),
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

  test("messages without metadata still render the button with empty posture", async () => {
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
    expect(body.posture).toBe("");
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
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  function getConfigMock() {
    return (require("../src/utils/config") as { config: typeof ConfigFn }).config as jest.Mock;
  }

  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    getConfigMock().mockReturnValue("false");
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    global.fetch = originalFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(messages: MsgPartial[], prerenderEnabled = false) {
    getConfigMock().mockReturnValue(prerenderEnabled ? "true" : "false");
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
      await new Promise((r) => setTimeout(r, 0));
    });
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

  // ── user messages never pre-render ────────────────────────────────────────

  test("setting enabled — user messages do not trigger pre-render", async () => {
    await renderChatLog(
      [{ role: "user", content: "Hello there." }],
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── private_memory is not pre-rendered ───────────────────────────────────

  test("setting enabled — private_memory messages are not pre-rendered", async () => {
    await renderChatLog(
      [{ role: "assistant", content: "This stays private.", voice_posture: "private_memory" }],
      true,
    );
    expect(global.fetch).not.toHaveBeenCalled();
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
});
