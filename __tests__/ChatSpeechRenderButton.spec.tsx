import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { ChatSpeechRenderButton } from "../src/features/deiphobeSpeech/ChatSpeechRenderButton";

const TEST_ENDPOINT = "/debug/deiphobe_speech_render";
const AUDIO_URL = "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav";

function makeSuccessResponse(audio_url = AUDIO_URL) {
  return { rendered: true, status: "rendered", audio_url };
}

function makeFailureResponse(error = "Piper unavailable") {
  return { rendered: false, status: "failed", error };
}

function mockFetch(data: object) {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  } as any);
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ChatSpeechRenderButton", () => {
  const originalFetch = global.fetch;
  const originalActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let originalAudioPlayDescriptor: PropertyDescriptor | undefined;
  let originalMediaPlayDescriptor: PropertyDescriptor | undefined;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let playSpy: jest.Mock;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    originalAudioPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, "play");
    originalMediaPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
    playSpy = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLAudioElement.prototype, "play", {
      configurable: true,
      value: playSpy,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: playSpy,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    global.fetch = originalFetch;
    if (originalAudioPlayDescriptor) {
      Object.defineProperty(HTMLAudioElement.prototype, "play", originalAudioPlayDescriptor);
    }
    if (originalMediaPlayDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, "play", originalMediaPlayDescriptor);
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  function renderButton(props: {
    text?: string;
    voice_posture?: string;
    animation_state?: string;
    autoPlayAfterRender?: boolean;
  } = {}) {
    act(() => {
      root.render(
        <ChatSpeechRenderButton
          text={props.text ?? "I held the line."}
          voice_posture={props.voice_posture}
          animation_state={props.animation_state}
          renderEndpoint={TEST_ENDPOINT}
          autoPlayAfterRender={props.autoPlayAfterRender}
        />,
      );
    });
  }

  function getButton(): HTMLButtonElement {
    return container.querySelector("button[aria-label='Render speech']") as HTMLButtonElement;
  }

  function getAudio(): HTMLAudioElement | null {
    return container.querySelector("audio");
  }

  function getError(): string | null {
    const p = container.querySelector("p");
    return p?.textContent ?? null;
  }

  // ── no render on mount ────────────────────────────────────────────────────

  test("does not call fetch on initial render", () => {
    renderButton();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("no audio element on initial render", () => {
    renderButton();
    expect(getAudio()).toBeNull();
  });

  // ── render only after user click ──────────────────────────────────────────

  test("calls render bridge only after user clicks the button", async () => {
    mockFetch(makeSuccessResponse());
    renderButton();
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      TEST_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ── voice_posture preference ──────────────────────────────────────────────

  test("prefers voice_posture over animation_state in render request", async () => {
    mockFetch(makeSuccessResponse());
    renderButton({ voice_posture: "memory_recall", animation_state: "warm" });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("memory_recall");
  });

  test("uses animation_state when voice_posture is absent", async () => {
    mockFetch(makeSuccessResponse());
    renderButton({ animation_state: "warm" });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("warm");
  });

  test("falls back to neutral posture when neither voice_posture nor animation_state is provided", async () => {
    mockFetch(makeSuccessResponse());
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("neutral");
  });

  test("falls back to neutral posture when both voice_posture and animation_state are empty strings", async () => {
    mockFetch(makeSuccessResponse());
    act(() => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          voice_posture=""
          animation_state=""
          renderEndpoint={TEST_ENDPOINT}
        />,
      );
    });
    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("neutral");
  });

  // ── audio control appears only after successful render ────────────────────

  test("audio control appears after successful render", async () => {
    mockFetch(makeSuccessResponse(AUDIO_URL));
    renderButton();
    expect(getAudio()).toBeNull();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    const audio = getAudio();
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe(AUDIO_URL);
  });

  // ── no autoplay ───────────────────────────────────────────────────────────

  test("audio control has no autoplay attribute", async () => {
    mockFetch(makeSuccessResponse());
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(getAudio()?.hasAttribute("autoplay")).toBe(false);
  });

  // ── controlled autoplay gate ─────────────────────────────────────────────

  test("autoplay remains off by default even when pre-render succeeds", async () => {
    mockFetch(makeSuccessResponse(AUDIO_URL));
    renderButton({ autoPlayAfterRender: false, voice_posture: "memory_recall" });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  test("manual render does not autoplay even if autoplay is enabled", async () => {
    mockFetch(makeSuccessResponse(AUDIO_URL));
    renderButton({ autoPlayAfterRender: true, voice_posture: "memory_recall" });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  // ── bridge failure: text intact, safe error shown ─────────────────────────

  test("bridge failure shows error message and no audio element", async () => {
    mockFetch(makeFailureResponse("Piper unavailable"));
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(getAudio()).toBeNull();
    expect(getError()).toContain("Piper unavailable");
    expect(playSpy).not.toHaveBeenCalled();
  });

  test("network error shows error message and no audio element", async () => {
    global.fetch = jest.fn<typeof fetch>().mockRejectedValueOnce(
      new Error("Network error"),
    ) as any;
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(getAudio()).toBeNull();
    expect(getError()).toContain("Network error");
    expect(playSpy).not.toHaveBeenCalled();
  });

  // ── no avatar cue dispatched ──────────────────────────────────────────────

  test("does not dispatch avatar cue — fetch is called exactly once for render only", async () => {
    mockFetch(makeSuccessResponse());
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    // Exactly one fetch call: the render request. No secondary cue/animation call.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ── D5: autoPreRender prop ────────────────────────────────────────────────────

describe("ChatSpeechRenderButton — D5 auto pre-render", () => {
  const originalFetch = global.fetch;
  const originalActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let originalAudioPlayDescriptor: PropertyDescriptor | undefined;
  let originalMediaPlayDescriptor: PropertyDescriptor | undefined;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let playMock: jest.Mock;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    originalAudioPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, "play");
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
    if (originalAudioPlayDescriptor) {
      Object.defineProperty(HTMLAudioElement.prototype, "play", originalAudioPlayDescriptor);
    }
    if (originalMediaPlayDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, "play", originalMediaPlayDescriptor);
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  function renderButton(props: {
    text?: string;
    voice_posture?: string;
    animation_state?: string;
    autoPreRender?: boolean;
  } = {}) {
    act(() => {
      root.render(
        <ChatSpeechRenderButton
          text={props.text ?? "I held the line."}
          voice_posture={props.voice_posture}
          animation_state={props.animation_state}
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={props.autoPreRender}
        />,
      );
    });
  }

  function getAudio(): HTMLAudioElement | null {
    return container.querySelector("audio");
  }

  function getError(): string | null {
    return container.querySelector("p")?.textContent ?? null;
  }

  // ── setting off → no auto fetch ───────────────────────────────────────────

  test("setting disabled (autoPreRender=false) — no fetch on mount", () => {
    renderButton({ autoPreRender: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("omitting autoPreRender — no fetch on mount (default false)", () => {
    renderButton();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── setting on → one background render on mount ───────────────────────────

  test("setting enabled (autoPreRender=true) — fetch called once on mount", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          voice_posture="memory_recall"
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      TEST_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("setting enabled with autoplay — play is called after successful background pre-render", async () => {
    mockFetch(makeSuccessResponse(AUDIO_URL));
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          voice_posture="memory_recall"
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
          autoPlayAfterRender={true}
        />,
      );
      await flush();
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  // ── no autoplay ───────────────────────────────────────────────────────────

  test("auto-rendered audio has no autoplay attribute", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    const audio = getAudio();
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute("autoplay")).toBe(false);
    expect(playMock).not.toHaveBeenCalled();
  });

  test("play rejection shows safe status and keeps audio controls", async () => {
    playMock.mockRejectedValueOnce(new Error("blocked by browser"));
    mockFetch(makeSuccessResponse(AUDIO_URL));
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
          autoPlayAfterRender={true}
        />,
      );
      await flush();
      await flush();
    });
    expect(getAudio()).not.toBeNull();
    expect(container.textContent).toContain("Autoplay blocked by browser. Press play manually.");
  });

  // ── no avatar cue dispatch ────────────────────────────────────────────────

  test("auto pre-render fires exactly one fetch — no avatar cue dispatch", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── bridge failure leaves chat intact ────────────────────────────────────

  test("render bridge failure shows error — no audio, component still mounted", async () => {
    mockFetch(makeFailureResponse("Piper unavailable"));
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(getAudio()).toBeNull();
    expect(getError()).toContain("Piper unavailable");
    // Render speech button is still present
    expect(container.querySelector("button[aria-label='Render speech']")).not.toBeNull();
  });

  // ── duplicate prevention ──────────────────────────────────────────────────

  test("duplicate renders prevented — re-render does not fire a second fetch", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Re-render with same props (simulates parent re-render)
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── neutral fallback when metadata missing (autoPreRender) ───────────────

  test("autoPreRender sends posture neutral when no metadata is available", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="Hello."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("neutral");
  });

  // ── voice_posture preferred over animation_state ──────────────────────────

  test("voice_posture preferred over animation_state in auto pre-render request", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          voice_posture="memory_recall"
          animation_state="warm"
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("memory_recall");
  });

  // ── animation_state fallback ──────────────────────────────────────────────

  test("animation_state used as fallback when voice_posture absent", async () => {
    mockFetch(makeSuccessResponse());
    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="Searching now."
          animation_state="searching"
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
        />,
      );
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("searching");
  });
});
