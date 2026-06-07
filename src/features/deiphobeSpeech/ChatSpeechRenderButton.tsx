import React, { useEffect, useRef, useState } from "react";
import {
  callSpeechRenderBridge,
  makeUniqueSpeechOutputFilename,
  SPEECH_RENDER_ENDPOINT,
  type SpeechRenderResult,
} from "./renderBridge";
import {
  playDeiphobeSpeechUrls,
  stopDeiphobeSpeechPlayback,
  type DeiphobeSpeechPlaybackMetadata,
} from "./deiphobeSpeechPlaybackManager";
import type { LipSync } from "@/features/lipSync/lipSync";

export function ChatSpeechRenderButton({
  text,
  voice_posture,
  animation_state,
  renderEndpoint = SPEECH_RENDER_ENDPOINT,
  autoPreRender = false,
  autoPlayAfterRender = false,
  ownerId,
  lipSync,
  onMetadataChange,
}: {
  text: string;
  voice_posture?: string;
  animation_state?: string;
  renderEndpoint?: string;
  autoPreRender?: boolean;
  autoPlayAfterRender?: boolean;
  ownerId: string;
  lipSync?: LipSync;
  onMetadataChange?: (metadata: DeiphobeSpeechPlaybackMetadata | null) => void;
}) {
  const [isRendering, setIsRendering] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<SpeechRenderResult | null>(null);
  const preRenderFired = useRef(false);
  const autoPlayFiredForUrl = useRef<string | null>(null);

  const effectivePosture =
    (voice_posture ?? "").trim() || (animation_state ?? "").trim() || "neutral";
  function buildPlaybackMetadata(data: SpeechRenderResult): DeiphobeSpeechPlaybackMetadata {
    const renderEngine = data.render_engine ?? null;
    const renderMode = data.render_mode ?? (renderEngine === "piper" ? "piper" : "single_file");
    return {
      render_engine: renderEngine,
      profile: data.voice_profile ?? undefined,
      endpoint: renderEndpoint,
      mode: renderMode,
      fallback_used: Boolean(data.fallback_used),
    };
  }

  async function playRenderedAudio(url: string, metadata: DeiphobeSpeechPlaybackMetadata) {
    setPlaybackStatus(null);
    const result = await playDeiphobeSpeechUrls([url], {
      ownerId,
      lipSync,
      metadata,
      onStatus: (status) => {
        if (status === "playing") setPlaybackStatus("Speaking…");
        if (status === "complete") setPlaybackStatus("Voice complete");
        if (status === "error") setPlaybackStatus("Voice unavailable");
      },
    });
    if (result.outcome === "blocked") {
      setPlaybackStatus("Autoplay blocked by browser. Press play manually.");
    } else if (result.outcome === "cancelled") {
      setPlaybackStatus("Voice cancelled.");
    }
  }

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
      onMetadataChange?.(buildPlaybackMetadata(data));
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
    if (!renderResult) return;
    if (autoPlayFiredForUrl.current === audioUrl) return;

    autoPlayFiredForUrl.current = audioUrl;
    void playRenderedAudio(audioUrl, buildPlaybackMetadata(renderResult));
  }, [audioUrl, autoPlayAfterRender, renderResult]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoPreRender) return;
    if (preRenderFired.current) return;
    preRenderFired.current = true;
    void handleRender();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      stopDeiphobeSpeechPlayback(ownerId);
      onMetadataChange?.(null);
    };
  }, [ownerId, onMetadataChange]);

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
      {audioUrl !== null && (
        <button
          type="button"
          onClick={() => {
            if (!renderResult) return;
            void playRenderedAudio(audioUrl, buildPlaybackMetadata(renderResult));
          }}
          className="mt-1 text-xs text-blue-600 hover:text-blue-800"
        >
          ▶ Play voice
        </button>
      )}
      {renderResult !== null && (
        <div className="mt-1 text-[10px] leading-4 text-gray-500">
          <div>bridge: {renderEndpoint}</div>
          <div>engine: {renderResult.render_engine ?? "n/a"} | rendered: {String(renderResult.rendered)} | status: {renderResult.status}</div>
          <div>profile: {renderResult.voice_profile ?? "n/a"} | mode: {renderResult.render_mode ?? "single_file"}</div>
          <div>audio_url: {renderResult.audio_url ? "present" : "missing"} | bytes: {renderResult.bytes_received ?? "n/a"}</div>
          {renderResult.error ? <div>error: {renderResult.error}</div> : null}
          <div>autoplay: {String(autoPlayAfterRender)}</div>
          {playbackStatus ? <div>play_state: {playbackStatus}</div> : null}
        </div>
      )}
    </div>
  );
}
