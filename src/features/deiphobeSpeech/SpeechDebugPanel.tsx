import React, { useMemo, useState } from "react";

import { resolveAnimationStatePath } from "../vrmViewer/animationState";
import { mockSpeechPayload, type SpeechDebugPayload } from "./mockSpeechPayload";

const SPEECH_DEBUG_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_DEBUG_BRIDGE_URL ?? "/debug/deiphobe_speech_payload";
const SPEECH_RENDER_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_RENDER_BRIDGE_URL ?? "/debug/deiphobe_speech_render";
const DEFAULT_RENDER_OUTPUT = "/tmp/deiphobe-speech-test/debug.wav";
const RENDER_OUTPUT_FILENAME = "deiphobe-debug-render.wav";

const VOICE_POSTURE_OPTIONS = [
  "operational_troubleshooting",
  "governed_system_fact",
  "bounded_reflection",
  "social_continuity",
  "conversation_recency",
  "memory_recall",
  "memory_write",
  "creative_chat",
  "ordinary_chat",
  "private_memory",
  "neutral",
] as const;

type RenderResult = {
  rendered: boolean;
  status: string;
  content_type?: string | null;
  bytes_received?: number | null;
  output_path?: string | null;
  error?: string | null;
  audio_url?: string | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-2 text-sm text-gray-700">{children}</div>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-36 shrink-0 font-medium text-gray-500">{label}</span>
      <span className="break-all text-gray-800">{value}</span>
    </div>
  );
}

function shellQuote(value: string): string {
  if (!value) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildRenderCommandPreview({
  text,
  posture,
  operatorName,
  privateMode,
}: {
  text: string;
  posture: string;
  operatorName: string;
  privateMode: boolean;
}): string {
  const parts = [
    "python3",
    "ops/scripts/deiphobe/speech_render_dry_run.py",
    "--text",
    shellQuote(text),
    "--posture",
    shellQuote(posture),
  ];

  if (operatorName.trim()) {
    parts.push("--operator-name", shellQuote(operatorName.trim()));
  }

  if (privateMode) {
    parts.push("--private-mode");
  }

  parts.push("--render", "--out", DEFAULT_RENDER_OUTPUT);
  return parts.join(" ");
}

function isSpeechDebugPayload(value: unknown): value is SpeechDebugPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<SpeechDebugPayload>;
  return (
    typeof payload.visible_text === "string" &&
    typeof payload.spoken_text === "string" &&
    typeof payload.speech_plan === "object" &&
    typeof payload.avatar_cues === "object"
  );
}

