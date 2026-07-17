import { describe, expect, test } from "@jest/globals";

import { resolveVoiceVolume, voiceVolumePercent } from "../src/utils/voiceVolume";

describe("voice volume helpers", () => {
  test("defaults to moderate volume", () => {
    expect(resolveVoiceVolume("")).toBe(0.6);
    expect(resolveVoiceVolume(undefined)).toBe(0.6);
  });

  test("clamps to the supported playback range", () => {
    expect(resolveVoiceVolume("-1")).toBe(0);
    expect(resolveVoiceVolume("2")).toBe(1);
    expect(resolveVoiceVolume("0.35")).toBe(0.35);
  });

  test("formats volume as a percent", () => {
    expect(voiceVolumePercent("0.6")).toBe(60);
    expect(voiceVolumePercent("0.333")).toBe(33);
  });
});
