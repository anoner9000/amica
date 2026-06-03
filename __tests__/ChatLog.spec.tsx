import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
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
