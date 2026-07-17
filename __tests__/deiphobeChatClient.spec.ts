import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
  delete (globalThis as any).ReadableStream;
  delete (globalThis as any).TextDecoder;
  delete (globalThis as any).TextEncoder;
});

describe("getDeiphobeChatResponseStream", () => {
  test.each([
    ["[neutral] [", "["],
    ["[neutral] (", "("],
    ["[neutral] idk", "idk"],
    ["[neutral] abc", "abc"],
    ["[neutral] 6741", "6741"],
    ["[neutral] 62651+", "62651+"],
  ])("sends visible text without Amica expression tag: %s", async (input, expectedText) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "I didn't catch enough there.\n" }),
    });
    (globalThis as any).fetch = fetchMock;
    (globalThis as any).ReadableStream = ReadableStream;
    (globalThis as any).TextDecoder = TextDecoder;
    (globalThis as any).TextEncoder = TextEncoder;

    const { getDeiphobeChatResponseStream } = await import("../src/features/chat/deiphobeChat");
    await getDeiphobeChatResponseStream([
      { role: "system", content: "system" },
      { role: "user", content: input },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deiphobeChat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`"text":"${expectedText}"`),
      }),
    );
    expect(fetchMock.mock.calls[0][1].body).not.toContain("[neutral]");
  });

  test("turns the structured response text into a Uint8Array stream", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "I didn't catch enough there.\n" }),
    });
    (globalThis as any).fetch = fetchMock;
    (globalThis as any).ReadableStream = ReadableStream;
    (globalThis as any).TextEncoder = TextEncoder;

    const { getDeiphobeChatResponseStream } = await import("../src/features/chat/deiphobeChat");
    const stream = await getDeiphobeChatResponseStream([
      { role: "system", content: "system" },
      { role: "user", content: "[" },
    ]);

    const reader = stream.getReader();
    const { done, value } = await reader.read();
    expect(done).toBe(false);
    expect(ArrayBuffer.isView(value)).toBe(true);
    expect(new TextDecoder("utf-8").decode(value)).toBe("I didn't catch enough there.\n");
    reader.releaseLock();
  });

  test("emits a trusted interaction event separately from assistant text", async () => {
    const interaction = {
      request_id: "interaction_0123456789abcdef0123456789abcdef",
      kind: "unlock_private_memory",
      title: "Unlock private memory",
      explanation: "Allow approved private claims relevant to this conversation.",
      requested_capability: "personal_claims.read_private",
      action_digest: "a".repeat(64),
      required_authentication: "local_reauthentication",
      expires_at: "2026-07-15T20:00:00Z",
    };
    const listener = jest.fn();
    window.addEventListener("deiphobe:interaction-request", listener);
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "I need private-memory access to answer that accurately.",
        interaction_request: interaction,
      }),
    });
    (globalThis as any).ReadableStream = ReadableStream;
    (globalThis as any).TextEncoder = TextEncoder;

    const { getDeiphobeChatResponseStream } = await import("../src/features/chat/deiphobeChat");
    await getDeiphobeChatResponseStream([{ role: "user", content: "What do you remember?" }]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(interaction);
    window.removeEventListener("deiphobe:interaction-request", listener);
  });

  test("emits a direct memory action separately from assistant text", async () => {
    const memoryAction = {
      action: "explicit_low_risk_save",
      outcome: "saved",
      changed: true,
      undo_token: "undo1.synthetic.signature",
      undo_expires_at: "2026-07-16T20:00:00Z",
    };
    const listener = jest.fn();
    window.addEventListener("deiphobe:memory-action", listener);
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "I remembered: I prefer compact diffs.",
        memory_action: memoryAction,
      }),
    });
    (globalThis as any).ReadableStream = ReadableStream;
    (globalThis as any).TextEncoder = TextEncoder;

    const { getDeiphobeChatResponseStream } = await import("../src/features/chat/deiphobeChat");
    await getDeiphobeChatResponseStream([{ role: "user", content: "Remember that I prefer compact diffs." }]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(memoryAction);
    window.removeEventListener("deiphobe:memory-action", listener);
  });

  test.each(["", "   ", "[neutral]   "])("does not fetch for blank input: %j", async (input) => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    const { getDeiphobeChatResponseStream } = await import("../src/features/chat/deiphobeChat");

    await expect(getDeiphobeChatResponseStream([
      { role: "system", content: "system" },
      { role: "user", content: input },
    ])).rejects.toThrow("Deiphobe backend requires a user message");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendDeiphobeConversationSegmentControl", () => {
  test("sends typed new-segment control without ordinary text", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "I started a fresh conversation." }),
    });
    (globalThis as any).fetch = fetchMock;

    const { sendDeiphobeConversationSegmentControl } = await import("../src/features/chat/deiphobeChat");
    const reply = await sendDeiphobeConversationSegmentControl({
      text: null,
      new_segment: true,
      continue_previous_segment: false,
    });

    expect(reply).toBe("I started a fresh conversation.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deiphobeChat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: null,
          new_segment: true,
          continue_previous_segment: false,
        }),
      }),
    );
  });

  test("sends typed continue-previous control without ordinary text", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "I continued the previous conversation." }),
    });
    (globalThis as any).fetch = fetchMock;

    const { sendDeiphobeConversationSegmentControl } = await import("../src/features/chat/deiphobeChat");
    const reply = await sendDeiphobeConversationSegmentControl({
      text: null,
      new_segment: false,
      continue_previous_segment: true,
    });

    expect(reply).toBe("I continued the previous conversation.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deiphobeChat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: null,
          new_segment: false,
          continue_previous_segment: true,
        }),
      }),
    );
  });
});
