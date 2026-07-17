import * as ort from "onnxruntime-web";
ort.env.wasm.wasmPaths = "/_next/static/chunks/";

import { useContext, useEffect, useRef, useState } from "react";
import { IconButton } from "./iconButton";
import { MicrophoneCapture } from "@/features/microphone/microphoneCapture";
import { useTranscriber } from "@/hooks/useTranscriber";
import {
  cleanTranscript,
  cleanFromPunctuation,
  cleanFromWakeWord,
} from "@/utils/stringProcessing";
import { hasOnScreenKeyboard } from "@/utils/hasOnScreenKeyboard";
import { AlertContext } from "@/features/alert/alertContext";
import { ChatContext } from "@/features/chat/chatContext";
import { openaiWhisper } from "@/features/openaiWhisper/openaiWhisper";
import { whispercpp } from "@/features/whispercpp/whispercpp";
import { config } from "@/utils/config";
import { WaveFile } from "wavefile";
import { AmicaLifeContext } from "@/features/amicaLife/amicaLifeContext";
import { AudioControlsContext } from "@/features/moshi/components/audioControlsContext";
// next.config.js emits these VAD assets into the Next static chunk directory.
const VAD_WORKLET_URL = "/_next/static/chunks/vad.worklet.bundle.min.js";
const VAD_MODEL_URL = "/_next/static/chunks/silero_vad.onnx";

