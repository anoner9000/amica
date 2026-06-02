import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

jest.mock("../src/utils/config", () => ({
  updateConfig: jest.fn(),
}));

jest.mock("../src/components/settings/common", () => ({
  BasicPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
}));

jest.mock("../src/components/switchBox", () => ({
  SwitchBox: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Deiphobe speech debug panel", () => {
  const originalFetch = global.fetch;
  const originalActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    global.fetch = originalFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  async function renderDeveloperPage() {
    const { DeveloperPage } = await import("../src/components/settings/DeveloperPage");

    await act(async () => {
      root.render(
        <DeveloperPage
          debugGfx={false}
          setDebugGfx={jest.fn()}
          mtoonDebugMode="none"
          setMtoonDebugMode={jest.fn()}
          mtoonMaterialType="mtoon"
          setMtoonMaterialType={jest.fn()}
          useWebGPU={false}
          setUseWebGPU={jest.fn()}
          setSettingsUpdated={jest.fn()}
        />,
      );
    });
  }

  test("renders static metadata-only payload in developer page by default", async () => {
    await renderDeveloperPage();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Deiphobe Speech Debug");
    expect(container.textContent).toContain("Visible Text");
    expect(container.textContent).toContain("Spoken Text");
    expect(container.textContent).toContain("I held the line.");
    expect(container.textContent).toContain("voice_mode");
    expect(container.textContent).toContain("warm_recall");
    expect(container.textContent).toContain("piper_render_request");
    expect(container.textContent).toContain("avatar_cues");
    expect(container.textContent).toContain("quiet_private");
    expect(container.textContent).toContain("Metadata only. No autoplay. No reply mutation.");
    expect(container.querySelector("audio")).toBeNull();
  });

  test("clicking fetch sends the expected POST body and updates the payload", async () => {
    const livePayload = {
      visible_text: "Hello from the bridge.",
      spoken_text: "Hello from the bridge.",
      speech_plan: {
        text: "Hello from the bridge.",
        visible_text: "Hello from the bridge.",
        spoken_text: "Hello from the bridge.",
        posture: "social_continuity",
        signature_phrase: null,
        voice_mode: "warm",
        pace: "slow-normal",
        volume: "low_medium",
        pitch_shape: "soft_falling",
        rate: 1,
        pause_scale: 1,
        pause_before_ms: 0,
        pauses: [],
        emphasis: [],
        pronunciation_overrides: [],
        voice_mode_config: {
          mode: "warm",
          rate: 1,
          volume: "low_medium",
          pause_scale: 1,
          pitch_shape: "soft_falling",
        },
        signature_phrase_config: {
          phrase: "",
          voice_mode: null,
          pace: null,
          pitch_shape: null,
          pause_before_ms: 0,
          emphasis: [],
        },
        safety: {
          content_unchanged: true,
          assertion_added: false,
        },
      },
      piper_render_request: {
        text: "Hello from the bridge.",
        spoken_text: "Hello from the bridge.",
        render_text: "Hello from the bridge.",
        voice_mode: "warm",
        rate: 1,
        volume: "low_medium",
        pause_scale: 1,
        pause_before_ms: 0,
        ignored_metadata: [],
      },
      avatar_cues: {
        voice_mode: "warm",
        pace: "slow-normal",
        pause_before_ms: 0,
        emphasis: [],
        private_mode: true,
        quiet_private: true,
        signature_phrase: null,
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => livePayload,
    });

    await renderDeveloperPage();

    const textArea = container.querySelector("textarea[name='text']") as HTMLTextAreaElement;
    const postureInput = container.querySelector("input[name='posture']") as HTMLInputElement;
    const operatorInput = container.querySelector("input[name='operator_name']") as HTMLInputElement;
    const privateMode = container.querySelector("input[name='private_mode']") as HTMLInputElement;
    const includeRender = container.querySelector("input[name='include_render_request']") as HTMLInputElement;
    const button = Array.from(container.querySelectorAll("button[type='button']")).find((element) =>
      element.textContent?.includes("Fetch speech payload"),
    ) as HTMLButtonElement;

    await act(async () => {
      Simulate.change(textArea, { target: { value: "Hello from the bridge." } });
      Simulate.change(postureInput, { target: { value: "social_continuity" } });
      Simulate.change(operatorInput, { target: { value: "Uther Pendragon" } });
      Simulate.change(privateMode, { target: { checked: true } });
      Simulate.change(includeRender, { target: { checked: false } });
      await flush();
    });

    await act(async () => {
      button.click();
      await flush();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/debug/deiphobe_speech_payload",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello from the bridge.",
          posture: "social_continuity",
          operator_name: "Uther Pendragon",
          private_mode: true,
          include_render_request: false,
        }),
      }),
    );
    expect(container.textContent).toContain("Hello from the bridge.");
    expect(container.textContent).toContain("warm");
    expect(container.textContent).toContain("quiet_private");
  });

  test("shows disabled message for 403 and preserves the last payload", async () => {
    await renderDeveloperPage();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const button = Array.from(container.querySelectorAll("button[type='button']")).find((element) =>
      element.textContent?.includes("Fetch speech payload"),
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
      await flush();
    });

    expect(container.textContent).toContain("Speech debug bridge is disabled");
    expect(container.textContent).toContain("I held the line.");
  });

  test("failed fetch shows an error and preserves previous payload", async () => {
    await renderDeveloperPage();

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    const button = Array.from(container.querySelectorAll("button[type='button']")).find((element) =>
      element.textContent?.includes("Fetch speech payload"),
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
      await flush();
    });

    expect(container.textContent).toContain("network down");
    expect(container.textContent).toContain("I held the line.");
  });
});
