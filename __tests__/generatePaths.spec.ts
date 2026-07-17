import { describe, expect, test } from "@jest/globals";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const { buildPaths } = require("../scripts/generate_paths.js");

describe("generate_paths", () => {
  test("excludes private VRM avatars while keeping public VRMs", () => {
    const publicRoot = path.join(__dirname, "..", "public");
    const { vrmList } = buildPaths(publicRoot);

    expect(vrmList).toContain("/vrm/deiphobe.vrm");
    expect(vrmList).not.toContain("/vrm/.private/Deiphobe-v0.vrm");
    expect(vrmList).not.toContain("/vrm/.private/deiphobe_v2.vrm");
    expect(vrmList).not.toContain("/vrm/.private/deiphobe_v2_2.vrm");
    expect(vrmList).not.toContain("/vrm/.private/Nerea/NereaVroid.vrm");
    expect(vrmList.some((url: string) => url.startsWith("/vrm/.private/"))).toBe(false);
  });
});
