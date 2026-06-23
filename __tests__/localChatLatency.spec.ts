import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

let consoleSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.useFakeTimers();
  consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  delete (globalThis as any).__amicaLocalChatLatency;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.resetModules();
  delete (globalThis as any).__amicaLocalChatLatency;
});

async function freshTracker() {
  const { localChatLatency } = await import("../src/features/chat/localChatLatency");
  return localChatLatency;
}

describe("LocalChatLatencyTracker", () => {
  test("recordSubmit resets marks and exposes them on globalThis", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    const marks = tracker.getMarks();
    expect(marks.t_submit).toBeDefined();
    expect(marks.t_fetch_start).toBeUndefined();
    expect((globalThis as any).__amicaLocalChatLatency).toEqual(marks);
  });

  test("recordSubmit clears marks from a previous request", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    tracker.recordFetchStart();
    tracker.recordSubmit();
    expect(tracker.getMarks().t_fetch_start).toBeUndefined();
  });

  test("recordFirstChunk only records the first call", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    tracker.recordFirstChunk();
    const first = tracker.getMarks().t_first_chunk;
    tracker.recordFirstChunk();
    expect(tracker.getMarks().t_first_chunk).toBe(first);
  });

  test("recordCommitted stores reply_chars in marks", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    tracker.recordCommitted(142);
    expect(tracker.getMarks().reply_chars).toBe(142);
  });

  test("recordCommitted logs to console.info with all segment labels and reply chars", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    tracker.recordFetchStart();
    tracker.recordFetchDone();
    tracker.recordFirstChunk();
    tracker.recordCommitted(256);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const joined = consoleSpy.mock.calls[0].join(" ");
    expect(joined).toContain("[amica-latency]");
    expect(joined).toContain("submit→fetch:");
    expect(joined).toContain("fetch→response:");
    expect(joined).toContain("response→first_chunk:");
    expect(joined).toContain("first_chunk→committed:");
    expect(joined).toContain("total:");
    expect(joined).toContain("reply: 256 chars");
  });

  test("recordCommitted does not log if recordSubmit was never called", async () => {
    const tracker = await freshTracker();
    tracker.recordCommitted(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("reply_chars is zero when reply is empty", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    tracker.recordCommitted(0);
    expect(tracker.getMarks().reply_chars).toBe(0);
    const joined = consoleSpy.mock.calls[0].join(" ");
    expect(joined).toContain("reply: 0 chars");
  });

  test("getMarks returns a copy so mutating it does not affect internal state", async () => {
    const tracker = await freshTracker();
    tracker.recordSubmit();
    const snap1 = tracker.getMarks();
    (snap1 as any).t_injected = 999;
    expect(tracker.getMarks().t_injected).toBeUndefined();
  });
});
