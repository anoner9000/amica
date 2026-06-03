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
}: {
  text: string;
  voice_posture?: string;
  animation_state?: string;
  renderEndpoint?: string;
  autoPreRender?: boolean;
}) {
  const [isRendering, setIsRendering] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const preRenderFired = useRef(false);

  const effectivePosture =
    (voice_posture ?? "").trim() || (animation_state ?? "").trim() || "";

  async function handleRender() {
    if (isRendering) return;
    setIsRendering(true);
    setRenderError(null);
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
      {audioUrl !== null && (
        <audio controls src={audioUrl} className="mt-1 w-full max-w-xs" />
      )}
    </div>
  );
}
