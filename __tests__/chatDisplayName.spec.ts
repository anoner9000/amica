import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockConfigValues: Record<string, string> = {
  chatbot_backend: "deiphobe",
  name: "Amica",
};

jest.mock("../src/utils/config", () => ({
  config: (key: string) => mockConfigValues[key] ?? "",
}));

describe("getAssistantChatDisplayName", () => {
  beforeEach(() => {
    mockConfigValues.chatbot_backend = "deiphobe";
    mockConfigValues.name = "Amica";
  });

  test("returns Deiphobe when the deiphobe backend is active", async () => {
    const { getAssistantChatDisplayName } = await import("../src/utils/chatDisplayName");

    expect(getAssistantChatDisplayName()).toBe("Deiphobe");
  });

  test("preserves generic assistant naming for non-Deiphobe backends", async () => {
    mockConfigValues.chatbot_backend = "openai";
    mockConfigValues.name = "Amica";

    const { getAssistantChatDisplayName } = await import("../src/utils/chatDisplayName");

    expect(getAssistantChatDisplayName()).toBe("AMICA");
  });
});
