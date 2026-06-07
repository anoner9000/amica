import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import type { config as ConfigFn } from "../src/utils/config";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("../src/features/deiphobeSpeech/smartChunkSpeech", () => ({
  callSmartChunkRender: jest.fn(),
  playSmartChunks: jest.fn(),
  stopSmartChunkPlayback: jest.fn(),
}));

jest.mock("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager", () => ({
  playDeiphobeSpeechUrls: jest.fn(),
  stopDeiphobeSpeechPlayback: jest.fn(),
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
    getSmartMocks().callSmartChunkRender.mockReset();
    getSmartMocks().playSmartChunks.mockReset();
    getSmartMocks().stopSmartChunkPlayback.mockReset();
    getPlaybackMock().playDeiphobeSpeechUrls.mockReset().mockResolvedValue({ outcome: "complete" });
    getPlaybackMock().stopDeiphobeSpeechPlayback.mockReset();
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
});
