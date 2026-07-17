/**
 * @jest-environment node
 *
 * Server-side authority for dataHandlerStorage/config.json:
 * - only deliberate single-key mutations with a matching revision are accepted;
 * - stale/absent revisions are rejected 409 without touching the file;
 * - invalid payloads are rejected 400 without touching the file;
 * - persistence is atomic and preserves the file mode;
 * - a failed atomic replacement leaves the previous file byte-identical.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// dataHelper transitively imports the VRM/three.js animation stack via
// utils/config → externalAPI; irrelevant to server-side authority.
jest.mock("../src/features/amicaLife/eventHandler", () => ({
  MAX_STORAGE_TOKENS: 1000,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let storageDir: string;
let configPath: string;

const FIXTURE_CONFIG = {
  name: "Deiphobe",
  tts_backend: "piper",
  deiphobe_private_mode: "true",
};

function sha256(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function loadModules() {
  let dataHelper: any;
  let dataHandler: any;
  jest.isolateModules(() => {
    process.env.AMICA_DATA_HANDLER_STORAGE_DIR = storageDir;
    process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL = "http://localhost:3000";
    dataHelper = require("../src/features/externalAPI/dataHelper");
    dataHandler = require("../src/pages/api/dataHandler");
  });
  return { dataHelper, dataHandler };
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end(payload?: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function postConfig(handler: any, body: unknown, revision?: string) {
  const req: any = {
    method: "POST",
    query: { type: "config" },
    headers: revision ? { "x-config-revision": revision } : {},
    body,
  };
  const res = mockRes();
  handler.default(req, res);
  return res;
}

function getConfig(handler: any) {
  const req: any = { method: "GET", query: { type: "config" }, headers: {} };
  const res = mockRes();
  handler.default(req, res);
  return res;
}

beforeEach(() => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "amica-config-authority-"));
  configPath = path.join(storageDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(FIXTURE_CONFIG, null, 2), {
    mode: 0o600,
  });
});

afterEach(() => {
  delete process.env.AMICA_DATA_HANDLER_STORAGE_DIR;
  fs.rmSync(storageDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe("server config authority", () => {
  test("GET returns the config and issues the current revision", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const res = getConfig(dataHandler);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(FIXTURE_CONFIG);
    expect(res.headers["x-config-revision"]).toBe(before);
    expect(sha256(configPath)).toBe(before);
  });

  test("a deliberate save with the current revision writes and updates the revision", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const res = postConfig(dataHandler, { key: "name", value: "Dei" }, before);
    expect(res.statusCode).toBe(200);
    const after = sha256(configPath);
    expect(after).not.toBe(before);
    expect(res.headers["x-config-revision"]).toBe(after);
    expect((res.body as any).revision).toBe(after);
    expect(JSON.parse(fs.readFileSync(configPath, "utf8")).name).toBe("Dei");
  });

  test("a successful save preserves the file mode", () => {
    const { dataHandler } = loadModules();
    const res = postConfig(
      dataHandler,
      { key: "name", value: "Dei" },
      sha256(configPath),
    );
    expect(res.statusCode).toBe(200);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  test("a stale revision is rejected 409 and the file is byte-identical", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const res = postConfig(dataHandler, { key: "name", value: "Mallory" }, "stale");
    expect(res.statusCode).toBe(409);
    expect(res.headers["x-config-revision"]).toBe(before);
    expect((res.body as any).revision).toBe(before);
    expect(sha256(configPath)).toBe(before);
  });

  test("an absent revision is rejected 409 and the file is byte-identical", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const res = postConfig(dataHandler, { key: "name", value: "Mallory" });
    expect(res.statusCode).toBe(409);
    expect(sha256(configPath)).toBe(before);
  });

  test("bulk replacement bodies are rejected 400 and the file is byte-identical", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const res = postConfig(dataHandler, { name: "X", tts_backend: "none" }, before);
    expect(res.statusCode).toBe(400);
    expect(sha256(configPath)).toBe(before);
  });

  test("unknown keys, non-string values, and malformed bodies never touch the file", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    for (const body of [
      { key: "not_a_real_key", value: "x" },
      { key: "name", value: 42 },
      { key: "", value: "x" },
      ["name", "x"],
      null,
      "name=x",
    ]) {
      const res = postConfig(dataHandler, body, before);
      expect([400, 409]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(200);
      expect(sha256(configPath)).toBe(before);
    }
  });

  test("a failed atomic replacement leaves the previous file byte-identical", () => {
    const { dataHandler } = loadModules();
    const before = sha256(configPath);
    const renameSpy = jest.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated rename failure");
    });
    const req: any = {
      method: "POST",
      query: { type: "config" },
      headers: { "x-config-revision": before },
      body: { key: "name", value: "Dei" },
    };
    const res = mockRes();
    dataHandler.default(req, res);
    renameSpy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(sha256(configPath)).toBe(before);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    const leftovers = fs
      .readdirSync(storageDir)
      .filter((f) => f.startsWith("config.json.tmp-"));
    expect(leftovers).toEqual([]);
  });

  test("a successful save keeps a bounded previous-version backup", () => {
    const { dataHandler } = loadModules();
    const originalBytes = fs.readFileSync(configPath);
    const res = postConfig(
      dataHandler,
      { key: "name", value: "Dei" },
      sha256(configPath),
    );
    expect(res.statusCode).toBe(200);
    const bak = fs.readFileSync(`${configPath}.bak`);
    expect(bak.equals(originalBytes)).toBe(true);
  });
});
