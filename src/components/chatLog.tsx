import { useTranslation } from 'react-i18next';
import { config } from "@/utils/config";
import { clsx } from "clsx";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import FlexTextarea from "@/components/flexTextarea/flexTextarea";
import { Message } from "@/features/chat/messages";
import { ChatSpeechRenderButton } from "@/features/deiphobeSpeech/ChatSpeechRenderButton";
import { ChatAvatarCueButton } from "@/features/deiphobeSpeech/ChatAvatarCueButton";
import {
  callSmartChunkRender,
  playSmartChunks,
  stopSmartChunkPlayback,
  type SmartChunkStatus,
} from "@/features/deiphobeSpeech/smartChunkSpeech";
import {
  callSpeechRenderBridge,
  makeUniqueSpeechOutputFilename,
  SPEECH_RENDER_ENDPOINT,
} from "@/features/deiphobeSpeech/renderBridge";
import {
  createDeiphobeSpeechPlaybackQueue,
  stopDeiphobeSpeechPlayback,
  type DeiphobeSpeechPlaybackMetadata,
} from "@/features/deiphobeSpeech/deiphobeSpeechPlaybackManager";
import {
  DEIPHOBE_SPEECH_ASYNC_ENABLED,
  DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
  SpeechJobRequestError,
  cancelSpeechJob,
  createSpeechJob,
  getSpeechJob,
  readDeiphobeSpeechMode,
  type DeiphobeSpeechJobMode,
  type SpeechAsyncErrorStage,
  type SpeechJobState,
} from "@/features/deiphobeSpeech/speechJobs";
import {
  SPEECH_PROVIDER_OPTIONS,
  findSpeechProviderOption,
  type SpeechProviderOption,
} from "@/features/deiphobeSpeech/speechProviderOptions";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { resolveAnimationStatePath } from "@/features/vrmViewer/animationState";
import { loadVRMAnimation } from "@/lib/VRMAnimation/loadVRMAnimation";
import { IconButton } from "@/components/iconButton";
import {
  ArrowPathIcon,
} from '@heroicons/react/20/solid';
import { getAssistantChatDisplayName } from "@/utils/chatDisplayName";
import { resolveHostAwareLocalUrl } from "@/utils/hostAwareUrl";
import { ChatContext } from "@/features/chat/chatContext";
import { saveAs } from 'file-saver';

