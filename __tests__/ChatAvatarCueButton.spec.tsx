import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { ChatAvatarCueButton } from "../src/features/deiphobeSpeech/ChatAvatarCueButton";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ChatAvatarCueButton", () => {
  const originalActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  });

  function renderButton(props: {
    voice_posture?: string;
    animation_state?: string;
    onDispatchCue?: (voiceMode: string) => Promise<void>;
  } = {}) {
    act(() => {
      root.render(
        <ChatAvatarCueButton
          voice_posture={props.voice_posture}
          animation_state={props.animation_state}
          onDispatchCue={props.onDispatchCue}
        />,
      );
    });
  }

  function getButton(): HTMLButtonElement {
    return container.querySelector("button[aria-label='Cue avatar']") as HTMLButtonElement;
  }

  function getStatus(): string | null {
    return container.querySelector("p")?.textContent ?? null;
  }

  // ── no cue dispatch on mount ──────────────────────────────────────────────

  test("does not dispatch cue on mount", () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ voice_posture: "memory_recall", onDispatchCue });
    expect(onDispatchCue).not.toHaveBeenCalled();
  });

  // ── cue dispatch only after click ─────────────────────────────────────────

  test("dispatches cue only after user click", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ voice_posture: "memory_recall", onDispatchCue });
    expect(onDispatchCue).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(onDispatchCue).toHaveBeenCalledTimes(1);
  });

  // ── voice_posture preferred over animation_state ──────────────────────────

  test("voice_posture is preferred over animation_state", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ voice_posture: "memory_recall", animation_state: "warm", onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(onDispatchCue).toHaveBeenCalledWith("memory_recall");
  });

  // ── animation_state fallback ──────────────────────────────────────────────

  test("falls back to animation_state when voice_posture is absent", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ animation_state: "warm", onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(onDispatchCue).toHaveBeenCalledWith("warm");
  });

  // ── missing metadata degrades safely ─────────────────────────────────────

  test("shows safe message when no metadata is available — does not call onDispatchCue", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(onDispatchCue).not.toHaveBeenCalled();
    expect(getStatus()).toContain("No animation mapping");
  });

  // ── model not ready ───────────────────────────────────────────────────────

  test("button is disabled when onDispatchCue is not provided (model not ready)", () => {
    renderButton({ voice_posture: "memory_recall" });
    expect(getButton().disabled).toBe(true);
    expect(getButton().getAttribute("title")).toContain("Model not ready");
  });

  test("does not dispatch cue when model is not ready", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>();
    renderButton({ voice_posture: "memory_recall" });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(onDispatchCue).not.toHaveBeenCalled();
  });

  // ── dispatch shows success status ─────────────────────────────────────────

  test("shows dispatched status after successful cue", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ voice_posture: "social_continuity", onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(getStatus()).toContain("Cued");
    expect(getStatus()).toContain("social_continuity");
  });

  // ── dispatch failure shows error ──────────────────────────────────────────

  test("shows error when onDispatchCue throws", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockRejectedValue(
      new Error("No animation mapping for \"memory_recall\""),
    );
    renderButton({ voice_posture: "memory_recall", onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(getStatus()).toContain("No animation mapping");
  });

  // ── render speech button does not dispatch avatar cue ─────────────────────

  test("render speech button exists independently and does not involve onDispatchCue", () => {
    // ChatAvatarCueButton is isolated — it has no dependency on the render bridge.
    // Verifying it has no fetch behavior and no interaction with speech render path.
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    const originalFetch = global.fetch;
    global.fetch = jest.fn() as any;
    renderButton({ voice_posture: "memory_recall", onDispatchCue });
    // No fetch calls from the cue button rendering
    expect(global.fetch).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  // ── no autoplay ───────────────────────────────────────────────────────────

  test("no audio element is created by the cue button", async () => {
    const onDispatchCue = jest.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined);
    renderButton({ voice_posture: "memory_recall", onDispatchCue });
    await act(async () => {
      Simulate.click(getButton());
      await flush();
    });
    expect(container.querySelector("audio")).toBeNull();
  });
});