export default function MessageInput({
  userMessage,
  setUserMessage,
  isChatProcessing,
  onChangeUserMessage,
}: {
  userMessage: string;
  setUserMessage: (message: string) => void;
  isChatProcessing: boolean;
  onChangeUserMessage: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}) {
  const transcriber = useTranscriber();
  const inputRef = useRef<HTMLInputElement>(null);
  const [whisperOpenAIOutput, setWhisperOpenAIOutput] = useState<any | null>(
    null,
  );
  const [whisperCppOutput, setWhisperCppOutput] = useState<any | null>(null);
  const { chat: bot } = useContext(ChatContext);
  const { alert } = useContext(AlertContext);
  const { amicaLife } = useContext(AmicaLifeContext);
  const { audioControls: moshi } = useContext(AudioControlsContext);
  const [moshiMuted, setMoshiMuted] = useState(moshi.isMuted());

  // Microphone capture is created lazily and only ever started from the
  // button click. Failures are classified, surfaced through the alert
  // system, and never permanently disable the button — the user can fix
  // the browser permission and simply click again.
  const captureRef = useRef<MicrophoneCapture | null>(null);
  if (captureRef.current === null) {
    captureRef.current = new MicrophoneCapture();
  }
  const [micListening, setMicListening] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [micSpeaking, setMicSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
    };
  }, []);

  function onSpeechStart() {
    console.debug("vad", "on_speech_start");
    console.time("performance_speech");
    setMicSpeaking(true);
  }

  function onSpeechEnd(audio: Float32Array) {
    console.debug("vad", "on_speech_end");
    console.timeEnd("performance_speech");
    console.time("performance_transcribe");
    setMicSpeaking(false);
    (window as any).chatvrm_latency_tracker = {
      start: +Date.now(),
      active: true,
    };

    try {
        switch (config("stt_backend")) {
          case "whisper_browser": {
            console.debug("whisper_browser attempt");
            // since VAD sample rate is same as whisper we do nothing here
            // both are 16000
            const audioCtx = new AudioContext();
            const buffer = audioCtx.createBuffer(1, audio.length, 16000);
            buffer.copyToChannel(audio, 0, 0);
            transcriber.start(buffer);
            break;
          }
          case "whisper_openai": {
            console.debug("whisper_openai attempt");
            const wav = new WaveFile();
            wav.fromScratch(1, 16000, "32f", audio);
            const file = new File([wav.toBuffer()], "input.wav", {
              type: "audio/wav",
            });

            let prompt;
            // TODO load prompt if it exists

            (async () => {
              try {
                const transcript = await openaiWhisper(file, prompt);
                setWhisperOpenAIOutput(transcript);
              } catch (e: any) {
                console.error("whisper_openai error", e);
                alert.error("whisper_openai error", e.toString());
              }
            })();
            break;
          }
          case "whispercpp": {
            console.debug("whispercpp attempt");
            const wav = new WaveFile();
            wav.fromScratch(1, 16000, "32f", audio);
            wav.toBitDepth("16");
            const file = new File([wav.toBuffer()], "input.wav", {
              type: "audio/wav",
            });

            let prompt;
            // TODO load prompt if it exists

            (async () => {
              try {
                const transcript = await whispercpp(file, prompt);
                setWhisperCppOutput(transcript);
              } catch (e: any) {
                console.error("whispercpp error", e);
                alert.error("whispercpp error", e.toString());
              }
            })();
            break;
          }
        }
      } catch (e: any) {
        console.error("stt_backend error", e);
        alert.error("STT backend error", e.toString());
      }
  }

  async function toggleMicrophone() {
    const capture = captureRef.current!;
    if (capture.isActive) {
      capture.stop();
      setMicListening(false);
      setMicSpeaking(false);
      return;
    }
    if (micStarting) {
      return;
    }
    setMicStarting(true);
    try {
      const failure = await capture.start({
        workletURL: VAD_WORKLET_URL,
        modelURL: VAD_MODEL_URL,
        onSpeechStart,
        onSpeechEnd,
        onVADMisfire: () => setMicSpeaking(false),
        onFailure: (sessionFailure) => {
          // A device that disappears mid-session ends the session; the
          // button returns to idle and stays clickable.
          setMicListening(false);
          setMicSpeaking(false);
          alert.error("Microphone", sessionFailure.guidance);
        },
      });
      if (failure === null && capture.isActive) {
        setMicListening(true);
      } else if (failure) {
        alert.error("Microphone", failure.guidance);
      }
    } finally {
      setMicStarting(false);
    }
  }

  function handleTranscriptionResult(preprocessed: string) {
    const cleanText = cleanTranscript(preprocessed);
    const wakeWordEnabled = config("wake_word_enabled") === "true";
    const textStartsWithWakeWord =
      wakeWordEnabled &&
      cleanFromPunctuation(cleanText).startsWith(
        cleanFromPunctuation(config("wake_word")),
      );
    const text =
      wakeWordEnabled && textStartsWithWakeWord
        ? cleanFromWakeWord(cleanText, config("wake_word"))
        : cleanText;

    if (wakeWordEnabled) {
      // Text start with wake word
      if (textStartsWithWakeWord) {
        // Pause amicaLife and update bot's awake status when speaking
        if (config("amica_life_enabled") === "true") {
          amicaLife.pause();
        }
        bot.updateAwake();
        // Case text doesn't start with wake word and not receive trigger message in amica life
      } else {
        if (
          config("amica_life_enabled") === "true" &&
          amicaLife.triggerMessage !== true &&
          !bot.isAwake()
        ) {
          bot.updateAwake();
        }
      }
    } else {
      // If wake word off, update bot's awake when speaking
      if (config("amica_life_enabled") === "true") {
        amicaLife.pause();
        bot.updateAwake();
      }
    }

    if (text === "") {
      return;
    }

    if (config("autosend_from_mic") === "true") {
      if (!wakeWordEnabled || bot.isAwake()) {
        bot.receiveMessageFromUser(text, false);
      }
    } else {
      setUserMessage(text);
    }
    console.timeEnd("performance_transcribe");
  }

  function handleInputChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    onChangeUserMessage(event);

    // Pause amicaLife and update bot's awake status when typing
    if (config("amica_life_enabled") === "true") {
      amicaLife.pause();
      bot.updateAwake();
    }
  }

  // for whisper_browser
  useEffect(() => {
    if (transcriber.output && !transcriber.isBusy) {
      const output = transcriber.output?.text;
      handleTranscriptionResult(output);
    }
  }, [transcriber]);

  // for whisper_openai
  useEffect(() => {
    if (whisperOpenAIOutput) {
      const output = whisperOpenAIOutput?.text;
      handleTranscriptionResult(output);
    }
  }, [whisperOpenAIOutput]);

  // for whispercpp
  useEffect(() => {
    if (whisperCppOutput) {
      const output = whisperCppOutput?.text;
      handleTranscriptionResult(output);
    }
  }, [whisperCppOutput]);

  function clickedSendButton() {
    const message = userMessage.trim();
    if (!message) {
      return;
    }

    bot.receiveMessageFromUser(message, false);
    // only if we are using non-VAD mode should we focus on the input
    if (!micListening) {
      if (!hasOnScreenKeyboard()) {
        inputRef.current?.focus();
      }
    }
    setUserMessage("");
  }

  return (
    <div className="fixed bottom-2 z-20 w-full">
      <div className="mx-auto max-w-4xl rounded-lg border-0 p-2 backdrop-blur-lg">
        <div className="grid grid-flow-col grid-cols-[min-content_1fr_min-content] gap-[8px]">
          <div>
            <div className="flex flex-col items-center justify-center">
              {config("chatbot_backend") === "moshi" ? (
                <IconButton
                  iconName={!moshiMuted ? "24/PauseAlt" : "24/Microphone"}
                  className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled"
                  isProcessing={moshiMuted && moshi.getRecorder() != null}
                  disabled={!moshi.getRecorder()}
                  onClick={() => {
                    moshi.toggleMute();
                    setMoshiMuted(!moshiMuted);
                  }}
                />
              ) : (
                <IconButton
                  iconName={micListening ? "24/PauseAlt" : "24/Microphone"}
                  label="Microphone"
                  className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled"
                  isProcessing={micSpeaking || micStarting}
                  disabled={config("stt_backend") === "none"}
                  onClick={toggleMicrophone}
                />
              )}
            </div>
          </div>

          <input
            type="text"
            ref={inputRef}
            placeholder={
              config("chatbot_backend") === "moshi"
                ? "Disabled in moshi chatbot"
                : "Write message here..."
            }
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (hasOnScreenKeyboard()) {
                  inputRef.current?.blur();
                }

                if (userMessage === "") {
                  return false;
                }

                clickedSendButton();
              }
            }}
            disabled={config("chatbot_backend") === "moshi"}
            className="disabled block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-gray-400 sm:text-sm sm:leading-6"
            value={userMessage}
            autoComplete="off"
          />

          <div className="flex flex-col items-center justify-center">
            <IconButton
              iconName="24/Send"
              className="ml-2 bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled"
              isProcessing={isChatProcessing || transcriber.isBusy}
              disabled={
                isChatProcessing ||
                !userMessage.trim() ||
                transcriber.isModelLoading ||
                config("chatbot_backend") === "moshi"
              }
              onClick={clickedSendButton}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
