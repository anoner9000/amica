import { describe, expect, test } from "@jest/globals";

import { stripLeadingAmicaExpressionTag } from "../src/features/chat/deiphobePrompt";

describe("stripLeadingAmicaExpressionTag", () => {
  test("removes Amica expression tags before Deiphobe prompt routing", () => {
    expect(stripLeadingAmicaExpressionTag("[neutral] [")).toBe("[");
    expect(stripLeadingAmicaExpressionTag("[neutral] (")).toBe("(");
    expect(stripLeadingAmicaExpressionTag("[neutral] 6M41")).toBe("6M41");
    expect(stripLeadingAmicaExpressionTag("[neutral] 6741")).toBe("6741");
  });

  test("leaves non-expression bracket text intact", () => {
    expect(stripLeadingAmicaExpressionTag("[project] status")).toBe("[project] status");
    expect(stripLeadingAmicaExpressionTag("[")).toBe("[");
  });
});
