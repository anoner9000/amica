import React, { useEffect, useRef, useState } from "react";
import {
  callSpeechRenderBridge,
  makeUniqueSpeechOutputFilename,
  SPEECH_RENDER_ENDPOINT,
  type SpeechRenderResult,
} from "./renderBridge";
import {
  readSpeechPlaybackMuted,
  readSpeechPlaybackVolume,
} from "./playbackSettings";

export function ChatSpeechRenderButton({
  text,
  voice_posture,
  animation_state,
  renderEndpoint = SPEECH_RENDER_ENDPOINT,
  autoPreRender = false,
  autoPlayAfterRender = false,
}: {
  text: string;
  voice_posture?: string;
  animation_state?: string;
  renderEndpoint?: string;
  autoPreRender?: boolean;
  autoPlayAfterRender?: boolean;
}) {
  const [isRendering, setIsRendering] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<SpeechRenderResult | null>(null);
  const preRenderFired = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayFiredForUrl = useRef<string | null>(null);

  const effectivePosture =
    (voice_posture ?? "").trim() || (animation_state ?? "").trim() || "neutral";
  const isMuted = readSpeechPlaybackMuted();
  const volume = readSpeechPlaybackVolume();

  async function handleRender() {
    if (isRendering) return;
    setIsRendering(true);
    setRenderError(null);
    setPlaybackStatus(null);
    setAudioUrl(null);
    setRenderResult(null);
    try {
      const outputFilename = makeUniqueSpeechOutputFilename("deiphobe-chat-render", text);
      const data = await callSpeechRenderBridge(
        { text, posture: effectivePosture, output_filename: outputFilename },
        renderEndpoint,
      );
      setRenderResult(data);
      if (data.rendered && data.audio_url) {
        setAudioUrl(data.audio_url);
      } else if (data.rendered) {
        setRenderError("Speech render succeeded without audio_url.");
      } else {
        setRenderError(data.error ?? data.status ?? "Render failed");
      }
    } catch (e: any) {
      setRenderError(e?.message ?? "Render failed");
    } finally {
      setIsRendering(false);
    }
  }

  useEffect(() => {
    if (!autoPlayAfterRender) return;
    if (!audioUrl) return;
    if (autoPlayFiredForUrl.current === audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;

    autoPlayFiredForUrl.current = audioUrl;
    setPlaybackStatus(null);

    let playback: Promise<void> | undefined;
    try {
      playback = audio.play();
    } catch (error: any) {
      setPlaybackStatus("Autoplay blocked by browser. Press play manually.");
      return;
    }

    if (playback && typeof playback.then === "function") {
      void playback
        .then(() => {
          setPlaybackStatus("Autoplay started.");
        })
        .catch(() => {
          setPlaybackStatus("Autoplay blocked by browser. Press play manually.");
        });
      return;
    }

    setPlaybackStatus("Autoplay started.");
  }, [audioUrl, autoPlayAfterRender]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = isMuted;
    audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.6;
  }, [audioUrl, isMuted, volume]);

  useEffect(() => {
    if (!autoPreRender) return;
    if (preRenderFired.current) return;
    preRenderFired.current = true;
    void handleRender();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-1">
      <button
        aria-label="Render speech"
        disabled={isRendering}
        onClick={handleRender}
        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
      >
        {isRendering ? "Rendering\u2026" : "\uD83D\uDD0A Render speech"}
      </button>
      {renderResult === null && renderError !== null && (
        <div className="mt-1 text-[10px] text-orange-600">
          Speech bridge unavailable — check bridge at {renderEndpoint}
        </div>
      )}
      {renderError !== null && (
        <p className="mt-1 text-xs text-red-500">{renderError}</p>
      )}
      {playbackStatus !== null && (
        <p className="mt-1 text-xs text-amber-600">{playbackStatus}</p>
      )}
      {playbackStatus !== null && playbackStatus.includes("blocked") && audioUrl !== null && (
        <button
          type="button"
          onClick={() => { void audioRef.current?.play(); }}
          className="mt-1 text-xs text-blue-600 hover:text-blue-800"
        >
          ▶ Play voice
        </button>
      )}
      {renderResult !== null && (
        <div className="mt-1 text-[10px] leading-4 text-gray-500">
          <div>bridge: {renderEndpoint}</div>
          <div>engine: {renderResult.render_engine ?? "n/a"} | rendered: {String(renderResult.rendered)} | status: {renderResult.status}</div>
          <div>audio_url: {renderResult.audio_url ? "present" : "missing"} | bytes: {renderResult.bytes_received ?? "n/a"}</div>
          {renderResult.error ? <div>error: {renderResult.error}</div> : null}
          <div>autoplay: {String(autoPlayAfterRender)} | muted: {String(isMuted)} | vol: {Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.6}</div>
          {playbackStatus ? <div>play_state: {playbackStatus}</div> : null}
        </div>
      )}
      {audioUrl !== null && (
        <audio key={audioUrl} ref={audioRef} controls src={audioUrl} className="mt-1 w-full max-w-xs" />
      )}
    </div>
  );
}
