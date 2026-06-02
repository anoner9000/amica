import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
  delete (globalThis as any).ReadableStream;
});

describe("getDeiphobeChatResponseStream", () => {
  test("sends visible text without Amica expression tag", async () => {
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
      { role: "user", content: "[neutral] 6M41" },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deiphobeChat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"text":"6M41"'),
      }),
    );
    expect(fetchMock.mock.calls[0][1].body).not.toContain("[neutral]");
  });
});
