import { describe, expect, jest, test } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

jest.mock("../src/utils/config", () => ({
  config: (key: string) => {
    const values: Record<string, string> = {
      chatbot_backend: "deiphobe",
      tts_muted: "true",
      amica_life_enabled: "true",
      external_api_enabled: "false",
      tts_volume: "0.6",
    };
    return values[key] ?? "";
  },
  updateConfig: jest.fn(),
}));

jest.mock("../src/features/externalAPI/externalAPI", () => ({
  handleUserInput: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/VRMAnimation/loadVRMAnimation", () => ({
  loadVRMAnimation: jest.fn().mockResolvedValue(null),
}), { virtual: true });

jest.mock("../src/lib/VRMAnimation/loadVRMAnimation", () => ({
  loadVRMAnimation: jest.fn().mockResolvedValue(null),
}));

(globalThis as any).TextDecoder = TextDecoder;

function makeStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("Deiphobe chat display path", () => {
  test.each(["[", "(", "6741", "62651+"])(
    "displays canonical no-op exactly for noisy input %s",
    async () => {
      const { Chat } = await import("../src/features/chat/chat");
      const chat = new Chat() as any;
      const assistantMessages: string[] = [];

      chat.setChatProcessing = jest.fn();
      chat.setAssistantMessage = jest.fn((message: string) => {
        assistantMessages.push(message);
      });
      chat.setUserMessage = jest.fn();
      chat.setChatLog = jest.fn();
      chat.setShownMessage = jest.fn();
      chat.setThoughtMessage = jest.fn();
      chat.setChatSpeaking = jest.fn();
      chat.streams.push(makeStream("I didn't catch enough there.\n"));

      const displayed = await chat.handleChatResponseStream();

      expect(displayed).toBe("I didn't catch enough there.");
      expect(assistantMessages.at(-1)).toBe("I didn't catch enough there.");
      expect(assistantMessages.join(" ")).not.toContain("Hello");
      expect(assistantMessages.join(" ")).not.toContain("clarification");
    },
  );

  test("does not let Amica Life interrupt Deiphobe user turns", async () => {
    const { Chat } = await import("../src/features/chat/chat");
    const chat = new Chat() as any;
    const amicaLife = { receiveMessageFromUser: jest.fn() };

    chat.amicaLife = amicaLife;
    chat.setChatProcessing = jest.fn();
    chat.setAssistantMessage = jest.fn();
    chat.setUserMessage = jest.fn();
    chat.setChatLog = jest.fn();
    chat.setShownMessage = jest.fn();
    chat.setThoughtMessage = jest.fn();
    chat.setChatSpeaking = jest.fn();
    chat.makeAndHandleStream = jest.fn().mockResolvedValue("I didn't catch enough there.");

    await chat.receiveMessageFromUser("6741", false);

    expect(amicaLife.receiveMessageFromUser).not.toHaveBeenCalled();
    expect(chat.makeAndHandleStream).toHaveBeenCalled();
  });

  test.each(["", "   ", "\n\t"])("ignores blank user turns before chat state or backend: %j", async (message) => {
    const { Chat } = await import("../src/features/chat/chat");
    const chat = new Chat() as any;

    chat.interrupt = jest.fn();
    chat.makeAndHandleStream = jest.fn();
    chat.setChatLog = jest.fn();
    chat.setUserMessage = jest.fn();
    chat.setAssistantMessage = jest.fn();
    chat.setShownMessage = jest.fn();

    await chat.receiveMessageFromUser(message, false);

    expect(chat.interrupt).not.toHaveBeenCalled();
    expect(chat.makeAndHandleStream).not.toHaveBeenCalled();
    expect(chat.setChatLog).not.toHaveBeenCalled();
    expect(chat.setUserMessage).not.toHaveBeenCalled();
  });
});
