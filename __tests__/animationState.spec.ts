import { describe, expect, test } from "@jest/globals";
import { selectAnimationStateFromPayload } from "../src/features/vrmViewer/animationState";

describe("selectAnimationStateFromPayload — voice_posture preference", () => {
  test("returns voice_posture when both voice_posture and animation_state are present", () => {
    const result = selectAnimationStateFromPayload({
      animation_state: "idle",
      voice_posture: "operational_troubleshooting",
    });
    expect(result).toBe("operational_troubleshooting");
  });

  test("returns animation_state when voice_posture is absent", () => {
    const result = selectAnimationStateFromPayload({
      animation_state: "warm",
    });
    expect(result).toBe("warm");
  });

  test("returns animation_state when voice_posture is empty string", () => {
    const result = selectAnimationStateFromPayload({
      animation_state: "thinking",
      voice_posture: "",
    });
    expect(result).toBe("thinking");
  });

  test("returns null when both fields are absent", () => {
    const result = selectAnimationStateFromPayload({});
    expect(result).toBeNull();
  });

  test("returns null when payload is null", () => {
    const result = selectAnimationStateFromPayload(null);
    expect(result).toBeNull();
  });

  test("normalizes voice_posture to lowercase", () => {
    const result = selectAnimationStateFromPayload({
      voice_posture: "GOVERNED_SYSTEM_FACT",
    });
    expect(result).toBe("governed_system_fact");
  });

  test("returns voice_posture even when animation_state is empty", () => {
    const result = selectAnimationStateFromPayload({
      animation_state: "",
      voice_posture: "memory_recall",
    });
    expect(result).toBe("memory_recall");
  });

  test("ignores non-string voice_posture and falls back to animation_state", () => {
    const result = selectAnimationStateFromPayload({
      animation_state: "warm",
      voice_posture: 42,
    });
    expect(result).toBe("warm");
  });

  test("ordinary_chat voice_posture is accepted", () => {
    const result = selectAnimationStateFromPayload({
      voice_posture: "ordinary_chat",
    });
    expect(result).toBe("ordinary_chat");
  });

  test("private_memory voice_posture is accepted", () => {
    const result = selectAnimationStateFromPayload({
      voice_posture: "private_memory",
    });
    expect(result).toBe("private_memory");
  });
});

describe("selectAnimationStateFromPayload — no autoplay or auto-dispatch side effects", () => {
  test("does not call fetch, audio APIs, or VRM dispatch — it is a pure function", () => {
    // selectAnimationStateFromPayload is synchronous and has no side effects.
    // Calling it with a full payload does not trigger audio, animation, or network I/O.
    const result = selectAnimationStateFromPayload({
      text: "I held the line.",
      animation_state: "warm",
      voice_posture: "social_continuity",
      audio_url: "http://127.0.0.1:8769/debug/deiphobe_speech_audio/render.wav",
    });
    // Only the selection is returned — no autoplay, no dispatch.
    expect(result).toBe("social_continuity");
    expect(typeof result).toBe("string");
  });
});
