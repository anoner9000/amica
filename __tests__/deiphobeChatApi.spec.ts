import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "node:events";

const mockConfigValues: Record<string, string> = {
  deiphobe_repo_root: "/opt/clawdawg",
  deiphobe_command: "./ops/scripts/bus/deiphobe",
  deiphobe_timeout_seconds: "5",
  deiphobe_user_id: "test-voice",
  deiphobe_session_id: "test-conversation",
  deiphobe_namespace: "voice",
  deiphobe_private_mode: "true",
  deiphobe_private_memory_root: "/tmp/clawdawg-private/deiphobe_memory",
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
      child.stdout.emit("data", Buffer.from(JSON.stringify({ text: stdout })));
    }
    if (stderr) {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", code);
  });

  return child;
}

function createMockChildProcessRaw(stdout = "", stderr = "", code = 0) {
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
      expect(res.body).toEqual({ text: "I didn't catch enough there.\n" });
      expect(mockSpawn).toHaveBeenCalledWith(
        "./ops/scripts/bus/deiphobe",
        ["chat", "--text", text, "--json"],
        expect.objectContaining({
          cwd: "/opt/clawdawg",
          env: expect.objectContaining({
            DEIPHOBE_CHAT_USER_ID: "test-voice",
            DEIPHOBE_CHAT_SESSION_ID: "test-conversation",
            DEIPHOBE_CHAT_NAMESPACE: "voice",
            DEIPHOBE_PRIVATE_MODE: "1",
            DEIPHOBE_PRIVATE_MEMORY_ROOT: "/tmp/clawdawg-private/deiphobe_memory",
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
    expect(res.body).toEqual({ text: "I didn't catch enough there.\n" });
    expect(mockSpawn).toHaveBeenCalledWith(
      "./ops/scripts/bus/deiphobe",
      ["chat", "--text", expectedText, "--json"],
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
    expect(res.body).toEqual({ text: "Deiphobe. That's me.\n" });
  });

  test("routes new-segment control through typed flags without ordinary text", async () => {
    createMockChildProcessRaw("I started a fresh conversation.\n");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = {
      method: "POST",
      body: {
        text: null,
        new_segment: true,
        continue_previous_segment: false,
      },
    } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ text: "I started a fresh conversation." });
    expect(mockSpawn).toHaveBeenCalledWith(
      "./ops/scripts/bus/deiphobe",
      ["chat", "--new-segment"],
      expect.objectContaining({
        cwd: "/opt/clawdawg",
        env: expect.objectContaining({
          DEIPHOBE_CHAT_USER_ID: "test-voice",
          DEIPHOBE_CHAT_SESSION_ID: "test-conversation",
          DEIPHOBE_CHAT_NAMESPACE: "voice",
          DEIPHOBE_PRIVATE_MODE: "1",
        }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  test("routes continue-previous control through typed flags without ordinary text", async () => {
    createMockChildProcessRaw("I continued the previous conversation.\n");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = {
      method: "POST",
      body: {
        text: null,
        new_segment: false,
        continue_previous_segment: true,
      },
    } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ text: "I continued the previous conversation." });
    expect(mockSpawn).toHaveBeenCalledWith(
      "./ops/scripts/bus/deiphobe",
      ["chat", "--continue-previous-segment"],
      expect.any(Object),
    );
  });

  test("returns non-2xx when the new-segment control child exits nonzero", async () => {
    createMockChildProcessRaw(
      "I started a fresh conversation.\n",
      "FAIL: could not start a fresh conversation segment (write_failed)\n",
      3,
    );
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = {
      method: "POST",
      body: {
        text: null,
        new_segment: true,
        continue_previous_segment: false,
      },
    } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(String(res.body))).toEqual({ error: "Deiphobe execution failed" });
  });

  test.each([
    [{ new_segment: true, continue_previous_segment: true }, "Conversation segment controls conflict"],
    [{ new_segment: false, continue_previous_segment: false }, "Conversation segment control is missing"],
    [{ new_segment: "true", continue_previous_segment: false }, "Invalid conversation segment control"],
    [{ new_segment: true, continue_previous_segment: false, text: "hello" }, "Conversation segment controls must not include ordinary text"],
  ])("rejects malformed conversation control requests", async (body, expectedError) => {
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: expectedError });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test.each(["", "   ", "[neutral]   "])("rejects blank text without spawning Deiphobe: %j", async (text) => {
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = {
      method: "POST",
      body: {
        text,
        messages: [{ role: "user", content: "stale nonblank user message" }],
      },
    } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing text" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe("deiphobe_chat_num_predict token budget", () => {
  beforeEach(() => {
    delete process.env.LLM_NUM_PREDICT;
    mockConfigValues.deiphobe_chat_num_predict = "";
  });

  afterEach(() => {
    delete process.env.LLM_NUM_PREDICT;
    delete mockConfigValues.deiphobe_chat_num_predict;
  });

  test("unset config leaves subprocess env without LLM_NUM_PREDICT", async () => {
    createMockChildProcess("ok");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text: "hello" } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    const spawnEnv = mockSpawn.mock.calls[0][2].env;
    expect(spawnEnv).not.toHaveProperty("LLM_NUM_PREDICT");
  });

  test("valid config value passes LLM_NUM_PREDICT to subprocess", async () => {
    mockConfigValues.deiphobe_chat_num_predict = "160";
    createMockChildProcess("ok");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text: "hello" } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    const spawnEnv = mockSpawn.mock.calls[0][2].env;
    expect(spawnEnv.LLM_NUM_PREDICT).toBe("160");
    expect(res.statusCode).toBe(200);
  });

  test("explicit process.env.LLM_NUM_PREDICT takes priority over config value", async () => {
    process.env.LLM_NUM_PREDICT = "50";
    mockConfigValues.deiphobe_chat_num_predict = "160";
    createMockChildProcess("ok");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text: "hello" } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    const spawnEnv = mockSpawn.mock.calls[0][2].env;
    expect(spawnEnv.LLM_NUM_PREDICT).toBe("50");
  });

  test.each(["0", "-1", "abc", "1.5", "160abc"])(
    "invalid config value %j is ignored and leaves subprocess env without LLM_NUM_PREDICT",
    async (badValue) => {
      mockConfigValues.deiphobe_chat_num_predict = badValue;
      createMockChildProcess("ok");
      const apiModule = await import("../src/pages/api/deiphobeChat");
      const req = { method: "POST", body: { text: "hello" } } as any;
      const res = createResponse();

      await apiModule.default(req, res as any);
      await flushEvents();

      const spawnEnv = mockSpawn.mock.calls[0][2].env;
      expect(spawnEnv).not.toHaveProperty("LLM_NUM_PREDICT");
      expect(res.statusCode).toBe(200);
    },
  );

  test("whitespace-only config is treated as unset", async () => {
    mockConfigValues.deiphobe_chat_num_predict = "   ";
    createMockChildProcess("ok");
    const apiModule = await import("../src/pages/api/deiphobeChat");
    const req = { method: "POST", body: { text: "hello" } } as any;
    const res = createResponse();

    await apiModule.default(req, res as any);
    await flushEvents();

    const spawnEnv = mockSpawn.mock.calls[0][2].env;
    expect(spawnEnv).not.toHaveProperty("LLM_NUM_PREDICT");
  });
});
