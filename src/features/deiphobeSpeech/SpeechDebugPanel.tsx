import React, { useMemo, useState } from "react";

import { mockSpeechPayload, type SpeechDebugPayload } from "./mockSpeechPayload";

const SPEECH_DEBUG_ENDPOINT =
  process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_DEBUG_BRIDGE_URL ?? "/debug/deiphobe_speech_payload";

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

export function SpeechDebugPanel({ payload = mockSpeechPayload }: { payload?: SpeechDebugPayload }) {
  const [currentPayload, setCurrentPayload] = useState<SpeechDebugPayload>(payload);
  const [requestText, setRequestText] = useState(payload.visible_text);
  const [requestPosture, setRequestPosture] = useState(payload.speech_plan.posture);
  const [requestOperatorName, setRequestOperatorName] = useState("");
  const [requestPrivateMode, setRequestPrivateMode] = useState(false);
  const [requestIncludeRenderRequest, setRequestIncludeRenderRequest] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const renderRequest = currentPayload.piper_render_request;

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
      setStatusMessage("Fetched live speech metadata.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to fetch speech debug payload.",
      );
    } finally {
      setIsFetching(false);
    }
  }

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
