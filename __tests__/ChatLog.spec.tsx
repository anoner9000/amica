import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import type { config as ConfigFn } from "../src/utils/config";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();

const mockSetMessageList = jest.fn();
const mockReceiveMessageFromUser = jest.fn();
const mockBubbleMessage = jest.fn();
const mockSendConversationControl = jest.fn<
  (control: { new_segment: boolean; continue_previous_segment: boolean }) => Promise<string>
>();
const mockAlertError = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("../src/features/deiphobeSpeech/smartChunkSpeech", () => ({
  callSmartChunkRender: jest.fn(),
  playSmartChunks: jest.fn(),
  stopSmartChunkPlayback: jest.fn(),
}));

jest.mock("../src/features/chat/deiphobeChat", () => ({
  sendDeiphobeConversationSegmentControl: mockSendConversationControl,
}));

jest.mock("../src/features/alert/alertContext", () => {
  const { createContext } = require("react");
  return {
    AlertContext: createContext({ alert: { error: mockAlertError } }),
  };
});

jest.mock("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager", () => ({
  playDeiphobeSpeechUrls: jest.fn(),
  stopDeiphobeSpeechPlayback: jest.fn(),
  createDeiphobeSpeechPlaybackQueue: jest.fn(),
}));

jest.mock("../src/features/deiphobeSpeech/speechJobs", () => ({
  DEIPHOBE_SPEECH_ASYNC_ENABLED: false,
  DEIPHOBE_SPEECH_MODE: "async_chunks",
  DEIPHOBE_SPEECH_ORCHESTRATOR_URL: "http://127.0.0.1:8767",
  readDeiphobeSpeechMode: jest.fn(() => "async_chunks"),
  createSpeechJob: jest.fn(),
  getSpeechJob: jest.fn(),
  cancelSpeechJob: jest.fn(),
}));

jest.mock("../src/features/deiphobeSpeech/speechProviderOptions", () => ({
  SPEECH_PROVIDER_OPTIONS: [
    { key: "xtts_stream", label: "Live Mode — XTTS Stream", provider: "xtts_stream", speech_mode: "stream", latency_class: "live", supports_streaming: true },
    { key: "qwen3_voicedesign", label: "Quality Mode — Qwen3 VoiceDesign", provider: "qwen3_voicedesign", speech_mode: "smart_chunks", latency_class: "slow_quality", supports_streaming: false },
    { key: "piper", label: "Fallback — Piper", provider: "piper", speech_mode: "async_chunks", latency_class: "fallback_fast", supports_streaming: false },
  ],
  SPEECH_PROVIDER_DEFAULT: "xtts_stream",
  findSpeechProviderOption: jest.fn((_key: string | null | undefined) => null),
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
    if (key === "chatbot_backend") return "deiphobe";
    if (key === "deiphobe_speech_chat_controls_enabled") return "true";
    return "false";
  }),
}));

