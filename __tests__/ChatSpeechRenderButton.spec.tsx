import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { ChatSpeechRenderButton } from "../src/features/deiphobeSpeech/ChatSpeechRenderButton";

const TEST_ENDPOINT = "/debug/deiphobe_speech_render";
const AUDIO_URL = "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ChatSpeechRenderButton", () => {
  const originalFetch = global.fetch;
  const originalActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let originalAudioPlayDescriptor: PropertyDescriptor | undefined;
  let originalMediaPlayDescriptor: PropertyDescriptor | undefined;
  let originalAudioPauseDescriptor: PropertyDescriptor | undefined;
  let originalMediaPauseDescriptor: PropertyDescriptor | undefined;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let playSpy: jest.Mock;
  let pauseSpy: jest.Mock;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    originalAudioPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, "play");
    originalMediaPlayDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
    originalAudioPauseDescriptor = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, "pause");
    originalMediaPauseDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "pause");
    playSpy = jest.fn().mockResolvedValue(undefined);
    pauseSpy = jest.fn();
    Object.defineProperty(HTMLAudioElement.prototype, "play", {
      configurable: true,
      value: playSpy,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: playSpy,
    });
    Object.defineProperty(HTMLAudioElement.prototype, "pause", {
      configurable: true,
      value: pauseSpy,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: pauseSpy,
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
    if (originalAudioPauseDescriptor) {
      Object.defineProperty(HTMLAudioElement.prototype, "pause", originalAudioPauseDescriptor);
    }
    if (originalMediaPauseDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, "pause", originalMediaPauseDescriptor);
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  function renderButton(props: {
    text?: string;
    voice_posture?: string;
    animation_state?: string;
    autoPreRender?: boolean;
    autoPlayAfterRender?: boolean;
  } = {}) {
    act(() => {
      root.render(
        <ChatSpeechRenderButton
          text={props.text ?? "I held the line."}
          voice_posture={props.voice_posture}
          animation_state={props.animation_state}
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={props.autoPreRender}
          autoPlayAfterRender={props.autoPlayAfterRender}
          ownerId="msg-1"
        />,
      );
    });
  }

  function mockFetch(data: object) {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => data,
    } as any);
  }

  test("does not call fetch on initial render", () => {
    renderButton();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("manual render calls the bridge and keeps playback manager idle when autoplay is disabled", async () => {
    mockFetch({
      rendered: true,
      status: "rendered",
      audio_url: AUDIO_URL,
      render_engine: "piper",
      voice_profile: "deiphobe_voicedesign_v1",
      render_mode: "piper",
      timings_ms: { total_bridge_ms: 123, engine_render_ms: 100 },
    });
    renderButton({ voice_posture: "memory_recall", autoPlayAfterRender: false });

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("profile: deiphobe_voicedesign_v1 | mode: piper");
    expect(container.textContent).toContain("▶ Play voice");
  });

  test("manual play uses the shared playback path", async () => {
    mockFetch({
      rendered: true,
      status: "rendered",
      audio_url: AUDIO_URL,
      render_engine: "qwen3_tts",
      voice_profile: "deiphobe_voicedesign_v1",
      render_mode: "single_file",
    });
    renderButton({ voice_posture: "memory_recall" });

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });

    await act(async () => {
      Simulate.click(container.querySelector("button[type='button']")!);
      await flush();
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("play_state: Speaking…");
  });

  test("chunked render shows play control only after final audio_url without autoplay", async () => {
    mockFetch({
      rendered: true,
      status: "rendered_chunked",
      audio_url: AUDIO_URL,
      render_engine: "xtts",
      voice_profile: "deiphobe_xtts_current",
      render_mode: "chunked_file",
      chunk_count: 2,
      chunks: [
        { index: 0, text_sha256: "a", text_len: 8, preview_start: "Alabama", preview_end: "Alabama" },
        { index: 1, text_sha256: "b", text_len: 7, preview_start: "Alaska", preview_end: "Alaska" },
      ],
      audio_governor_action: "chunked_xtts_render",
    });
    renderButton({ voice_posture: "ordinary_chat", autoPlayAfterRender: false });

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("mode: chunked_file");
    expect(container.textContent).toContain("▶ Play voice");
  });

  test("auto-play uses the shared playback path after pre-render", async () => {
    mockFetch({
      rendered: true,
      status: "rendered",
      audio_url: AUDIO_URL,
      render_engine: "qwen3_tts",
      voice_profile: "deiphobe_voicedesign_v1",
      render_mode: "single_file",
    });

    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          voice_posture="memory_recall"
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
          autoPlayAfterRender={true}
          ownerId="msg-1"
        />,
      );
      await flush();
      await flush();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  test("autoplay blocked status is shown when playback is blocked", async () => {
    playSpy.mockRejectedValueOnce(new Error("NotAllowedError: blocked"));
    mockFetch({
      rendered: true,
      status: "rendered",
      audio_url: AUDIO_URL,
      render_engine: "qwen3_tts",
      voice_profile: "deiphobe_voicedesign_v1",
      render_mode: "single_file",
    });

    await act(async () => {
      root.render(
        <ChatSpeechRenderButton
          text="I held the line."
          renderEndpoint={TEST_ENDPOINT}
          autoPreRender={true}
          autoPlayAfterRender={true}
          ownerId="msg-1"
        />,
      );
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Autoplay blocked by browser. Press play manually.");
  });

  test("missing audio_url shows a clear error", async () => {
    mockFetch({
      rendered: true,
      status: "rendered",
      audio_url: null,
      render_engine: "qwen3_tts",
    });
    renderButton();

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });

    expect(container.textContent).toContain("Speech render succeeded without audio_url.");
  });
});
