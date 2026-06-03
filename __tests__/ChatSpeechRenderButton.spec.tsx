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
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    global.fetch = originalFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  function renderButton(props: {
    text?: string;
    voice_posture?: string;
    animation_state?: string;
  } = {}) {
    act(() => {
      root.render(
        <ChatSpeechRenderButton
          text={props.text ?? "I held the line."}
          voice_posture={props.voice_posture}
          animation_state={props.animation_state}
          renderEndpoint={TEST_ENDPOINT}
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

  test("uses empty posture when neither voice_posture nor animation_state is provided", async () => {
    mockFetch(makeSuccessResponse());
    renderButton();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("");
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
