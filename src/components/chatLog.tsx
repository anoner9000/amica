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
import type { DeiphobeSpeechPlaybackMetadata } from "@/features/deiphobeSpeech/deiphobeSpeechPlaybackManager";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { resolveAnimationStatePath } from "@/features/vrmViewer/animationState";
import { loadVRMAnimation } from "@/lib/VRMAnimation/loadVRMAnimation";
import { IconButton } from "@/components/iconButton";
import {
  ArrowPathIcon,
} from '@heroicons/react/20/solid';
import { getAssistantChatDisplayName } from "@/utils/chatDisplayName";
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
        <IconButton
          iconName="24/ReloadLoop"
          label={t("Restart")}
          isProcessing={false}
          className="bg-slate-600 hover:bg-slate-500 active:bg-slate-500 shadow-xl"
          onClick={() => {
            bot.setMessageList([]);
          }}
        ></IconButton>
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
              autoRenderEnabled &&
              smartChunksEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory" &&
              i === newestAssistantIdx;

            const autoBridgeRender =
              autoRenderEnabled &&
              !smartChunksEnabled &&
              msg.role === "assistant" &&
              msg.voice_posture !== "private_memory" &&
              i === newestAssistantIdx;

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
                  autoSmartPlay={autoPlayEnabled}
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
  autoSmartPlay = false,
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
  autoSmartPlay?: boolean;
  lipSync?: import("@/features/lipSync/lipSync").LipSync;
}) {
  const { t } = useTranslation();

  // ── smart-chunk render/play state ─────────────────────────────────────────
  const [smartStatus, setSmartStatus] = useState<SmartChunkStatus>("idle");
  const [speechMetadata, setSpeechMetadata] = useState<DeiphobeSpeechPlaybackMetadata | null>(null);
  const speechOwnerId = `deiphobe-message-${num}`;

  // Refs so async handlers can read the latest prop values without going stale.
  const autoSmartRenderRef = useRef(autoSmartRender);
  const autoBridgeRenderRef = useRef(autoBridgeRender);
  const autoSmartPlayRef = useRef(autoSmartPlay);
  const messageRef = useRef(message);
  useEffect(() => { autoSmartRenderRef.current = autoSmartRender; }, [autoSmartRender]);
  useEffect(() => { autoBridgeRenderRef.current = autoBridgeRender; }, [autoBridgeRender]);
  useEffect(() => { autoSmartPlayRef.current = autoSmartPlay; }, [autoSmartPlay]);
  useEffect(() => { messageRef.current = message; }, [message]);

  // Track whether any auto-render is active to detect true→false transitions.
  const autoRenderActive = autoSmartRender || autoBridgeRender;
  const prevAutoRenderActiveRef = useRef(false);
  // Guards: fire each render path at most once per "newest message" period.
  const smartRenderFiredRef = useRef(false);
  const bridgeRenderFiredRef = useRef(false);

  // Cancel playback when this message is no longer the newest.
  useEffect(() => {
    const wasActive = prevAutoRenderActiveRef.current;
    prevAutoRenderActiveRef.current = autoRenderActive;

    if (wasActive && !autoRenderActive) {
      stopSmartChunkPlayback();
      setSmartStatus("idle");
      setSpeechMetadata(null);
      smartRenderFiredRef.current = false;
      bridgeRenderFiredRef.current = false;
    }
  }, [autoRenderActive]);

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
          result.audioUrls,
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
          await playSmartChunks([result.audio_url], setSmartStatus, lipSync, playbackMeta);
        }
      } catch {
        if (autoBridgeRenderRef.current) setSmartStatus("error");
      }
    })();
  }, [autoBridgeRender, role]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  {speechMetadata.chunk_count != null && (
                    <div>chunk_count: {speechMetadata.chunk_count}</div>
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
