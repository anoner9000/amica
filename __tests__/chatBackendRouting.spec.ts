import { describe, expect, test } from "@jest/globals";

import { shouldUseReasoningEngine } from "../src/features/chat/chatBackendRouting";

describe("shouldUseReasoningEngine", () => {
  test("does not route Deiphobe through the reasoning engine", () => {
    expect(shouldUseReasoningEngine("deiphobe", "true")).toBe(false);
  });

  test("preserves reasoning-engine routing for non-Deiphobe backends", () => {
    expect(shouldUseReasoningEngine("chatgpt", "true")).toBe(true);
    expect(shouldUseReasoningEngine("chatgpt", "false")).toBe(false);
  });
});
