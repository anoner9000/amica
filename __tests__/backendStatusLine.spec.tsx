import { describe, expect, test, jest } from "@jest/globals";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("../src/utils/config", () => ({
  config: jest.fn((key: string) => {
    const values: Record<string, string> = {
      chatbot_backend: "deiphobe",
      deiphobe_session_id: "voice-avatar-test",
    };
    return values[key] ?? "";
  }),
}));

describe("BackendStatusLine", () => {
  test("floating (default) variant renders Backend/Session/Local text", async () => {
    const { BackendStatusLine } = await import("../src/components/backendStatusLine");
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(React.createElement(BackendStatusLine));
    });
    const html = container.innerHTML;
    expect(html).toContain("Backend");
    expect(html).toContain("Session");
    expect(html).toContain("voice-avatar-test");
    document.body.removeChild(container);
  });

  test("floating variant has fixed positioning (shown in debug pane only)", async () => {
    const { BackendStatusLine } = await import("../src/components/backendStatusLine");
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(React.createElement(BackendStatusLine));
    });
    const badge = container.querySelector("[class*='fixed']");
    // It IS a fixed badge — this test documents that BackendStatusLine
    // is intentionally removed from index.tsx to avoid showing it on mobile.
    expect(badge).not.toBeNull();
    document.body.removeChild(container);
  });

  test("inline variant does not use fixed positioning", async () => {
    const { BackendStatusLine } = await import("../src/components/backendStatusLine");
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(React.createElement(BackendStatusLine, { inline: true }));
    });
    const fixedEl = container.querySelector("[class*='fixed']");
    expect(fixedEl).toBeNull();
    document.body.removeChild(container);
  });

  test("index.tsx does not render BackendStatusLine in the main chat UI", async () => {
    // Read the index source and verify BackendStatusLine is not rendered inline
    const fs = await import("fs");
    const path = await import("path");
    const indexSource = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/index.tsx"),
      "utf-8",
    );
    // The JSX element <BackendStatusLine /> must not appear as an active render call
    // (it was replaced with a comment)
    expect(indexSource).not.toMatch(/<BackendStatusLine\s*\/>/);
  });
});
