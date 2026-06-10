import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
  delete (globalThis as any).ReadableStream;
  delete (globalThis as any).TextDecoder;
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
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("I didn't catch enough there.\n"));
          controller.close();
        },
      }),
    });
    (globalThis as any).fetch = fetchMock;
    (globalThis as any).ReadableStream = ReadableStream;
    (globalThis as any).TextDecoder = TextDecoder;

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

  test("passes through streamed Uint8Array response chunks without decoding them twice", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("I didn't catch enough there.\n"));
        controller.close();
      },
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body,
    });
    (globalThis as any).fetch = fetchMock;
    (globalThis as any).ReadableStream = ReadableStream;

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
