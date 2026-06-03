import React, { useState } from "react";

export function ChatAvatarCueButton({
  voice_posture,
  animation_state,
  onDispatchCue,
}: {
  voice_posture?: string;
  animation_state?: string;
  onDispatchCue?: (voiceMode: string) => Promise<void>;
}) {
  const [isCueing, setIsCueing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const effectiveVoiceMode =
    (voice_posture ?? "").trim() || (animation_state ?? "").trim() || "";

  const modelNotReady = !onDispatchCue;

  async function handleCue() {
    if (!onDispatchCue || isCueing) return;
    if (!effectiveVoiceMode) {
      setStatusMessage("No animation mapping available");
      return;
    }
    setIsCueing(true);
    setStatusMessage(null);
    try {
      await onDispatchCue(effectiveVoiceMode);
      setStatusMessage(`Cued: ${effectiveVoiceMode}`);
    } catch (e: any) {
      setStatusMessage(e?.message ?? "Cue failed");
    } finally {
      setIsCueing(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        aria-label="Cue avatar"
        disabled={isCueing || modelNotReady}
        onClick={handleCue}
        title={modelNotReady ? "Model not ready" : undefined}
        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
      >
        {isCueing ? "Cueing\u2026" : "\uD83C\uDFAD Cue avatar"}
      </button>
      {statusMessage !== null && (
        <p className="mt-1 text-xs text-gray-500">{statusMessage}</p>
      )}
    </div>
  );
}
