import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

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

  test("renders static metadata-only payload in developer page", async () => {
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

    expect(container.textContent).toContain("Deiphobe Speech Debug");
    expect(container.textContent).toContain("Visible Text");
    expect(container.textContent).toContain("Spoken Text");
    expect(container.textContent).toContain("voice_mode");
    expect(container.textContent).toContain("warm_recall");
    expect(container.textContent).toContain("piper_render_request");
    expect(container.textContent).toContain("avatar_cues");
    expect(container.textContent).toContain("quiet_private");
    expect(container.textContent).toContain("Metadata only. No autoplay. No reply mutation.");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