export const ChatLog = ({
  messages,
}: {
  messages: Message[];
}) => {
  const { t } = useTranslation();
  const { chat: bot } = useContext(ChatContext);
  const { viewer } = useContext(ViewerContext);

  const speechPreRenderEnabled =
    config("deiphobe_speech_prerender_enabled") === "true";
  const speechAutoPlayEnabled =
    config("deiphobe_speech_autoplay_enabled") === "true";
  const speechChatControlsEnabled =
    config("deiphobe_speech_chat_controls_enabled") === "true";

  // Smart-chunk autoplay — dev-only, disabled by default.
  const autoRenderEnabled =
    config("deiphobe_speech_auto_render_enabled") === "true";
  const autoPlayEnabled =
    config("deiphobe_speech_auto_play_enabled") === "true";
  const smartChunksEnabled =
    config("deiphobe_speech_smart_chunks_enabled") === "true";
  const asyncSpeechEnabled = DEIPHOBE_SPEECH_ASYNC_ENABLED;
  const selectedProvider = findSpeechProviderOption(config("deiphobe_speech_provider"));

  // Index of the last assistant message in the list.
  const newestAssistantIdx = messages.reduce<number>(
    (acc, msg, i) => (msg.role === "assistant" ? i : acc),
    -1,
  );

  const handleDispatchCue = viewer?.model
    ? async (voiceMode: string) => {
        const pathName = await resolveAnimationStatePath(voiceMode);
        if (!pathName) throw new Error(`No animation mapping for "${voiceMode}"`);
        const animation = await loadVRMAnimation(pathName);
        if (!animation) throw new Error("Failed to load animation");
        await viewer.model!.playAnimation(animation, pathName.split("/").pop() || pathName);
        requestAnimationFrame(() => { viewer.resetCameraLerp(); });
      }
    : undefined;
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const handleResumeButtonClick = (num: number, newMessage: string) => {
    bot.setMessageList(messages.slice(0, num));
    bot.receiveMessageFromUser(newMessage,false);
  };

  const txtFileInputRef = useRef<HTMLInputElement>(null);
  const handleClickOpenTxtFile = useCallback(() => {
    txtFileInputRef.current?.click();
  }, []);

  const handleChangeTxtFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const file = files[0];
      if (!file) return;

      const fileReader = new FileReader();
      fileReader.onload = (e) => {
        const content = e.target?.result as string;
        const lines = content.split("\n");
        const parsedChat = lines.map((line) => {
          const match = line.match(/^(user|assistant)\s*:\s*(.*)$/);
          if (match) {
            return { role: match[1], content: match[2] };
          }
          return null;
        }).filter(Boolean) as Message[];

        try {
          if (parsedChat.length > 0) {
            const lastMessage = parsedChat[parsedChat.length - 1];
            bot.setMessageList(parsedChat.slice(0, parsedChat.length - 1));

            if (lastMessage.role === "user") {
              bot.receiveMessageFromUser(lastMessage.content as string, false);
            } else {
              bot.bubbleMessage(lastMessage.role, lastMessage.content as string);
            }
          }
          console.error("Please attach the correct file format.");
        } catch (e: any) {
          console.error(e.toString());
        }
      };

      fileReader.readAsText(file);

      event.target.value = "";
    },
    [bot]
  );

  const exportMessagesToTxt = (messages: any[]) => {
    const blob = new Blob(
      [messages.map((msg: { role: string; content: string; }) => `${msg.role} : ${msg.content}`).join('\n\n')],
      { type: 'text/plain' }
    );
    saveAs(blob, 'chat_log.txt');
  };

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: "auto",
      block: "center",
    });
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [messages]);

  return (
    <>
      <div className="absolute left-12 top-4 z-10">
        <button
          type="button"
          aria-label={t("Restart")}
          className="bg-slate-600 hover:bg-slate-500 active:bg-slate-500 text-white rounded-lg text-sm p-1 text-center inline-flex items-center mr-2 shadow-xl"
          onClick={() => {
            bot.setMessageList([]);
          }}
        >
          <ArrowPathIcon className="h-6 w-6" aria-hidden="true" />
          <div className="mx-2 font-bold">{t("Restart")}</div>
        </button>
        <IconButton
          iconName="24/UploadAlt"
          label={t("Load Chat")}
          isProcessing={false}
          className="bg-slate-600 hover:bg-slate-500 active:bg-slate-500 shadow-xl"
          onClick={handleClickOpenTxtFile}
        ></IconButton>
        <IconButton
          iconName="24/Save"
          label={t("Save")}
          isProcessing={false}
          className="bg-slate-600 hover:bg-slate-500 active:bg-slate-500 shadow-xl"
          onClick={() => exportMessagesToTxt(messages)}
        ></IconButton>
      </div>

      <div className="fixed w-col-span-6 max-w-full h-full pb-16">

        <div className="max-h-full px-16 pt-20 pb-4 overflow-y-auto scroll-hidden">
          {messages.map((msg, i) => {
            const autoPreRender =
              speechPreRenderEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory";
            const autoPlayAfterRender = speechAutoPlayEnabled;

            // Smart-chunk autoplay: only for the newest assistant message,
            // never for private_memory, never for user messages.
            const autoSmartRender =
              !asyncSpeechEnabled &&
              autoRenderEnabled &&
              smartChunksEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory" &&
              i === newestAssistantIdx;

            const autoBridgeRender =
              !asyncSpeechEnabled &&
              autoRenderEnabled &&
              !smartChunksEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory" &&
              i === newestAssistantIdx;

            const autoAsyncRender =
              asyncSpeechEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory" &&
              i === messages.length - 1;

            return (
              <div key={i} ref={messages.length - 1 === i ? chatScrollRef : null}>
                <Chat
                  role={msg.role}
                  message={(msg.content as string).replace(/\[(.*?)\]/g, "")}
                  num={i}
                  onClickResumeButton={handleResumeButtonClick}
                  voice_posture={msg.voice_posture}
                  animation_state={msg.animation_state}
                  onDispatchCue={handleDispatchCue}
                  autoPreRender={autoPreRender}
                  autoPlayAfterRender={autoPlayAfterRender}
                  speechControlsEnabled={speechChatControlsEnabled}
                  autoSmartRender={autoSmartRender}
                  autoBridgeRender={autoBridgeRender}
                  autoAsyncRender={autoAsyncRender}
                  autoSmartPlay={autoPlayEnabled}
                  selectedProvider={selectedProvider}
                  lipSync={viewer?.model?._lipSync}
                />

              </div>
            );
          })}
        </div>
      </div>
      <input
        type="file"
        accept=".txt"
        ref={txtFileInputRef}
        onChange={handleChangeTxtFile}
        className="hidden"
      />
    </>
  );
};