jest.mock("../src/features/chat/chatContext", () => {
  const { createContext } = require("react");
  return {
    ChatContext: createContext({
      chat: {
        setMessageList: mockSetMessageList,
        receiveMessageFromUser: mockReceiveMessageFromUser,
        bubbleMessage: mockBubbleMessage,
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
}));

jest.mock("../src/lib/VRMAnimation/loadVRMAnimation", () => ({
  loadVRMAnimation: jest.fn().mockResolvedValue({}),
}));

type MsgPartial = {
  role: "assistant" | "user";
  content: string;
  voice_posture?: string;
  animation_state?: string;
};

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getConfigMock() {
  return (require("../src/utils/config") as { config: typeof ConfigFn }).config as jest.Mock;
}

function getSmartMocks() {
  return require("../src/features/deiphobeSpeech/smartChunkSpeech") as {
    callSmartChunkRender: jest.Mock;
    playSmartChunks: jest.Mock;
    stopSmartChunkPlayback: jest.Mock;
  };
}

function getPlaybackMock() {
  return require("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager") as {
    playDeiphobeSpeechUrls: jest.Mock;
    stopDeiphobeSpeechPlayback: jest.Mock;
    createDeiphobeSpeechPlaybackQueue: jest.Mock;
  };
}

function getSpeechJobsMock() {
  return require("../src/features/deiphobeSpeech/speechJobs") as {
    createSpeechJob: jest.Mock;
    getSpeechJob: jest.Mock;
    cancelSpeechJob: jest.Mock;
    readDeiphobeSpeechMode: jest.Mock;
  };
}

describe("ChatLog — Deiphobe speech playback", () => {
  const originalFetch = global.fetch;
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    mockSetMessageList.mockReset();
    mockReceiveMessageFromUser.mockReset();
    mockBubbleMessage.mockReset();
    mockSendConversationControl.mockReset().mockResolvedValue("I started a fresh conversation.");
    mockAlertError.mockReset();
    getSmartMocks().callSmartChunkRender.mockReset();
    getSmartMocks().playSmartChunks.mockReset();
    getSmartMocks().stopSmartChunkPlayback.mockReset();
    getPlaybackMock().playDeiphobeSpeechUrls.mockReset().mockResolvedValue({ outcome: "complete" });
    getPlaybackMock().stopDeiphobeSpeechPlayback.mockReset();
    getPlaybackMock().createDeiphobeSpeechPlaybackQueue.mockReset().mockReturnValue({
      enqueueUrls: jest.fn(),
      close: jest.fn(),
      fail: jest.fn(),
      result: Promise.resolve({ outcome: "complete" }),
    });
    getSpeechJobsMock().createSpeechJob.mockReset();
    getSpeechJobsMock().getSpeechJob.mockReset();
    getSpeechJobsMock().cancelSpeechJob.mockReset().mockResolvedValue({});
    getSpeechJobsMock().readDeiphobeSpeechMode.mockReset().mockReturnValue("async_chunks");
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
      await flush();
    });
  }

  test("Restart silently starts a fresh Deiphobe segment before clearing transient chat", async () => {
    await renderChatLog([
      { role: "user", content: "Keep the amber ring in mind." },
      { role: "assistant", content: "I will." },
    ]);

    const restart = container.querySelector("button[aria-label='Restart']");
    expect(restart).toBeTruthy();

    await act(async () => {
      Simulate.click(restart!);
      await flush();
    });

    expect(mockSendConversationControl).toHaveBeenCalledTimes(1);
    expect(mockSendConversationControl).toHaveBeenCalledWith({
      new_segment: true,
      continue_previous_segment: false,
    });
    expect(mockSetMessageList).toHaveBeenCalledTimes(1);
    expect(mockSetMessageList).toHaveBeenCalledWith([]);
    expect(mockReceiveMessageFromUser).not.toHaveBeenCalled();
    expect(mockBubbleMessage).not.toHaveBeenCalled();
    expect(mockAlertError).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(getSmartMocks().playSmartChunks).not.toHaveBeenCalled();
    expect(getPlaybackMock().playDeiphobeSpeechUrls).not.toHaveBeenCalled();
    expect(getSpeechJobsMock().createSpeechJob).not.toHaveBeenCalled();
  });

  test("Restart failure leaves the current chat visible and reports the failure", async () => {
    mockSendConversationControl.mockRejectedValueOnce(new Error("fresh segment unavailable"));
    await renderChatLog([
      { role: "user", content: "Current exchange remains usable." },
      { role: "assistant", content: "Still here." },
    ]);

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Restart']")!);
      await flush();
    });

    expect(mockSendConversationControl).toHaveBeenCalledTimes(1);
    expect(mockSetMessageList).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current exchange remains usable.");
    expect(container.textContent).toContain("Still here.");
    expect(mockAlertError).toHaveBeenCalledWith("Restart failed", "fresh segment unavailable");
    expect(mockReceiveMessageFromUser).not.toHaveBeenCalled();
    expect(mockBubbleMessage).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(getPlaybackMock().playDeiphobeSpeechUrls).not.toHaveBeenCalled();
  });

  test("manual render forwards voice_posture to the render bridge", async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rendered: true,
        status: "rendered",
        audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav",
        render_engine: "qwen3_tts",
        voice_profile: "deiphobe_voicedesign_v1",
        render_mode: "single_file",
      }),
    } as any);

    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Render speech']")!);
      await flush();
    });

    const [, init] = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.posture).toBe("memory_recall");
    expect(getPlaybackMock().playDeiphobeSpeechUrls).not.toHaveBeenCalled();
  });

  test("manual autoplay uses the shared playback manager and preserves metadata", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "true";
      if (key === "deiphobe_speech_prerender_enabled") return "true";
      if (key === "deiphobe_speech_autoplay_enabled") return "true";
      return "false";
    });
    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rendered: true,
        status: "rendered",
        audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav",
        render_engine: "piper",
        voice_profile: "deiphobe_voicedesign_v1",
        render_mode: "piper",
      }),
    } as any);

    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);

    expect(getPlaybackMock().playDeiphobeSpeechUrls).toHaveBeenCalledTimes(1);
    expect(getPlaybackMock().playDeiphobeSpeechUrls).toHaveBeenCalledWith(
      ["http://127.0.0.1:8767/debug/deiphobe_speech_audio/render.wav"],
      expect.objectContaining({
        metadata: expect.objectContaining({
          render_engine: "piper",
          profile: "deiphobe_voicedesign_v1",
          mode: "piper",
        }),
      }),
    );
    expect(container.textContent).toContain("speech_engine: piper");
    expect(container.textContent).toContain("speech_mode: piper");
  });

  test("smart-chunk autoplay uses the shared playback path and shows metadata", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_render_enabled") return "true";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "true";
      return "false";
    });
    getSmartMocks().callSmartChunkRender.mockResolvedValueOnce({
      ok: true,
      audioUrls: ["http://127.0.0.1:8771/audio/smart-00.wav"],
      chunkCount: 1,
      renderEngine: "qwen3_voice_design",
      voiceProfile: "deiphobe_voicedesign_v1",
      endpoint: "http://127.0.0.1:8771/debug/render_smart_chunks",
      mode: "smart_chunks",
    });
    getSmartMocks().playSmartChunks.mockResolvedValue(undefined);

    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "memory_recall" },
    ]);

    expect(getSmartMocks().playSmartChunks).toHaveBeenCalledWith(
      ["http://127.0.0.1:8771/audio/smart-00.wav"],
      expect.any(Function),
      undefined,
      expect.objectContaining({
        render_engine: "qwen3_voice_design",
        profile: "deiphobe_voicedesign_v1",
        mode: "smart_chunks",
      }),
    );
    expect(container.textContent).toContain("speech_engine: qwen3_voice_design");
    expect(container.textContent).toContain("speech_mode: smart_chunks");
  });

  test("new assistant reply cancels the previous smart-chunk voice", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_render_enabled") return "true";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "true";
      return "false";
    });
    getSmartMocks().callSmartChunkRender.mockResolvedValue({
      ok: true,
      audioUrls: ["http://127.0.0.1:8771/audio/smart-00.wav"],
      chunkCount: 1,
      renderEngine: "qwen3_voice_design",
      voiceProfile: "deiphobe_voicedesign_v1",
      endpoint: "http://127.0.0.1:8771/debug/render_smart_chunks",
      mode: "smart_chunks",
    });
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        await new Promise(() => {});
      },
    );

    const { ChatLog } = await import("../src/components/chatLog");
    const msgA: MsgPartial = { role: "assistant", content: "First reply.", voice_posture: "neutral" };
    const msgB: MsgPartial = { role: "assistant", content: "Second reply.", voice_posture: "neutral" };

    await act(async () => {
      root.render(<ChatLog messages={[msgA] as any} />);
      await flush();
    });

    getSmartMocks().stopSmartChunkPlayback.mockReset();

    await act(async () => {
      root.render(<ChatLog messages={[msgA, msgB] as any} />);
      await flush();
    });

    expect(getSmartMocks().stopSmartChunkPlayback).toHaveBeenCalled();
  });

  test("stop button resets the smart-chunk path back to ready", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_render_enabled") return "true";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "true";
      return "false";
    });
    getSmartMocks().callSmartChunkRender.mockResolvedValueOnce({
      ok: true,
      audioUrls: ["http://127.0.0.1:8771/audio/smart-00.wav"],
      chunkCount: 1,
      renderEngine: "qwen3_voice_design",
      voiceProfile: "deiphobe_voicedesign_v1",
      endpoint: "http://127.0.0.1:8771/debug/render_smart_chunks",
      mode: "smart_chunks",
    });
    getSmartMocks().playSmartChunks.mockImplementation(
      async (_urls: string[], onStatus: (s: string) => void) => {
        onStatus("playing");
        await new Promise(() => {});
      },
    );

    await renderChatLog([
      { role: "assistant", content: "Hello.", voice_posture: "neutral" },
    ]);

    await act(async () => {
      Simulate.click(container.querySelector("button[aria-label='Stop voice']")!);
      await flush();
    });

    expect(getSmartMocks().stopSmartChunkPlayback).toHaveBeenCalled();
    expect(container.textContent).toContain("Voice ready");
  });

  test("bridge auto-render is used when smart_chunks_enabled is false", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_render_enabled") return "true";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "false";
      return "false";
    });

    global.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rendered: true,
        status: "rendered",
        audio_url: "http://127.0.0.1:8767/debug/deiphobe_speech_audio/auto.wav",
        render_engine: "xtts",
        voice_profile: "deiphobe_xtts_v2",
        render_mode: "single_file",
      }),
    } as any);

    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "neutral" },
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(container.textContent).toContain("speech_engine: xtts");
    expect(container.textContent).toContain("speech_mode: single_file");
  });

  test("private_memory messages are excluded from background pre-render", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "true";
      if (key === "deiphobe_speech_prerender_enabled") return "true";
      if (key === "deiphobe_speech_auto_render_enabled") return "true";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      if (key === "deiphobe_speech_smart_chunks_enabled") return "false";
      return "false";
    });

    await renderChatLog([
      { role: "assistant", content: "This is private.", voice_posture: "private_memory" },
    ]);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(getSmartMocks().callSmartChunkRender).not.toHaveBeenCalled();
    expect(getSpeechJobsMock().createSpeechJob).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This is private.");
  });

  test("async mode off does not call /speech/jobs", async () => {
    await renderChatLog([
      { role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" },
    ]);

    expect(getSpeechJobsMock().createSpeechJob).not.toHaveBeenCalled();
  });
});
