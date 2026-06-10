import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

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
  createDeiphobeSpeechPlaybackQueue: jest.fn(),
}));

jest.mock("../src/features/deiphobeSpeech/speechJobs", () => ({
  SpeechJobRequestError: class SpeechJobRequestError extends Error {
    stage: string;
    endpoint: string;
    status?: number;
    responseText?: string;

    constructor(stage: string, endpoint: string, message: string, options: { status?: number; responseText?: string } = {}) {
      super(message);
      this.stage = stage;
      this.endpoint = endpoint;
      this.status = options.status;
      this.responseText = options.responseText;
    }
  },
  DEIPHOBE_SPEECH_ASYNC_ENABLED: true,
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
  findSpeechProviderOption: jest.fn((key: string | null | undefined) => {
    const map: Record<string, object> = {
      xtts_stream: { key: "xtts_stream", provider: "xtts_stream", speech_mode: "stream", latency_class: "live", supports_streaming: true },
      qwen3_voicedesign: { key: "qwen3_voicedesign", provider: "qwen3_voicedesign", speech_mode: "smart_chunks", latency_class: "slow_quality", supports_streaming: false },
      piper: { key: "piper", provider: "piper", speech_mode: "async_chunks", latency_class: "fallback_fast", supports_streaming: false },
    };
    return (key && key in map) ? map[key] : null;
  }),
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
    if (key === "deiphobe_speech_chat_controls_enabled") return "false";
    if (key === "deiphobe_speech_auto_play_enabled") return "false";
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
};

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfigMock() {
  return require("../src/utils/config").config as jest.Mock;
}

function getSpeechJobsMock() {
  return require("../src/features/deiphobeSpeech/speechJobs") as {
    SpeechJobRequestError: new (stage: string, endpoint: string, message: string, options?: { status?: number; responseText?: string }) => Error;
    createSpeechJob: jest.Mock;
    getSpeechJob: jest.Mock;
    cancelSpeechJob: jest.Mock;
    readDeiphobeSpeechMode: jest.Mock;
  };
}

function getPlaybackMock() {
  return require("../src/features/deiphobeSpeech/deiphobeSpeechPlaybackManager") as {
    createDeiphobeSpeechPlaybackQueue: jest.Mock;
    stopDeiphobeSpeechPlayback: jest.Mock;
  };
}

describe("ChatLog async Deiphobe speech", () => {
  const originalFetch = global.fetch;
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let debugSpy: jest.SpiedFunction<typeof console.debug>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockReset();
    getSpeechJobsMock().getSpeechJob.mockReset();
    getSpeechJobsMock().cancelSpeechJob.mockReset().mockResolvedValue({});
    getSpeechJobsMock().readDeiphobeSpeechMode.mockReset().mockReturnValue("async_chunks");
    getPlaybackMock().createDeiphobeSpeechPlaybackQueue.mockReset().mockReturnValue({
      enqueueUrls: jest.fn(),
      close: jest.fn(),
      fail: jest.fn(),
      result: Promise.resolve({ outcome: "complete" }),
    });
    getPlaybackMock().stopDeiphobeSpeechPlayback.mockReset();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    global.fetch = originalFetch;
    warnSpy.mockRestore();
    debugSpy.mockRestore();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  async function renderChatLog(messages: MsgPartial[]) {
    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={messages as any} />);
      await flush(80);
    });
  }

  test("async mode submits a speech job after the assistant reply appears", async () => {
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_1",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_1",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [
        {
          index: 0,
          status: "ready",
          text: "I held the line.",
          audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_1/chunks/0.wav",
          duration_ms: 10,
          cache_hit: false,
          error: null,
          voice_profile: "deiphobe_xtts_current",
        },
      ],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 10,
        total_render_ms: 20,
      },
    });

    await renderChatLog([{ role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ text: "I held the line.", posture: "ordinary_chat", speech_mode: "async_chunks" }),
    );
    expect(getSpeechJobsMock().getSpeechJob).toHaveBeenCalledWith("speech_job_1");
    expect(container.textContent).toContain("I held the line.");
    expect(container.textContent).toContain("speech_mode: async_chunks");
    expect(container.textContent).toContain("first_audio_latency_ms: 10");
    expect(container.textContent).toContain("total_render_ms: 20");
  });

  test("async mode does not autoplay when the existing auto-play setting is disabled", async () => {
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_2",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_2",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [
        {
          index: 0,
          status: "ready",
          text: "I held the line.",
          audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_2/chunks/0.wav",
          duration_ms: 10,
          cache_hit: false,
          error: null,
          voice_profile: "deiphobe_xtts_current",
        },
      ],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 10,
        total_render_ms: 20,
      },
    });

    await renderChatLog([{ role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" }]);

    expect(getPlaybackMock().createDeiphobeSpeechPlaybackQueue).not.toHaveBeenCalled();
  });

  test("stream mode submits speech_mode stream after the assistant reply appears", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      return "false";
    });
    const queue = {
      enqueueUrls: jest.fn(),
      close: jest.fn(),
      fail: jest.fn(),
      result: Promise.resolve({ outcome: "complete" }),
    };
    getPlaybackMock().createDeiphobeSpeechPlaybackQueue.mockReturnValue(queue);
    getSpeechJobsMock().readDeiphobeSpeechMode.mockReturnValue("stream");
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_stream_1",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "stream",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_stream_1",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "stream",
      stream_endpoint: "http://127.0.0.1:8784/render_stream",
      first_audio_chunk_latency_ms: 660,
      server_time_to_first_audio_chunk_ms: 644,
      total_stream_duration_ms: 1531,
      stream_chunk_count: 4,
      total_pcm_bytes: 1234,
      fallback_used: false,
      fallback_reason: null,
      chunks: [
        {
          index: 0,
          status: "ready",
          text: "I held the line.",
          audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_stream_1/chunks/0.wav",
          duration_ms: 1531,
          cache_hit: false,
          error: null,
          voice_profile: "deiphobe_xtts_current",
        },
      ],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 660,
        total_render_ms: 1531,
      },
    });

    await renderChatLog([{ role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ speech_mode: "stream" }),
    );
    expect(container.textContent).toContain("speech_mode: stream");
    expect(container.textContent).toContain("stream_endpoint: http://127.0.0.1:8784/render_stream");
    expect(container.textContent).toContain("first_audio_chunk_latency_ms: 660");
    expect(container.textContent).toContain("server_time_to_first_audio_chunk_ms: 644");
    expect(container.textContent).toContain("total_stream_duration_ms: 1531");
    expect(container.textContent).toContain("stream_chunk_count: 4");
    expect(container.textContent).toContain("total_pcm_bytes: 1234");
    expect(container.textContent).toContain("fallback_used: false");
    expect(queue.enqueueUrls).toHaveBeenCalledWith([
      "http://127.0.0.1:8767/speech/jobs/speech_job_stream_1/chunks/0.wav",
    ]);
  });

  test("stream fallback metadata displays when backend reports fallback", async () => {
    getSpeechJobsMock().readDeiphobeSpeechMode.mockReturnValue("stream");
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_stream_2",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "stream",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_stream_2",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      stream_endpoint: null,
      first_audio_chunk_latency_ms: null,
      server_time_to_first_audio_chunk_ms: null,
      total_stream_duration_ms: null,
      stream_chunk_count: null,
      total_pcm_bytes: null,
      fallback_used: true,
      fallback_reason: "stream failed",
      chunks: [
        {
          index: 0,
          status: "ready",
          text: "I held the line.",
          audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_stream_2/chunks/0.wav",
          duration_ms: 10,
          cache_hit: false,
          error: null,
          voice_profile: "deiphobe_xtts_current",
        },
      ],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 10,
        total_render_ms: 20,
      },
    });

    await renderChatLog([{ role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" }]);

    expect(container.textContent).toContain("speech_mode: async_chunks");
    expect(container.textContent).toContain("fallback_used: true");
    expect(container.textContent).toContain("fallback_reason: stream failed");
  });

  test("async mode autoplay enqueues ready chunks when the existing auto-play setting is enabled", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      return "false";
    });
    const queue = {
      enqueueUrls: jest.fn(),
      close: jest.fn(),
      fail: jest.fn(),
      result: Promise.resolve({ outcome: "complete" }),
    };
    getPlaybackMock().createDeiphobeSpeechPlaybackQueue.mockReturnValue(queue);
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_3",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob
      .mockResolvedValueOnce({
        job_id: "speech_job_3",
        status: "first_audio_ready",
        render_engine: "xtts",
        speech_mode: "async_chunks",
        chunks: [
          {
            index: 0,
            status: "ready",
            text: "I held the line.",
            audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_3/chunks/0.wav",
            duration_ms: 10,
            cache_hit: false,
            error: null,
            voice_profile: "deiphobe_xtts_current",
          },
        ],
        error: null,
        timing: {
          job_created_at: "t0",
          render_started_at: "t1",
          first_audio_ready_at: "t2",
          completed_at: null,
          first_audio_latency_ms: 10,
          total_render_ms: null,
        },
      })
      .mockResolvedValueOnce({
        job_id: "speech_job_3",
        status: "complete",
        render_engine: "xtts",
        speech_mode: "async_chunks",
        chunks: [
          {
            index: 0,
            status: "ready",
            text: "I held the line.",
            audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_3/chunks/0.wav",
            duration_ms: 10,
            cache_hit: false,
            error: null,
            voice_profile: "deiphobe_xtts_current",
          },
          {
            index: 1,
            status: "ready",
            text: "I am here.",
            audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_3/chunks/1.wav",
            duration_ms: 10,
            cache_hit: false,
            error: null,
            voice_profile: "deiphobe_xtts_current",
          },
        ],
        error: null,
        timing: {
          job_created_at: "t0",
          render_started_at: "t1",
          first_audio_ready_at: "t2",
          completed_at: "t3",
          first_audio_latency_ms: 10,
          total_render_ms: 25,
        },
      });

    await renderChatLog([{ role: "assistant", content: "I held the line. I am here.", voice_posture: "ordinary_chat" }]);
    await act(async () => {
      await flush(120);
    });

    expect(getPlaybackMock().createDeiphobeSpeechPlaybackQueue).toHaveBeenCalled();
    expect(queue.enqueueUrls).toHaveBeenCalledWith([
      "http://127.0.0.1:8767/speech/jobs/speech_job_3/chunks/0.wav",
    ]);
    expect(queue.enqueueUrls).toHaveBeenCalledWith([
      "http://127.0.0.1:8767/speech/jobs/speech_job_3/chunks/1.wav",
    ]);
    expect(queue.close).toHaveBeenCalled();
  });

  test("new user message cancels the previous async speech job", async () => {
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_4",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_4",
      status: "rendering",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: null,
        completed_at: null,
        first_audio_latency_ms: null,
        total_render_ms: null,
      },
    });

    const { ChatLog } = await import("../src/components/chatLog");
    await act(async () => {
      root.render(<ChatLog messages={[{ role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" }] as any} />);
      await flush(60);
    });
    await act(async () => {
      root.render(<ChatLog messages={[
        { role: "assistant", content: "I held the line.", voice_posture: "ordinary_chat" },
        { role: "user", content: "Wait.", voice_posture: "ordinary_chat" },
      ] as any} />);
      await flush(60);
    });

    expect(getSpeechJobsMock().cancelSpeechJob).toHaveBeenCalledWith("speech_job_4");
  });

  test("playback fetch failure keeps async metadata and reports playback stage", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "true";
      return "false";
    });
    const queue = {
      enqueueUrls: jest.fn(),
      close: jest.fn(),
      fail: jest.fn(),
      result: Promise.resolve({ outcome: "error", error: "Failed to fetch" }),
    };
    getPlaybackMock().createDeiphobeSpeechPlaybackQueue.mockReturnValue(queue);
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_6",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_6",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [
        {
          index: 0,
          status: "ready",
          text: "Hi, Uther Pendragon.",
          audio_url: "http://127.0.0.1:8767/speech/jobs/speech_job_6/chunks/0.wav",
          duration_ms: 10,
          cache_hit: false,
          error: null,
          voice_profile: "deiphobe_xtts_current",
        },
      ],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 10,
        total_render_ms: 20,
      },
    });

    await renderChatLog([{ role: "assistant", content: "Hi, Uther Pendragon.", voice_posture: "ordinary_chat" }]);
    await act(async () => {
      await flush(80);
    });

    expect(container.textContent).toContain("speech_mode: async_chunks");
    expect(container.textContent).toContain("speech_error_stage: playback");
    expect(container.textContent).toContain("speech_error_detail: Failed to fetch");
    expect(queue.enqueueUrls).toHaveBeenCalledWith([
      "http://127.0.0.1:8767/speech/jobs/speech_job_6/chunks/0.wav",
    ]);
  });

  test("failed create_job shows stage metadata and orchestrator URL", async () => {
    const { SpeechJobRequestError } = getSpeechJobsMock();
    getSpeechJobsMock().createSpeechJob.mockRejectedValue(
      new SpeechJobRequestError(
        "create_job",
        "http://127.0.0.1:8767/speech/jobs",
        "speech job creation failed (503)",
        { status: 503, responseText: "worker offline" },
      ),
    );

    await renderChatLog([{ role: "assistant", content: "Hi, Uther Pendragon.", voice_posture: "ordinary_chat" }]);

    expect(container.textContent).toContain("Voice unavailable");
    expect(container.textContent).toContain("speech_endpoint: http://127.0.0.1:8767");
    expect(container.textContent).toContain("speech_error_stage: create_job");
    expect(container.textContent).toContain("speech_error_status: 503");
    expect(container.textContent).toContain("speech_error_detail: worker offline");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("failed poll_job shows stage metadata and keeps async path", async () => {
    const { SpeechJobRequestError } = getSpeechJobsMock();
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_5",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockRejectedValue(
      new SpeechJobRequestError(
        "poll_job",
        "http://127.0.0.1:8767/speech/jobs/speech_job_5",
        "speech job fetch failed (500)",
        { status: 500, responseText: "poll exploded" },
      ),
    );

    await renderChatLog([{ role: "assistant", content: "Hi, Uther Pendragon.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalled();
    expect(container.textContent).toContain("speech_mode: async_chunks");
    expect(container.textContent).toContain("speech_error_stage: poll_job");
    expect(container.textContent).toContain("speech_error_status: 500");
    expect(container.textContent).toContain("speech_error_detail: poll exploded");
    expect(debugSpy).toHaveBeenCalled();
  });

  test("default provider (no config key) falls back to readDeiphobeSpeechMode async_chunks", async () => {
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_prov_default",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_prov_default",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", render_started_at: "t1", first_audio_ready_at: "t2", completed_at: "t3", first_audio_latency_ms: null, total_render_ms: null },
    });

    // config returns "false" for provider key → selectedProvider is null → falls back to readDeiphobeSpeechMode
    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ speech_mode: "async_chunks" }),
    );
    const call = getSpeechJobsMock().createSpeechJob.mock.calls[0][0] as Record<string, unknown>;
    expect(call.provider).toBeUndefined();
  });

  test("provider xtts_stream submits speech_mode stream and provider xtts_stream", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_provider") return "xtts_stream";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_xtts",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "stream",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_xtts",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "stream",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", render_started_at: "t1", first_audio_ready_at: "t2", completed_at: "t3", first_audio_latency_ms: null, total_render_ms: null },
    });

    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ speech_mode: "stream", provider: "xtts_stream" }),
    );
  });

  test("provider qwen3_voicedesign submits speech_mode smart_chunks and provider qwen3_voicedesign, not stream", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_provider") return "qwen3_voicedesign";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_qwen3",
      status: "complete",
      render_engine: "qwen3_voice_design",
      speech_mode: "smart_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_qwen3",
      status: "complete",
      render_engine: "qwen3_voice_design",
      speech_mode: "smart_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", render_started_at: "t1", first_audio_ready_at: "t2", completed_at: "t3", first_audio_latency_ms: null, total_render_ms: null },
    });

    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ speech_mode: "smart_chunks", provider: "qwen3_voicedesign" }),
    );
    const call = getSpeechJobsMock().createSpeechJob.mock.calls[0][0] as Record<string, unknown>;
    expect(call.speech_mode).not.toBe("stream");
  });

  test("provider piper submits provider piper", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_provider") return "piper";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_piper",
      status: "complete",
      render_engine: "piper",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_piper",
      status: "complete",
      render_engine: "piper",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", render_started_at: "t1", first_audio_ready_at: "t2", completed_at: "t3", first_audio_latency_ms: null, total_render_ms: null },
    });

    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(getSpeechJobsMock().createSpeechJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "piper" }),
    );
  });

  test("debug metadata shows selected_provider and provider capability fields", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_provider") return "xtts_stream";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_meta",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "stream",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_meta",
      status: "complete",
      render_engine: "xtts",
      speech_mode: "stream",
      stream_endpoint: "http://127.0.0.1:8784/render_stream",
      first_audio_chunk_latency_ms: 500,
      server_time_to_first_audio_chunk_ms: 490,
      total_stream_duration_ms: 1200,
      stream_chunk_count: 3,
      total_pcm_bytes: 999,
      fallback_used: false,
      fallback_reason: null,
      chunks: [],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: 500,
        total_render_ms: 1200,
      },
    });

    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(container.textContent).toContain("selected_provider: xtts_stream");
    expect(container.textContent).toContain("provider_latency_class: live");
    expect(container.textContent).toContain("provider_supports_streaming: true");
  });

  test("debug metadata shows selected_provider for qwen3_voicedesign with slow_quality latency class", async () => {
    getConfigMock().mockImplementation((key: string) => {
      if (key === "deiphobe_speech_chat_controls_enabled") return "false";
      if (key === "deiphobe_speech_auto_play_enabled") return "false";
      if (key === "deiphobe_speech_provider") return "qwen3_voicedesign";
      return "false";
    });
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_qwen3_meta",
      status: "queued",
      render_engine: "qwen3_voice_design",
      speech_mode: "smart_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockResolvedValue({
      job_id: "speech_job_qwen3_meta",
      status: "complete",
      render_engine: "qwen3_voice_design",
      speech_mode: "smart_chunks",
      fallback_used: false,
      fallback_reason: null,
      chunks: [],
      error: null,
      timing: {
        job_created_at: "t0",
        render_started_at: "t1",
        first_audio_ready_at: "t2",
        completed_at: "t3",
        first_audio_latency_ms: null,
        total_render_ms: null,
      },
    });

    await renderChatLog([{ role: "assistant", content: "Hello.", voice_posture: "ordinary_chat" }]);

    expect(container.textContent).toContain("selected_provider: qwen3_voicedesign");
    expect(container.textContent).toContain("provider_latency_class: slow_quality");
    expect(container.textContent).toContain("provider_supports_streaming: false");
    expect(container.textContent).toContain("speech_mode: smart_chunks");
  });

  test("network failure during poll stays classified as poll_job, not playback", async () => {
    getSpeechJobsMock().createSpeechJob.mockResolvedValue({
      job_id: "speech_job_7",
      status: "queued",
      render_engine: "xtts",
      speech_mode: "async_chunks",
      chunks: [],
      error: null,
      timing: { job_created_at: "t0", first_audio_latency_ms: null, total_render_ms: null },
    });
    getSpeechJobsMock().getSpeechJob.mockRejectedValue(new TypeError("Failed to fetch"));

    await renderChatLog([{ role: "assistant", content: "I’m here.", voice_posture: "ordinary_chat" }]);

    expect(container.textContent).toContain("speech_mode: async_chunks");
    expect(container.textContent).toContain("speech_error_stage: poll_job");
    expect(container.textContent).toContain("speech_error_detail: Failed to fetch");
    expect(container.textContent).not.toContain("speech_error_stage: playback");
  });
});