function Chat({
  role,
  message,
  num,
  onClickResumeButton,
  voice_posture,
  animation_state,
  onDispatchCue,
  autoPreRender = false,
  autoPlayAfterRender = false,
  speechControlsEnabled = false,
  autoSmartRender = false,
  autoBridgeRender = false,
  autoAsyncRender = false,
  autoSmartPlay = false,
  selectedProvider = null,
  lipSync,
}: {
  role: string;
  message: string;
  num: number;
  onClickResumeButton: (num: number, message: string) => void;
  voice_posture?: string;
  animation_state?: string;
  onDispatchCue?: (voiceMode: string) => Promise<void>;
  autoPreRender?: boolean;
  autoPlayAfterRender?: boolean;
  speechControlsEnabled?: boolean;
  autoSmartRender?: boolean;
  autoBridgeRender?: boolean;
  autoAsyncRender?: boolean;
  autoSmartPlay?: boolean;
  selectedProvider?: SpeechProviderOption | null;
  lipSync?: import("@/features/lipSync/lipSync").LipSync;
}) {
  const { t } = useTranslation();

  // ── smart-chunk render/play state ─────────────────────────────────────────
  const [smartStatus, setSmartStatus] = useState<SmartChunkStatus>("idle");
  const [speechMetadata, setSpeechMetadata] = useState<DeiphobeSpeechPlaybackMetadata | null>(null);
  const [activeSpeechJobId, setActiveSpeechJobId] = useState<string | null>(null);
  const speechOwnerId = `deiphobe-message-${num}`;

  function setAsyncSpeechError(
    stage: SpeechAsyncErrorStage,
    options: {
      detail?: string | null;
      status?: number | null;
      renderEngine?: string | null;
      chunkCount?: number | null;
      chunkStatus?: string | null;
      firstAudioLatencyMs?: number | null;
      totalRenderMs?: number | null;
      speechMode?: "async_chunks" | "stream" | "auto" | null;
      streamEndpoint?: string | null;
      firstAudioChunkLatencyMs?: number | null;
      serverTimeToFirstAudioChunkMs?: number | null;
      totalStreamDurationMs?: number | null;
      streamChunkCount?: number | null;
      totalPcmBytes?: number | null;
      fallbackUsed?: boolean | null;
      fallbackReason?: string | null;
    } = {},
  ) {
    console.warn("[Deiphobe async speech]", {
      stage,
      endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
      status: options.status ?? null,
      detail: options.detail ?? null,
      ownerId: speechOwnerId,
    });
    const prov = selectedProviderRef.current;
    setSpeechMetadata((prev) => ({
      render_engine: options.renderEngine ?? prev?.render_engine ?? null,
      profile: prev?.profile ?? null,
      endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
      mode: options.speechMode === "stream" ? "stream" : options.speechMode === "smart_chunks" ? "smart_chunks" : "async_chunks",
      error_stage: stage,
      error_status: options.status ?? null,
      error_detail: options.detail ?? null,
      chunk_count: options.chunkCount ?? prev?.chunk_count ?? null,
      chunk_status: options.chunkStatus ?? prev?.chunk_status ?? null,
      first_audio_latency_ms: options.firstAudioLatencyMs ?? prev?.first_audio_latency_ms ?? null,
      first_audio_chunk_latency_ms: options.firstAudioChunkLatencyMs ?? prev?.first_audio_chunk_latency_ms ?? null,
      server_time_to_first_audio_chunk_ms: options.serverTimeToFirstAudioChunkMs ?? prev?.server_time_to_first_audio_chunk_ms ?? null,
      total_render_ms: options.totalRenderMs ?? prev?.total_render_ms ?? null,
      total_stream_duration_ms: options.totalStreamDurationMs ?? prev?.total_stream_duration_ms ?? null,
      stream_endpoint: options.streamEndpoint ?? prev?.stream_endpoint ?? null,
      stream_chunk_count: options.streamChunkCount ?? prev?.stream_chunk_count ?? null,
      total_pcm_bytes: options.totalPcmBytes ?? prev?.total_pcm_bytes ?? null,
      render_mode: prev?.render_mode ?? null,
      fallback_used: options.fallbackUsed ?? prev?.fallback_used ?? false,
      fallback_reason: options.fallbackReason ?? prev?.fallback_reason ?? null,
      selected_provider: prov?.key ?? prev?.selected_provider ?? null,
      provider_latency_class: prov?.latency_class ?? prev?.provider_latency_class ?? null,
      provider_supports_streaming: prov?.supports_streaming ?? prev?.provider_supports_streaming ?? null,
    }));
  }

  function asyncErrorOptionsFromState(state: SpeechJobState) {
    return {
      renderEngine: state.render_engine,
      chunkCount: state.chunks.length,
      chunkStatus: state.status,
      firstAudioLatencyMs: state.timing.first_audio_latency_ms,
      totalRenderMs: state.timing.total_render_ms,
      speechMode: state.speech_mode,
      streamEndpoint: state.stream_endpoint ?? null,
      firstAudioChunkLatencyMs: state.first_audio_chunk_latency_ms ?? null,
      serverTimeToFirstAudioChunkMs: state.server_time_to_first_audio_chunk_ms ?? null,
      totalStreamDurationMs: state.total_stream_duration_ms ?? null,
      streamChunkCount: state.stream_chunk_count ?? null,
      totalPcmBytes: state.total_pcm_bytes ?? null,
      fallbackUsed: Boolean(state.fallback_used),
      fallbackReason: state.fallback_reason ?? null,
    };
  }

  // Refs so async handlers can read the latest prop values without going stale.
  const autoSmartRenderRef = useRef(autoSmartRender);
  const autoBridgeRenderRef = useRef(autoBridgeRender);
  const autoSmartPlayRef = useRef(autoSmartPlay);
  const autoAsyncRenderRef = useRef(autoAsyncRender);
  const messageRef = useRef(message);
  const selectedProviderRef = useRef(selectedProvider ?? null);
  useEffect(() => { autoSmartRenderRef.current = autoSmartRender; }, [autoSmartRender]);
  useEffect(() => { autoBridgeRenderRef.current = autoBridgeRender; }, [autoBridgeRender]);
  useEffect(() => { autoSmartPlayRef.current = autoSmartPlay; }, [autoSmartPlay]);
  useEffect(() => { autoAsyncRenderRef.current = autoAsyncRender; }, [autoAsyncRender]);
  useEffect(() => { messageRef.current = message; }, [message]);
  useEffect(() => { selectedProviderRef.current = selectedProvider ?? null; }, [selectedProvider]);

  // Track whether any auto-render is active to detect true→false transitions.
  const autoRenderActive = autoSmartRender || autoBridgeRender || autoAsyncRender;
  const prevAutoRenderActiveRef = useRef(false);
  // Guards: fire each render path at most once per "newest message" period.
  const smartRenderFiredRef = useRef(false);
  const bridgeRenderFiredRef = useRef(false);
  const asyncRenderFiredRef = useRef(false);

  // Cancel playback when this message is no longer the newest.
  useEffect(() => {
    const wasActive = prevAutoRenderActiveRef.current;
    prevAutoRenderActiveRef.current = autoRenderActive;

    if (wasActive && !autoRenderActive) {
      stopSmartChunkPlayback();
      if (activeSpeechJobId) {
        void cancelSpeechJob(activeSpeechJobId).catch(() => undefined);
        setActiveSpeechJobId(null);
      }
      setSmartStatus("idle");
      setSpeechMetadata(null);
      smartRenderFiredRef.current = false;
      bridgeRenderFiredRef.current = false;
      asyncRenderFiredRef.current = false;
    }
  }, [activeSpeechJobId, autoRenderActive]);

  // Auto-render + optional auto-play for the newest assistant message.
  useEffect(() => {
    if (!autoSmartRender || role !== "assistant") return;
    if (smartRenderFiredRef.current) return;
    smartRenderFiredRef.current = true;

    void (async () => {
      setSmartStatus("rendering");
      const result = await callSmartChunkRender(messageRef.current);

      // Bail if we're no longer the newest message.
      if (!autoSmartRenderRef.current) {
        setSmartStatus("idle");
        return;
      }

      const playbackMeta = {
        render_engine: result.renderEngine,
        profile: result.voiceProfile ?? undefined,
        endpoint: result.endpoint,
        mode: result.mode,
        chunk_count: result.chunkCount,
        batch_id: result.batchId,
        instruct_hash: result.instructHash,
        render_mode: result.renderMode,
      };
      setSpeechMetadata(playbackMeta);

      if (!result.ok) {
        setSmartStatus("error");
        return;
      }
      setSmartStatus("ready");

      if (autoSmartPlayRef.current && result.audioUrls.length > 0) {
        await playSmartChunks(
          result.audioUrls.map(resolveHostAwareLocalUrl),
          setSmartStatus,
          lipSync,
          playbackMeta,
        );
      }
    })();
  }, [autoSmartRender, role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge auto-render for newest assistant message (smart-chunks disabled path).
  useEffect(() => {
    if (!autoBridgeRender || role !== "assistant") return;
    if (bridgeRenderFiredRef.current) return;
    bridgeRenderFiredRef.current = true;

    void (async () => {
      setSmartStatus("rendering");
      try {
        const outputFilename = makeUniqueSpeechOutputFilename("auto", messageRef.current);
        const result = await callSpeechRenderBridge({
          text: messageRef.current,
          posture: "neutral",
          output_filename: outputFilename,
        });

        if (!autoBridgeRenderRef.current) {
          setSmartStatus("idle");
          return;
        }

        const playbackMeta: DeiphobeSpeechPlaybackMetadata = {
          render_engine: result.render_engine ?? undefined,
          profile: result.voice_profile ?? undefined,
          endpoint: SPEECH_RENDER_ENDPOINT,
          mode: result.render_mode ?? "single_file",
          render_mode: result.render_mode ?? undefined,
        };
        setSpeechMetadata(playbackMeta);

        if (!result.rendered || !result.audio_url) {
          setSmartStatus("error");
          return;
        }
        setSmartStatus("ready");

        if (autoSmartPlayRef.current) {
          await playSmartChunks([resolveHostAwareLocalUrl(result.audio_url)], setSmartStatus, lipSync, playbackMeta);
        }
      } catch {
        if (autoBridgeRenderRef.current) setSmartStatus("error");
      }
    })();
  }, [autoBridgeRender, role]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoAsyncRender || role !== "assistant") return;
    if (asyncRenderFiredRef.current) return;
    asyncRenderFiredRef.current = true;

    let disposed = false;

    void (async () => {
      setSmartStatus("rendering");
      let asyncStage: SpeechAsyncErrorStage = "create_job";
      try {
        console.debug("[Deiphobe async speech] create_job", {
          endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
          ownerId: speechOwnerId,
        });
        const prov = selectedProviderRef.current;
        const speechMode: DeiphobeSpeechJobMode = prov
          ? (prov.speech_mode as DeiphobeSpeechJobMode)
          : readDeiphobeSpeechMode();
        const created = await createSpeechJob({
          text: messageRef.current,
          posture: voice_posture ?? animation_state ?? "ordinary_chat",
          operator_name: undefined,
          private_mode: false,
          engine: "auto",
          chunking: true,
          speech_mode: speechMode,
          ...(prov ? { provider: prov.provider } : {}),
        });
        if (disposed || !autoAsyncRenderRef.current) {
          setAsyncSpeechError("cancelled", { detail: "async speech job was superseded before playback" });
          void cancelSpeechJob(created.job_id).catch(() => undefined);
          return;
        }

        setActiveSpeechJobId(created.job_id);
        let nextChunkIndex = 0;
        let playbackQueue: ReturnType<typeof createDeiphobeSpeechPlaybackQueue> | null = null;

        for (;;) {
          asyncStage = "poll_job";
          console.debug("[Deiphobe async speech] poll_job", {
            endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
            jobId: created.job_id,
          });
          const state: SpeechJobState = await getSpeechJob(created.job_id);
          if (disposed || !autoAsyncRenderRef.current) {
            setAsyncSpeechError("cancelled", {
              detail: "async speech job cancelled during polling",
              ...asyncErrorOptionsFromState(state),
            });
            void cancelSpeechJob(created.job_id).catch(() => undefined);
            playbackQueue?.fail("cancelled");
            return;
          }

          const readyChunks = state.chunks
            .filter((chunk) => chunk.audio_url && (chunk.status === "ready" || chunk.status === "cache_hit"))
            .sort((a, b) => a.index - b.index);
          const readyByIndex = new Map(readyChunks.map((chunk) => [chunk.index, chunk]));

          const pollProv = selectedProviderRef.current;
          setSpeechMetadata({
            render_engine: state.render_engine,
            profile: readyChunks.find((chunk) => Boolean(chunk.voice_profile))?.voice_profile ?? undefined,
            endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
            mode: state.speech_mode === "stream" ? "stream" : state.speech_mode === "smart_chunks" ? "smart_chunks" : "async_chunks",
            error_stage: null,
            error_status: null,
            error_detail: null,
            chunk_count: state.chunks.length,
            chunk_status: state.status,
            first_audio_latency_ms: state.timing.first_audio_latency_ms,
            first_audio_chunk_latency_ms: state.first_audio_chunk_latency_ms ?? null,
            server_time_to_first_audio_chunk_ms: state.server_time_to_first_audio_chunk_ms ?? null,
            total_render_ms: state.timing.total_render_ms,
            total_stream_duration_ms: state.total_stream_duration_ms ?? null,
            stream_endpoint: state.stream_endpoint ?? null,
            stream_chunk_count: state.stream_chunk_count ?? null,
            total_pcm_bytes: state.total_pcm_bytes ?? null,
            fallback_used: Boolean(state.fallback_used),
            fallback_reason: state.fallback_reason ?? null,
            selected_provider: pollProv?.key ?? null,
            provider_latency_class: pollProv?.latency_class ?? null,
            provider_supports_streaming: pollProv?.supports_streaming ?? null,
          });

          while (readyByIndex.has(nextChunkIndex)) {
            const chunk = readyByIndex.get(nextChunkIndex)!;
            if (playbackQueue === null && autoSmartPlayRef.current) {
              playbackQueue = createDeiphobeSpeechPlaybackQueue({
                ownerId: speechOwnerId,
                lipSync,
                metadata: {
                  render_engine: state.render_engine,
                  endpoint: DEIPHOBE_SPEECH_ORCHESTRATOR_URL,
                  mode: state.speech_mode === "stream" ? "stream" : state.speech_mode === "smart_chunks" ? "smart_chunks" : "async_chunks",
                  chunk_count: state.chunks.length,
                  chunk_status: state.status,
                  first_audio_latency_ms: state.timing.first_audio_latency_ms,
                  first_audio_chunk_latency_ms: state.first_audio_chunk_latency_ms ?? null,
                  server_time_to_first_audio_chunk_ms: state.server_time_to_first_audio_chunk_ms ?? null,
                  total_render_ms: state.timing.total_render_ms,
                  total_stream_duration_ms: state.total_stream_duration_ms ?? null,
                  stream_endpoint: state.stream_endpoint ?? null,
                  stream_chunk_count: state.stream_chunk_count ?? null,
                  total_pcm_bytes: state.total_pcm_bytes ?? null,
                  fallback_used: Boolean(state.fallback_used),
                  fallback_reason: state.fallback_reason ?? null,
                  selected_provider: pollProv?.key ?? null,
                  provider_latency_class: pollProv?.latency_class ?? null,
                  provider_supports_streaming: pollProv?.supports_streaming ?? null,
                },
                onStatus: (status) => {
                  if (status === "playing") setSmartStatus("playing");
                  if (status === "complete") setSmartStatus("complete");
                  if (status === "error") {
                    setSmartStatus("error");
                    setAsyncSpeechError("playback", {
                      detail: "audio playback failed",
                      ...asyncErrorOptionsFromState(state),
                    });
                  }
                },
              });
              void playbackQueue.result.then((result) => {
                if (result.outcome === "error") {
                  const detail = result.error ?? "audio playback failed";
                  const stage: SpeechAsyncErrorStage = detail.includes("audio fetch failed")
                    ? "chunk_audio"
                    : "playback";
                  setAsyncSpeechError(stage, {
                    detail,
                    ...asyncErrorOptionsFromState(state),
                  });
                } else if (result.outcome === "cancelled") {
                  setAsyncSpeechError("cancelled", {
                    detail: "audio playback cancelled",
                    ...asyncErrorOptionsFromState(state),
                  });
                }
              });
            }
            if (playbackQueue && chunk.audio_url) {
              asyncStage = "chunk_audio";
              playbackQueue.enqueueUrls([resolveHostAwareLocalUrl(chunk.audio_url)]);
              setSmartStatus("ready");
            } else if (!autoSmartPlayRef.current) {
              setSmartStatus("ready");
            }
            nextChunkIndex += 1;
          }

          if (state.status === "failed") {
            playbackQueue?.fail(state.error ?? "render failed");
            setAsyncSpeechError("poll_job", {
              detail: state.error ?? "render failed",
              ...asyncErrorOptionsFromState(state),
            });
            setSmartStatus("error");
            return;
          }
          if (state.status === "cancelled") {
            playbackQueue?.fail("cancelled");
            setAsyncSpeechError("cancelled", {
              detail: "async speech job cancelled",
              ...asyncErrorOptionsFromState(state),
            });
            setSmartStatus("idle");
            return;
          }
          if (state.status === "complete") {
            playbackQueue?.close();
            if (!playbackQueue) {
              setSmartStatus("ready");
            }
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        if (error instanceof SpeechJobRequestError) {
          setAsyncSpeechError(error.stage, {
            detail: error.responseText ?? error.message,
            status: error.status ?? null,
          });
          console.debug("[Deiphobe async speech] request failed", {
            stage: error.stage,
            endpoint: error.endpoint,
            status: error.status ?? null,
          });
        } else {
          setAsyncSpeechError(asyncStage, {
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        if (!disposed && autoAsyncRenderRef.current) {
          setSmartStatus("error");
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [animation_state, autoAsyncRender, lipSync, role, speechOwnerId, voice_posture]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ────────────────────────────────────────────────────────────────

  const onClickButton = () => {
    onClickResumeButton(num, message);
  };

  return (
    <div className={clsx(
      'mx-auto max-w-sm my-8',
      role === "assistant" ? "pr-10 sm:pr-20" : "pl-10 sm:pl-20",
    )}>
      <div
        className={clsx(
          'px-8 py-2 rounded-t-lg font-bold tracking-wider flex justify-between shadow-inner backdrop-blur-lg',
          role === "assistant" ? "bg-pink-600/80" : "bg-cyan-600/80",
        )}
      >
        <div className="text-bold text-white">
          {role === "assistant" && getAssistantChatDisplayName()}
          {role === "user" && t("YOU")}
        </div>
        <button
          className="text-right"
          onClick={onClickButton}
        >
          {role === "user" && (
            <div className="ml-16 p-1 rounded-full">
              <ArrowPathIcon className="h-5 w-5 hover:animate-spin text-white" aria-hidden="true" />
            </div>
          )}
        </button>
      </div>
      <div className="px-4 py-2 bg-white/80 backdrop-blur-lg rounded-b-lg shadow-sm">
        <div className='typography-16 font-M_PLUS_2 font-bold text-gray-800'>
          {role === "assistant" ? (
            <>
              <div>{message}</div>
              {speechControlsEnabled && (
                <ChatSpeechRenderButton
                  text={message}
                  voice_posture={voice_posture}
                  animation_state={animation_state}
                  autoPreRender={autoPreRender}
                  autoPlayAfterRender={autoPlayAfterRender}
                  ownerId={speechOwnerId}
                  lipSync={lipSync}
                  onMetadataChange={setSpeechMetadata}
                />
              )}
              {speechControlsEnabled && (
                <ChatAvatarCueButton voice_posture={voice_posture} animation_state={animation_state} onDispatchCue={onDispatchCue} />
              )}
              {speechMetadata !== null && (
                <div className="mt-1 text-[10px] leading-4 text-gray-500" data-testid={`speech-meta-${num}`}>
                  <div>speech_engine: {speechMetadata.render_engine ?? "n/a"}</div>
                  <div>speech_profile: {speechMetadata.profile ?? "n/a"}</div>
                  <div>speech_endpoint: {speechMetadata.endpoint ?? "n/a"}</div>
                  <div>speech_mode: {speechMetadata.mode}</div>
                  {speechMetadata.selected_provider != null && (
                    <div>selected_provider: {speechMetadata.selected_provider}</div>
                  )}
                  {speechMetadata.provider_latency_class != null && (
                    <div>provider_latency_class: {speechMetadata.provider_latency_class}</div>
                  )}
                  {speechMetadata.provider_supports_streaming != null && (
                    <div>provider_supports_streaming: {String(speechMetadata.provider_supports_streaming)}</div>
                  )}
                  {speechMetadata.error_stage != null && (
                    <div>speech_error_stage: {speechMetadata.error_stage}</div>
                  )}
                  {speechMetadata.error_status != null && (
                    <div>speech_error_status: {speechMetadata.error_status}</div>
                  )}
                  {speechMetadata.error_detail != null && (
                    <div>speech_error_detail: {speechMetadata.error_detail}</div>
                  )}
                  {speechMetadata.chunk_count != null && (
                    <div>chunk_count: {speechMetadata.chunk_count}</div>
                  )}
                  {speechMetadata.chunk_status != null && (
                    <div>chunk_status: {speechMetadata.chunk_status}</div>
                  )}
                  {speechMetadata.first_audio_latency_ms != null && (
                    <div>first_audio_latency_ms: {speechMetadata.first_audio_latency_ms}</div>
                  )}
                  {speechMetadata.first_audio_chunk_latency_ms != null && (
                    <div>first_audio_chunk_latency_ms: {speechMetadata.first_audio_chunk_latency_ms}</div>
                  )}
                  {speechMetadata.server_time_to_first_audio_chunk_ms != null && (
                    <div>server_time_to_first_audio_chunk_ms: {speechMetadata.server_time_to_first_audio_chunk_ms}</div>
                  )}
                  {speechMetadata.total_render_ms != null && (
                    <div>total_render_ms: {speechMetadata.total_render_ms}</div>
                  )}
                  {speechMetadata.total_stream_duration_ms != null && (
                    <div>total_stream_duration_ms: {speechMetadata.total_stream_duration_ms}</div>
                  )}
                  {speechMetadata.stream_endpoint != null && (
                    <div>stream_endpoint: {speechMetadata.stream_endpoint}</div>
                  )}
                  {speechMetadata.stream_chunk_count != null && (
                    <div>stream_chunk_count: {speechMetadata.stream_chunk_count}</div>
                  )}
                  {speechMetadata.total_pcm_bytes != null && (
                    <div>total_pcm_bytes: {speechMetadata.total_pcm_bytes}</div>
                  )}
                  {speechMetadata.fallback_used != null && (
                    <div>fallback_used: {String(speechMetadata.fallback_used)}</div>
                  )}
                  {speechMetadata.fallback_reason != null && (
                    <div>fallback_reason: {speechMetadata.fallback_reason}</div>
                  )}
                  {speechMetadata.render_mode != null && (
                    <div>render_mode: {speechMetadata.render_mode}</div>
                  )}
                  {speechMetadata.batch_id != null && (
                    <div>batch_id: {speechMetadata.batch_id}</div>
                  )}
                  {speechMetadata.instruct_hash != null && (
                    <div>instruct_hash: {speechMetadata.instruct_hash}</div>
                  )}
                </div>
              )}
              {smartStatus !== "idle" && (
                <SmartChunkStatusBar
                  status={smartStatus}
                  onStop={() => {
                    stopSmartChunkPlayback();
                    if (activeSpeechJobId) {
                      void cancelSpeechJob(activeSpeechJobId).catch(() => undefined);
                      setActiveSpeechJobId(null);
                    }
                    setSmartStatus("ready");
                  }}
                />
              )}
            </>
          ) : (
            <FlexTextarea
              value={message}
            />
          )}
        </div>
      </div>
    </div>
  );
};

function SmartChunkStatusBar({
  status,
  onStop,
}: {
  status: SmartChunkStatus;
  onStop: () => void;
}) {
  return (
    <div
      className="mt-1 flex items-center gap-2 text-xs text-gray-500"
      aria-live="polite"
    >
      {status === "rendering" && <span>Preparing voice…</span>}
      {status === "ready" && <span>Voice ready</span>}
      {status === "playing" && (
        <>
          <span>Speaking…</span>
          <button
            aria-label="Stop voice"
            onClick={onStop}
            className="underline text-red-500 hover:text-red-700"
          >
            Stop voice
          </button>
        </>
      )}
      {status === "complete" && <span>Voice complete</span>}
      {status === "error" && <span>Voice unavailable</span>}
    </div>
  );
}
