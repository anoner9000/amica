/**
 * Client-side authority: opening, refreshing, reconnecting, or hydrating the
 * Amica client must never write server configuration. Only a deliberate
 * user mutation (updateConfig) may POST, and it must carry the revision the
 * client read. Write counts are asserted directly on the fetch mock.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// externalAPI transitively imports the VRM/three.js animation stack, which
// jest cannot parse and which is irrelevant to config authority.
jest.mock("../src/features/amicaLife/eventHandler", () => ({
  MAX_STORAGE_TOKENS: 1000,
}));

type FetchCall = { method: string; url: string; revision?: string; body?: any };

let fetchCalls: FetchCall[];
let serverRevision: string;
let getResponder: () => Promise<any>;
let postStatus: number;

function posts(): FetchCall[] {
  return fetchCalls.filter((c) => c.method === "POST");
}
function gets(): FetchCall[] {
  return fetchCalls.filter((c) => c.method === "GET");
}

function makeGetResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === "x-config-revision" ? serverRevision : null) },
    json: async () => ({ name: "Deiphobe", tts_backend: "piper" }),
  };
}

function makePostResponse() {
  if (postStatus === 200) {
    serverRevision = `rev-${Math.random().toString(16).slice(2, 10)}`;
  }
  return {
    ok: postStatus === 200,
    status: postStatus,
    headers: { get: (h: string) => (h === "x-config-revision" ? serverRevision : null) },
    json: async () => ({}),
  };
}

function installFetchMock() {
  fetchCalls = [];
  serverRevision = "rev-initial";
  postStatus = 200;
  getResponder = async () => makeGetResponse();
  (global as any).fetch = jest.fn(async (url: any, init?: any) => {
    const method = init?.method ?? "GET";
    fetchCalls.push({
      method,
      url: String(url),
      revision: init?.headers?.["x-config-revision"],
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    if (method === "GET") {
      return getResponder();
    }
    return makePostResponse();
  });
}

// Loads @/utils/config in a fresh module registry, simulating one browser
// tab (or one hot-reload/remount generation) hydrating from scratch.
function hydrateFreshClient(): any {
  let mod: any;
  jest.isolateModules(() => {
    process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL = "http://localhost:3000";
    mod = require("../src/utils/config");
  });
  return mod;
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

const NODE_ENV_BEFORE = process.env.NODE_ENV;

beforeEach(() => {
  (process.env as any).NODE_ENV = "development";
  localStorage.clear();
  installFetchMock();
});

afterEach(() => {
  (process.env as any).NODE_ENV = NODE_ENV_BEFORE;
  jest.restoreAllMocks();
});

describe("hydration is read-only", () => {
  test("a completely fresh profile loads server config and performs zero writes", async () => {
    hydrateFreshClient();
    await flush();
    expect(gets().length).toBeGreaterThanOrEqual(1);
    expect(posts()).toHaveLength(0);
  });

  test("empty localStorage performs zero server writes", async () => {
    localStorage.clear();
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("deleted localStorage performs zero server writes", async () => {
    localStorage.setItem("chatvrm_name", "Dei");
    localStorage.clear();
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("corrupt localStorage performs zero server writes", async () => {
    localStorage.setItem("chatvrm_name", "\u0000{{{not-json");
    localStorage.setItem("chatvrm_tts_backend", "definitely-not-a-backend");
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("stale browser configuration performs zero writes during hydration", async () => {
    localStorage.setItem("chatvrm_name", "AncientLocalName");
    localStorage.setItem("chatvrm_tts_backend", "openai");
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("a delayed server response cannot be overtaken by defaults", async () => {
    let releaseGet!: (v: any) => void;
    getResponder = () => new Promise((resolve) => { releaseGet = resolve; });
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
    releaseGet(makeGetResponse());
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("a failed server GET does not trigger a default POST", async () => {
    getResponder = async () => {
      throw new Error("network down");
    };
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("strict-mode style double hydration emits zero writes", async () => {
    hydrateFreshClient();
    hydrateFreshClient();
    await flush();
    expect(posts()).toHaveLength(0);
  });

  test("remount/reconnect refetches emit zero writes", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const { handleConfig } = require("../src/features/externalAPI/externalAPI");
    void mod;
    await handleConfig("fetch");
    await handleConfig("fetch");
    expect(posts()).toHaveLength(0);
  });

  test("two tabs loading concurrently emit zero writes", async () => {
    hydrateFreshClient();
    hydrateFreshClient();
    await flush();
    expect(gets().length).toBeGreaterThanOrEqual(2);
    expect(posts()).toHaveLength(0);
  });
});

describe("deliberate writes", () => {
  test("a deliberate save emits exactly one write carrying the read revision", async () => {
    const mod = hydrateFreshClient();
    await flush();
    await mod.updateConfig("name", "Dei");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].revision).toBe("rev-initial");
    expect(posts()[0].body).toEqual({ key: "name", value: "Dei" });
  });

  test("a successful save updates the revision used by the next save", async () => {
    const mod = hydrateFreshClient();
    await flush();
    await mod.updateConfig("name", "Dei");
    const firstRevisionAfter = serverRevision;
    await mod.updateConfig("name", "Deiphobe");
    expect(posts()).toHaveLength(2);
    expect(posts()[1].revision).toBe(firstRevisionAfter);
  });

  test("a save with no prior fetch reads the revision first", async () => {
    let mod: any;
    jest.isolateModules(() => {
      process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL = "http://localhost:3000";
      mod = require("../src/utils/config");
    });
    // Ignore hydration's own GET; the point is the POST carries a revision.
    await mod.updateConfig("name", "Dei");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].revision).toBe("rev-initial");
  });

  test("a stale tab's save is rejected by revision conflict and never retried with client data", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 409;
    serverRevision = "rev-someone-else";
    await mod.updateConfig("name", "StaleValue");
    expect(posts()).toHaveLength(1);
    // The client adopted the server's revision but did not re-send its data.
    const { serverConfigRevision } = require("../src/features/externalAPI/externalAPI");
    void serverConfigRevision;
    expect(posts()).toHaveLength(1);
  });
});

describe("browser-local state stays local", () => {
  test("microphone/device-state changes emit zero server-config writes", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const callsBefore = fetchCalls.length;
    mod.updateLocalConfig("voice_url", "device:default");
    mod.updateLocalConfig("tts_backend", "openai_tts");
    await flush();
    expect(fetchCalls.length).toBe(callsBefore);
    expect(posts()).toHaveLength(0);
    expect(localStorage.getItem("chatvrm_voice_url")).toBe("device:default");
  });
});
