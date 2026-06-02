import React from "react";

import { mockSpeechPayload, type SpeechDebugPayload } from "./mockSpeechPayload";

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

export function SpeechDebugPanel({ payload = mockSpeechPayload }: { payload?: SpeechDebugPayload }) {
  const renderRequest = payload.piper_render_request;

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
        <Section title="Visible Text">
          <pre className="whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-900">{payload.visible_text}</pre>
        </Section>
        <Section title="Spoken Text">
          <pre className="whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-900">{payload.spoken_text}</pre>
        </Section>
        <Section title="Speech Plan">
          <div className="space-y-1">
            <KeyValue label="voice_mode" value={payload.speech_plan.voice_mode} />
            <KeyValue label="pace" value={payload.speech_plan.pace} />
            <KeyValue label="pause_before_ms" value={payload.speech_plan.pause_before_ms} />
            <KeyValue label="emphasis" value={payload.speech_plan.emphasis.join(", ") || "none"} />
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
            <KeyValue label="voice_mode" value={payload.avatar_cues.voice_mode} />
            <KeyValue label="private_mode" value={String(payload.avatar_cues.private_mode)} />
            <KeyValue label="quiet_private" value={String(payload.avatar_cues.quiet_private)} />
          </div>
        </Section>
        <Section title="Notes">
          <p className="text-gray-600">This panel is read-only and uses a static mocked payload.</p>
        </Section>
      </div>
    </div>
  );
}

export { mockSpeechPayload };
