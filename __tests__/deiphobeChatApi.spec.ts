import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "node:events";

const mockConfigValues: Record<string, string> = {
  deiphobe_repo_root: "/home/kyler/ClawDawg",
  deiphobe_command: "./ops/scripts/bus/deiphobe",
  deiphobe_timeout_seconds: "5",
  deiphobe_user_id: "uther-voice",
  deiphobe_session_id: "voice-avatar-test",
  deiphobe_namespace: "voice",
  deiphobe_private_mode: "true",
  deiphobe_private_memory_root: "/home/kyler/.clawdawg-private/deiphobe_memory",
};

const mockSpawn = jest.fn();
const mockHandleConfig = jest.fn().mockResolvedValue(undefined);

jest.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock("../src/features/externalAPI/externalAPI", () => ({
  handleConfig: (...args: unknown[]) => mockHandleConfig(...args),
}));

jest.mock("../src/utils/config", () => ({
  config: (key: string) => mockConfigValues[key] ?? "",
}));

function createMockChildProcess(stdout = "", stderr = "", code = 0) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  mockSpawn.mockReturnValue(child);

  process.nextTick(() => {
    child.emit("spawn");
    if (stdout) {
      child.stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", code);
  });

  return child;
}

function createResponse() {
  const response: Record<string, any> = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    writableEnded: false,
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = Array.isArray(value) ? value.join(",") : value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.writableEnded = true;
      return this;
    },
    write(payload: any) {
      this.body += String(payload);
      return true;
    },
    end(payload?: any) {
      if (payload !== undefined) {
        this.body += String(payload);
      }
      this.writableEnded = true;
      return this;
    },
    flushHeaders() {
      return undefined;
    },
  };

  return response;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockHandleConfig.mockClear();
});

function flushEvents() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("deiphobeChat handler", () => {
  test.each(["[", "(", "6M41", "6741", "62651+"])(
    "routes noisy Deiphobe Local input through the governed bus runtime: %s",
    async (text) => {
      createMockChildProcess("I didn't catch enough there.\n");
      const apiModule = await import("../src/pages/api/deiphobeChat");
      const req = { method: "POST", body: { text } } as any;
      const res = createResponse();

      await apiModule.default(req, res as any);
      await flushEvents();

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("I didn't catch enough there.\n");
      expect(res.body).not.toContain("refer to you as Uther");
      expect(mockSpawn).toHaveBeenCalledWith(
        "./ops/scripts/bus/deiphobe",
        ["chat", "--text", text],
        expect.objectContaining({
          cwd: "/home/kyler/ClawDawg",
          env: expect.objectContaining({
            DEIPHOBE_CHAT_USER_ID: "uther-voice",
            DEIPHOBE_CHAT_SESSION_ID: "voice-avatar-test",
            DEIPHOBE_CHAT_NAMESPACE: "voice",
            DEIPHOBE_PRIVATE_MODE: "1",
            DEIPHOBE_PRIVATE_MEMORY_ROOT: "/home/kyler/.clawdawg-private/deiphobe_memory",
          }),
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    },
  );

  test.each([
    ["[neutral] [", "["],
    ["[neutral] (", "("],
    ["[neutral] 6M41", "6M41"],
    ["[neutral] 6741", "6741"],
    ["[neutral] 62651+", "62651+"],
  ])("strips Amica expression tags before spawning governed runtime: %s", async (text, expectedText) => {
    createMockChildProcess("I didn't catch enough there.\n");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("I didn't catch enough there.\n");
    expect(mockSpawn).toHaveBeenCalledWith(
      "./ops/scripts/bus/deiphobe",
      ["chat", "--text", expectedText],
      expect.any(Object),
    );
  });

  test("returns Deiphobe self-identity from the governed bus runtime", async () => {
    createMockChildProcess("Deiphobe. That's me.\n");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text: "What's your name?" } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("Deiphobe. That's me.\n");
    expect(res.body).not.toContain("call me Uther");
  });
});
