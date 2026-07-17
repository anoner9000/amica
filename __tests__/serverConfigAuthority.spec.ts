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
  let apiHelper: any;
  jest.isolateModules(() => {
    process.env.AMICA_DATA_HANDLER_STORAGE_DIR = storageDir;
    process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL = "http://localhost:3000";
    dataHelper = require("../src/features/externalAPI/dataHelper");
    dataHandler = require("../src/pages/api/dataHandler");
    apiHelper = require("../src/features/externalAPI/utils/apiHelper");
  });
  return { apiHelper, dataHelper, dataHandler };
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

  test("a successful save preserves an existing 0644 mode", () => {
    fs.chmodSync(configPath, 0o644);
    const { dataHandler } = loadModules();
    const res = postConfig(
      dataHandler,
      { key: "name", value: "Dei" },
      sha256(configPath),
    );
    expect(res.statusCode).toBe(200);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o644);
  });

  test("preserves an existing 0660 mode under a restrictive creation mask", () => {
    fs.chmodSync(configPath, 0o660);
    const { dataHandler } = loadModules();
    const originalUmask = process.umask(0o777);
    try {
      const res = postConfig(
        dataHandler,
        { key: "name", value: "Dei" },
        sha256(configPath),
      );
      expect(res.statusCode).toBe(200);
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o660);
    } finally {
      process.umask(originalUmask);
    }
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
    const originalRename = fs.renameSync.bind(fs);
    const renameSpy = jest.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === configPath) {
        throw new Error("simulated target rename failure");
      }
      return originalRename(from, to);
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

  test("fsyncs the temporary file before target rename and the directory after", () => {
    const { dataHandler } = loadModules();
    const events: string[] = [];
    const fdKinds = new Map<number, string>();
    const originalOpen = fs.openSync.bind(fs);
    const originalFsync = fs.fsyncSync.bind(fs);
    const originalFchmod = fs.fchmodSync.bind(fs);
    const originalRename = fs.renameSync.bind(fs);
    const originalClose = fs.closeSync.bind(fs);

    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      const fd = originalOpen(p, flags, mode);
      const name = String(p);
      fdKinds.set(fd, name === storageDir ? "directory" : name.includes(".bak.tmp-") ? "backup" : name.includes(".tmp-") ? "temporary" : "other");
      return fd;
    }) as any);
    jest.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      events.push(`fsync:${fdKinds.get(fd)}`);
      return originalFsync(fd);
    });
    jest.spyOn(fs, "fchmodSync").mockImplementation((fd, mode) => {
      events.push(`fchmod:${fdKinds.get(fd)}`);
      return originalFchmod(fd, mode);
    });
    jest.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === configPath) events.push("rename:target");
      return originalRename(from, to);
    });
    jest.spyOn(fs, "closeSync").mockImplementation((fd) => {
      if (fdKinds.get(fd) === "directory") events.push("close:directory");
      return originalClose(fd);
    });

    const res = postConfig(dataHandler, { key: "name", value: "Durable" }, sha256(configPath));
    expect(res.statusCode).toBe(200);
    expect(events).toEqual([
      "fchmod:temporary",
      "fsync:temporary",
      "fsync:backup",
      "rename:target",
      "fsync:directory",
      "close:directory",
    ]);
  });

  test("fchmod failure preserves original bytes and mode and removes temporary artifacts", () => {
    const { dataHandler } = loadModules();
    const originalBytes = fs.readFileSync(configPath);
    const originalMode = fs.statSync(configPath).mode & 0o777;
    const originalOpen = fs.openSync.bind(fs);
    let temporaryFd: number | null = null;

    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      const fd = originalOpen(p, flags, mode);
      if (String(p).includes("config.json.tmp-")) temporaryFd = fd;
      return fd;
    }) as any);
    jest.spyOn(fs, "fchmodSync").mockImplementation((fd) => {
      if (fd === temporaryFd) throw new Error("simulated temporary fchmod failure");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = postConfig(
      dataHandler,
      { key: "name", value: "Never authoritative" },
      sha256(configPath),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      code: "CONFIG_PERSISTENCE_FAILED",
      phase: "temporary-file-mode",
      targetReplaced: false,
    });
    expect(fs.readFileSync(configPath).equals(originalBytes)).toBe(true);
    expect(fs.statSync(configPath).mode & 0o777).toBe(originalMode);
    expect(fs.readdirSync(storageDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Never authoritative");
  });

  test("a non-ENOENT target stat failure is a hard pre-rename failure", () => {
    const { dataHandler } = loadModules();
    const originalBytes = fs.readFileSync(configPath);
    const revision = createHash("sha256").update(originalBytes).digest("hex");
    const originalStat = fs.statSync.bind(fs);
    jest.spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike, ...args: any[]) => {
      if (String(p) === configPath) {
        const error = new Error("simulated target stat I/O failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return (originalStat as any)(p, ...args);
    }) as any);

    const res = postConfig(
      dataHandler,
      { key: "name", value: "Never authoritative" },
      revision,
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      code: "CONFIG_PERSISTENCE_FAILED",
      phase: "target-stat",
      targetReplaced: false,
    });
    expect(fs.readFileSync(configPath).equals(originalBytes)).toBe(true);
  });

  test("ENOENT uses the configured default mode exactly", () => {
    const { apiHelper } = loadModules();
    const absentPath = path.join(storageDir, "new-config.json");
    const originalUmask = process.umask(0o777);
    try {
      apiHelper.writeFileAtomic(absentPath, { name: "New" }, { defaultMode: 0o640 });
      expect(fs.statSync(absentPath).mode & 0o777).toBe(0o640);
    } finally {
      process.umask(originalUmask);
    }
  });

  test("closes the directory handle after directory fsync failure", () => {
    const { dataHandler } = loadModules();
    let directoryFd: number | null = null;
    const originalOpen = fs.openSync.bind(fs);
    const originalFsync = fs.fsyncSync.bind(fs);
    const originalClose = fs.closeSync.bind(fs);
    const closeCalls: number[] = [];

    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      const fd = originalOpen(p, flags, mode);
      if (String(p) === storageDir) directoryFd = fd;
      return fd;
    }) as any);
    jest.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fd === directoryFd) throw new Error("simulated directory fsync failure");
      return originalFsync(fd);
    });
    jest.spyOn(fs, "closeSync").mockImplementation((fd) => {
      closeCalls.push(fd);
      return originalClose(fd);
    });

    const res = postConfig(dataHandler, { key: "name", value: "Maybe durable" }, sha256(configPath));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      code: "CONFIG_DURABILITY_UNCONFIRMED",
      phase: "directory-fsync",
      targetReplaced: true,
    });
    expect(directoryFd).not.toBeNull();
    expect(closeCalls).toContain(directoryFd!);
  });

  test("directory-open failure is a hard post-rename persistence error", () => {
    const { dataHandler } = loadModules();
    const originalOpen = fs.openSync.bind(fs);
    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      if (String(p) === storageDir) throw new Error("simulated directory open failure");
      return originalOpen(p, flags, mode);
    }) as any);

    const res = postConfig(dataHandler, { key: "name", value: "Maybe durable" }, sha256(configPath));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      code: "CONFIG_DURABILITY_UNCONFIRMED",
      phase: "directory-open",
      targetReplaced: true,
    });
  });

  test("directory-close failure is a hard persistence error", () => {
    const { dataHandler } = loadModules();
    let directoryFd: number | null = null;
    let failedOnce = false;
    const originalOpen = fs.openSync.bind(fs);
    const originalClose = fs.closeSync.bind(fs);
    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      const fd = originalOpen(p, flags, mode);
      if (String(p) === storageDir) directoryFd = fd;
      return fd;
    }) as any);
    jest.spyOn(fs, "closeSync").mockImplementation((fd) => {
      if (fd === directoryFd && !failedOnce) {
        failedOnce = true;
        throw new Error("simulated directory close failure");
      }
      return originalClose(fd);
    });

    const res = postConfig(dataHandler, { key: "name", value: "Maybe durable" }, sha256(configPath));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ phase: "directory-close", targetReplaced: true });
    expect(failedOnce).toBe(true);
  });

  test("validation failure performs no target rename or directory synchronization", () => {
    const { dataHandler } = loadModules();
    const renameSpy = jest.spyOn(fs, "renameSync");
    const openSpy = jest.spyOn(fs, "openSync");
    const fsyncSpy = jest.spyOn(fs, "fsyncSync");
    const before = sha256(configPath);
    const res = postConfig(dataHandler, { name: "not a mutation" }, before);
    expect(res.statusCode).toBe(400);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalledWith(storageDir, expect.anything());
    expect(fsyncSpy).not.toHaveBeenCalled();
    expect(sha256(configPath)).toBe(before);
  });

  test.each([
    "temporary creation",
    "temporary write",
    "temporary fsync",
    "temporary close",
    "backup handling",
  ])("a %s failure leaves the original target byte-identical", (failurePoint) => {
    const { dataHandler } = loadModules();
    const original = fs.readFileSync(configPath);
    const originalOpen = fs.openSync.bind(fs);
    const originalWrite = fs.writeSync.bind(fs);
    const originalFsync = fs.fsyncSync.bind(fs);
    const originalClose = fs.closeSync.bind(fs);
    let temporaryFd: number | null = null;
    let failedClose = false;

    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      if (failurePoint === "temporary creation" && String(p).includes("config.json.tmp-")) {
        throw new Error("simulated temporary creation failure");
      }
      const fd = originalOpen(p, flags, mode);
      if (String(p).includes("config.json.tmp-")) temporaryFd = fd;
      return fd;
    }) as any);
    jest.spyOn(fs, "writeSync").mockImplementation(((fd: number, ...args: any[]) => {
      if (failurePoint === "temporary write" && fd === temporaryFd) {
        throw new Error("simulated temporary write failure");
      }
      return (originalWrite as any)(fd, ...args);
    }) as any);
    jest.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (failurePoint === "temporary fsync" && fd === temporaryFd) {
        throw new Error("simulated temporary fsync failure");
      }
      return originalFsync(fd);
    });
    jest.spyOn(fs, "closeSync").mockImplementation((fd) => {
      if (failurePoint === "temporary close" && fd === temporaryFd && !failedClose) {
        failedClose = true;
        throw new Error("simulated temporary close failure");
      }
      return originalClose(fd);
    });
    if (failurePoint === "backup handling") {
      jest.spyOn(fs, "copyFileSync").mockImplementation(() => {
        throw new Error("simulated backup failure");
      });
    }

    const res = postConfig(dataHandler, { key: "name", value: "Never authoritative" }, sha256(configPath));
    expect(res.statusCode).toBe(500);
    expect(fs.readFileSync(configPath).equals(original)).toBe(true);
    expect(fs.readdirSync(storageDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("post-rename durability errors log no configuration secret", () => {
    const { dataHandler } = loadModules();
    const secret = "super-secret-config-value";
    let directoryFd: number | null = null;
    const originalOpen = fs.openSync.bind(fs);
    const originalFsync = fs.fsyncSync.bind(fs);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: any, mode?: any) => {
      const fd = originalOpen(p, flags, mode);
      if (String(p) === storageDir) directoryFd = fd;
      return fd;
    }) as any);
    jest.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fd === directoryFd) throw new Error("simulated directory fsync failure");
      return originalFsync(fd);
    });

    const res = postConfig(dataHandler, { key: "name", value: secret }, sha256(configPath));
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});
