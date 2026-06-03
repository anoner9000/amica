import React, { useEffect, useRef, useState } from "react";

const SPEECH_RENDER_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_RENDER_BRIDGE_URL ?? "/debug/deiphobe_speech_render";

type RenderResult = {
  rendered: boolean;
  status: string;
  error?: string | null;
  audio_url?: string | null;
};

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
  const preRenderFired = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayFiredForUrl = useRef<string | null>(null);

  const effectivePosture =
    (voice_posture ?? "").trim() || (animation_state ?? "").trim() || "neutral";

  async function handleRender() {
    if (isRendering) return;
    setIsRendering(true);
    setRenderError(null);
    setPlaybackStatus(null);
    try {
      const resp = await fetch(renderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          posture: effectivePosture,
          include_render_request: true,
          output_filename: "deiphobe-chat-render.wav",
        }),
      });
      const data: RenderResult = await resp.json();
      if (data.rendered && data.audio_url) {
        setAudioUrl(data.audio_url);
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
    if (!autoPreRender || !autoPlayAfterRender) return;
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
  }, [audioUrl, autoPreRender, autoPlayAfterRender]);

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
      {renderError !== null && (
        <p className="mt-1 text-xs text-red-500">{renderError}</p>
      )}
      {playbackStatus !== null && (
        <p className="mt-1 text-xs text-amber-600">{playbackStatus}</p>
      )}
      {audioUrl !== null && (
        <audio ref={audioRef} controls src={audioUrl} className="mt-1 w-full max-w-xs" />
      )}
    </div>
  );
}
