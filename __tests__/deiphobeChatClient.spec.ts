import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
  delete (globalThis as any).ReadableStream;
});

describe("getDeiphobeChatResponseStream", () => {
  test.each([
    ["[neutral] [", "["],
    ["[neutral] (", "("],
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
});