export function SpeechDebugPanel({
  payload = mockSpeechPayload,
  onDispatchCue,
  onResolveAnimationPath = resolveAnimationStatePath,
}: {
  payload?: SpeechDebugPayload;
  onDispatchCue?: (voiceMode: string) => Promise<void>;
  onResolveAnimationPath?: (voiceMode: string) => Promise<string>;
}) {
  const [currentPayload, setCurrentPayload] = useState<SpeechDebugPayload>(payload);
  const [requestText, setRequestText] = useState(payload.visible_text);
  const [requestPosture, setRequestPosture] = useState(payload.speech_plan.posture);
  const [requestOperatorName, setRequestOperatorName] = useState("");
  const [requestPrivateMode, setRequestPrivateMode] = useState(false);
  const [requestIncludeRenderRequest, setRequestIncludeRenderRequest] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [renderStatusMessage, setRenderStatusMessage] = useState<string | null>(null);
  const [isCueing, setIsCueing] = useState(false);
  const [cueStatusMessage, setCueStatusMessage] = useState<string | null>(null);
  const [postureOverride, setPostureOverride] = useState<string>("");
  const [resolvedAnimPath, setResolvedAnimPath] = useState<string | null>(null);

  const effectiveVoiceMode = postureOverride || currentPayload.avatar_cues.voice_mode;

  const renderRequest = currentPayload.piper_render_request;
  const renderCommandPreview = useMemo(
    () =>
      buildRenderCommandPreview({
        text: requestText || currentPayload.visible_text,
        posture: requestPosture || currentPayload.speech_plan.posture,
        operatorName: requestOperatorName,
        privateMode: requestPrivateMode || Boolean(currentPayload.avatar_cues.private_mode),
      }),
    [
      currentPayload.avatar_cues.private_mode,
      currentPayload.speech_plan.posture,
      currentPayload.visible_text,
      requestOperatorName,
      requestPosture,
      requestPrivateMode,
      requestText,
    ],
  );

  const payloadPreview = useMemo(() => currentPayload, [currentPayload]);

  async function fetchSpeechPayload() {
    setIsFetching(true);
    setStatusMessage(null);
    try {
      const response = await fetch(SPEECH_DEBUG_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: requestText,
          posture: requestPosture,
          operator_name: requestOperatorName.trim() || undefined,
          private_mode: requestPrivateMode,
          include_render_request: requestIncludeRenderRequest,
        }),
      });

      if (response.status === 403) {
        setStatusMessage("Speech debug bridge is disabled");
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body.trim() || `Speech debug bridge request failed (${response.status})`);
      }

      const nextPayload: unknown = await response.json();
      if (!isSpeechDebugPayload(nextPayload)) {
        throw new Error("Speech debug bridge returned an invalid payload");
      }

      setCurrentPayload(nextPayload);
      setRequestText(nextPayload.visible_text);
      setRequestPosture(nextPayload.speech_plan.posture);
      setRequestPrivateMode(Boolean(nextPayload.avatar_cues.private_mode));
      setRequestIncludeRenderRequest(Boolean(nextPayload.piper_render_request));
      setStatusMessage("Fetched live speech metadata.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to fetch speech debug payload.",
      );
    } finally {
      setIsFetching(false);
    }
  }

  async function dispatchAvatarCue() {
    if (!onDispatchCue) return;
    setIsCueing(true);
    setCueStatusMessage(null);
    try {
      const resolvedPath = await onResolveAnimationPath(effectiveVoiceMode);
      setResolvedAnimPath(resolvedPath);
      await onDispatchCue(effectiveVoiceMode);
      const overrideNote = postureOverride ? ` (override: ${postureOverride})` : "";
      setCueStatusMessage(`Dispatched ${effectiveVoiceMode}${overrideNote}`);
    } catch (error) {
      setCueStatusMessage(
        error instanceof Error ? error.message : "Failed to dispatch avatar cue.",
      );
    } finally {
      setIsCueing(false);
    }
  }

  async function renderAudio() {
    setIsRendering(true);
    setRenderStatusMessage(null);
    try {
      const response = await fetch(SPEECH_RENDER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: requestText,
          posture: requestPosture,
          operator_name: requestOperatorName.trim() || undefined,
          private_mode: requestPrivateMode,
          include_render_request: requestIncludeRenderRequest,
          output_filename: RENDER_OUTPUT_FILENAME,
        }),
      });

      if (response.status === 403) {
        setRenderStatusMessage("Speech render bridge is disabled");
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body.trim() || `Speech render bridge request failed (${response.status})`);
      }

      const result = (await response.json()) as RenderResult;
      setRenderResult(result);
    } catch (error) {
      setRenderStatusMessage(
        error instanceof Error ? error.message : "Failed to render audio.",
      );
    } finally {
      setIsRendering(false);
    }
  }

  async function renderAndCue() {
    await renderAudio();
    await dispatchAvatarCue();
  }

  const isBusy = isFetching || isRendering || isCueing;

  return (
    <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Deiphobe Speech Debug</h2>
          <p className="text-sm text-gray-600">Metadata only. No autoplay. No reply mutation.</p>
        </div>
        <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white">dev only</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Section title="Debug Request">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">text</span>
              <textarea
                name="text"
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
                rows={3}
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">posture</span>
              <input
                name="posture"
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
                value={requestPosture}
                onChange={(event) => setRequestPosture(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">operator_name</span>
              <input
                name="operator_name"
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
                value={requestOperatorName}
                onChange={(event) => setRequestOperatorName(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                name="private_mode"
                type="checkbox"
                checked={requestPrivateMode}
                onChange={(event) => setRequestPrivateMode(event.target.checked)}
              />
              private_mode
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                name="include_render_request"
                type="checkbox"
                checked={requestIncludeRenderRequest}
                onChange={(event) => setRequestIncludeRenderRequest(event.target.checked)}
              />
              include_render_request
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isFetching}
                onClick={fetchSpeechPayload}
              >
                {isFetching ? "Fetching..." : "Fetch speech payload"}
              </button>
              <span className="text-xs text-gray-500">Endpoint: {SPEECH_DEBUG_ENDPOINT}</span>
            </div>
            {statusMessage ? (
              <p role="alert" className="text-sm text-gray-700">
                {statusMessage}
              </p>
            ) : null}
          </div>
        </Section>

        <Section title="Cue Preview">
          <div className="space-y-1">
            <KeyValue
              label="voice_mode"
              value={
                <span className="font-semibold text-indigo-700">
                  {effectiveVoiceMode}
                  {postureOverride ? " (override)" : ""}
                </span>
              }
            />
            <KeyValue label="animation path" value={resolvedAnimPath ?? "—  dispatch to resolve"} />
            <KeyValue label="pace" value={payloadPreview.speech_plan.pace} />
            <KeyValue label="pitch_shape" value={payloadPreview.speech_plan.pitch_shape} />
            <KeyValue label="pause_before_ms" value={String(payloadPreview.speech_plan.pause_before_ms)} />
            <KeyValue label="pauses" value={String(payloadPreview.speech_plan.pauses.length)} />
            <KeyValue label="posture (request)" value={payloadPreview.speech_plan.posture} />
          </div>
        </Section>

        <Section title="Visible Text">
          <pre className="whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-900">{payloadPreview.visible_text}</pre>
        </Section>
        <Section title="Spoken Text">
          <pre className="whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-900">{payloadPreview.spoken_text}</pre>
        </Section>
        <Section title="Speech Plan">
          <div className="space-y-1">
            <KeyValue label="voice_mode" value={payloadPreview.speech_plan.voice_mode} />
            <KeyValue label="pace" value={payloadPreview.speech_plan.pace} />
            <KeyValue label="pause_before_ms" value={payloadPreview.speech_plan.pause_before_ms} />
            <KeyValue label="emphasis" value={payloadPreview.speech_plan.emphasis.join(", ") || "none"} />
          </div>
        </Section>
        <Section title="piper_render_request">
          {renderRequest ? (
            <div className="space-y-1">
              <KeyValue label="render_text" value={renderRequest.render_text} />
              <KeyValue label="rate" value={renderRequest.rate} />
              <KeyValue label="volume" value={renderRequest.volume} />
            </div>
          ) : (
            <p className="text-gray-500">No render request.</p>
          )}
        </Section>
        <Section title="Render command preview">
          <div className="space-y-2">
            <pre className="whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-900">
              {renderCommandPreview}
            </pre>
            <p className="text-xs text-gray-500">
              Preview only. This panel does not render or autoplay audio.
            </p>
          </div>
        </Section>
        <Section title="Render Audio">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md bg-gray-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isRendering || isFetching}
                onClick={renderAudio}
              >
                {isRendering ? "Rendering..." : "Render audio"}
              </button>
              <span className="text-xs text-gray-500">Endpoint: {SPEECH_RENDER_ENDPOINT}</span>
            </div>
            {renderStatusMessage ? (
              <p role="alert" className="text-sm text-gray-700">
                {renderStatusMessage}
              </p>
            ) : null}
            <p className="text-xs text-gray-500">
              Sends current text/posture to the local render bridge. No autoplay.
            </p>
          </div>
        </Section>
        {renderResult ? (
          <Section title="Render Result">
            <div className="space-y-1">
              <KeyValue label="rendered" value={String(renderResult.rendered)} />
              <KeyValue label="status" value={renderResult.status} />
              {renderResult.content_type ? (
                <KeyValue label="content_type" value={renderResult.content_type} />
              ) : null}
              {renderResult.bytes_received != null ? (
                <KeyValue label="bytes_received" value={String(renderResult.bytes_received)} />
              ) : null}
              {renderResult.output_path ? (
                <KeyValue label="output_path" value={renderResult.output_path} />
              ) : null}
              {renderResult.error ? (
                <KeyValue label="error" value={renderResult.error} />
              ) : null}
              {renderResult.audio_url ? (
                <div className="pt-1">
                  <audio controls src={renderResult.audio_url} />
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}
        <Section title="Avatar Cue Dispatch">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                voice_posture override (debug only)
              </span>
              <select
                name="voice_posture_override"
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
                value={postureOverride}
                onChange={(event) => setPostureOverride(event.target.value)}
              >
                <option value="">use payload ({currentPayload.avatar_cues.voice_mode})</option>
                {VOICE_POSTURE_OPTIONS.map((posture) => (
                  <option key={posture} value={posture}>{posture}</option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <KeyValue label="voice_mode" value={effectiveVoiceMode} />
              <KeyValue label="quiet_private" value={String(currentPayload.avatar_cues.quiet_private)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!onDispatchCue || isBusy}
                onClick={renderAndCue}
              >
                {isRendering ? "Rendering…" : isCueing ? "Cueing…" : "Render + Cue"}
              </button>
              <button
                type="button"
                className="rounded-md bg-gray-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!onDispatchCue || isBusy}
                onClick={dispatchAvatarCue}
              >
                {isCueing ? "Dispatching..." : "Dispatch avatar cue"}
              </button>
            </div>
            {cueStatusMessage ? (
              <p role="alert" className="text-sm text-gray-700">
                {cueStatusMessage}
              </p>
            ) : null}
            <p className="text-xs text-gray-500">
              Sends current voice_mode to the local avatar. Debug-only. No autoplay.
            </p>
          </div>
        </Section>
        <Section title="avatar_cues">
          <div className="space-y-1">
            <KeyValue label="voice_mode" value={payloadPreview.avatar_cues.voice_mode} />
            <KeyValue label="private_mode" value={String(payloadPreview.avatar_cues.private_mode)} />
            <KeyValue label="quiet_private" value={String(payloadPreview.avatar_cues.quiet_private)} />
          </div>
        </Section>
        <Section title="Notes">
          <p className="text-gray-600">This panel is read-only until you click Fetch speech payload.</p>
        </Section>
      </div>
    </div>
  );
}

export { mockSpeechPayload };
