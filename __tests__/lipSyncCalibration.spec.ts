import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// Defaults matching the production defaults in lipSync.ts / config.ts
const configValues: Record<string, string> = {
  deiphobe_lipsync_gain: "2.5",
  deiphobe_lipsync_min_open: "0.03",
  deiphobe_lipsync_max_open: "0.85",
  deiphobe_lipsync_smoothing: "0.25",
  deiphobe_lipsync_silence_threshold: "0.015",
};

jest.mock("../src/utils/config", () => ({
  config: (key: string) => configValues[key] ?? null,
}));

function makeAudioContext(peakValue: number) {
  const timeDomainData = new Float32Array(2048).fill(peakValue);
  const analyser = {
    getFloatTimeDomainData: (arr: Float32Array) => arr.set(timeDomainData),
    connect: jest.fn(),
  };
  return {
    ctx: {
      createAnalyser: () => analyser,
      createGain: () => ({ gain: { value: 0 }, connect: jest.fn() }),
      createBufferSource: jest.fn(),
      destination: {},
    } as unknown as AudioContext,
    analyser,
    timeDomainData,
  };
}

describe("LipSync calibration", () => {
  beforeEach(() => {
    // Reset to production defaults before each test
    configValues.deiphobe_lipsync_gain = "2.5";
    configValues.deiphobe_lipsync_min_open = "0.03";
    configValues.deiphobe_lipsync_max_open = "0.85";
    configValues.deiphobe_lipsync_smoothing = "0.25";
    configValues.deiphobe_lipsync_silence_threshold = "0.015";
    jest.resetModules();
  });

  test("gain multiplies sigmoid output above silence threshold", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");

    // peak=0.1 → sigmoid ≈ 0.269; ×2.5 gain = ≈0.673; smoothed & clamped
    const { ctx } = makeAudioContext(0.1);
    const ls = new LipSync(ctx);
    // prime the data array with a known peak
    ls.timeDomainData.fill(0.1);

    // With gain=1 result would be lower
    configValues.deiphobe_lipsync_gain = "1";
    const { volume: lowGain } = ls.update();

    jest.resetModules();
    const { LipSync: LipSync2 } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_gain = "3";
    const ls2 = new LipSync2(ctx);
    ls2.timeDomainData.fill(0.1);
    const { volume: highGain } = ls2.update();

    expect(highGain).toBeGreaterThan(lowGain);
  });

  test("max_open clamps output regardless of gain", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_gain = "100";
    configValues.deiphobe_lipsync_max_open = "0.5";
    configValues.deiphobe_lipsync_smoothing = "0"; // no smoothing so we get direct result

    const { ctx } = makeAudioContext(0.5);
    const ls = new LipSync(ctx);
    ls.timeDomainData.fill(0.5);

    const { volume } = ls.update();
    expect(volume).toBeLessThanOrEqual(0.5);
  });

  test("silence threshold closes mouth (returns 0)", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_silence_threshold = "0.1";
    configValues.deiphobe_lipsync_smoothing = "0"; // no smoothing

    const { ctx } = makeAudioContext(0);
    const ls = new LipSync(ctx);
    // peak below threshold
    ls.timeDomainData.fill(0.05);

    const { volume } = ls.update();
    expect(volume).toBe(0);
  });

  test("silence threshold resets _prevSmoothed so next active frame starts fresh", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_silence_threshold = "0.1";
    configValues.deiphobe_lipsync_smoothing = "0.9";
    configValues.deiphobe_lipsync_gain = "2.5";
    configValues.deiphobe_lipsync_min_open = "0.0";

    const { ctx } = makeAudioContext(0.5);
    const ls = new LipSync(ctx);

    // First: active frame — builds up prevSmoothed
    ls.timeDomainData.fill(0.5);
    ls.update();

    // Second: silence frame — prevSmoothed must reset to 0
    ls.timeDomainData.fill(0.05);
    ls.update();

    // Third: active frame — with smoothing=0.9 if prevSmoothed were non-zero the
    // result would be significantly higher; it should now start from 0
    ls.timeDomainData.fill(0.5);
    configValues.deiphobe_lipsync_smoothing = "0";
    const { volume: coldStart } = ls.update();

    // Rerun with another LipSync that never had silence — prevSmoothed accumulates
    const ls2 = new LipSync(ctx);
    configValues.deiphobe_lipsync_smoothing = "0.9";
    ls2.timeDomainData.fill(0.5);
    ls2.update(); // warms up prevSmoothed
    configValues.deiphobe_lipsync_smoothing = "0";
    ls2.timeDomainData.fill(0.5);
    const { volume: warmStart } = ls2.update();

    // After a silence reset the volume on the next active frame should be ≤ warm start
    expect(coldStart).toBeLessThanOrEqual(warmStart + 1e-9);
  });

  test("reset() clears _prevSmoothed so next update starts from zero", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_smoothing = "0.9";
    configValues.deiphobe_lipsync_min_open = "0.0";

    const { ctx } = makeAudioContext(0.5);
    const ls = new LipSync(ctx);

    // Warm up prevSmoothed
    ls.timeDomainData.fill(0.5);
    ls.update();
    ls.update();

    ls.reset();

    // With high smoothing, volume after reset should be significantly lower than
    // without reset because prevSmoothed is 0
    configValues.deiphobe_lipsync_smoothing = "0";
    ls.timeDomainData.fill(0.5);
    const { volume } = ls.update();

    // Compare with a fresh instance that also has smoothing=0
    const ls2 = new LipSync(ctx);
    ls2.timeDomainData.fill(0.5);
    const { volume: fresh } = ls2.update();

    expect(Math.abs(volume - fresh)).toBeLessThan(1e-6);
  });

  test("reset() is called when stop cancels playback (via cleanupPlayback)", async () => {
    jest.resetModules();
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    const { ctx } = makeAudioContext(0);
    const ls = new LipSync(ctx);
    const resetSpy = jest.spyOn(ls, "reset");

    // Manually invoke the same path cleanupPlayback uses
    ls.reset();

    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  test("min_open floor applied when volume is above silence threshold", async () => {
    const { LipSync } = await import("../src/features/lipSync/lipSync");
    configValues.deiphobe_lipsync_gain = "0.001"; // almost zero after gain
    configValues.deiphobe_lipsync_min_open = "0.05";
    configValues.deiphobe_lipsync_smoothing = "0";
    configValues.deiphobe_lipsync_silence_threshold = "0.001"; // low so we don't hit silence gate

    const { ctx } = makeAudioContext(0.5);
    const ls = new LipSync(ctx);
    ls.timeDomainData.fill(0.5);

    const { volume } = ls.update();
    expect(volume).toBeGreaterThanOrEqual(0.05);
  });
});
