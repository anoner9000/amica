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
let postResponder: (body: Record<string, string>) => Promise<any>;
let revisionCounter: number;
let inFlightPosts: number;
let maxInFlightPosts: number;
let serverValues: Record<string, string>;

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
    json: async () => ({ ...serverValues }),
  };
}

function makePostResponse(body: Record<string, string>) {
  if (postStatus === 200) {
    revisionCounter += 1;
    serverRevision = `rev-${revisionCounter}`;
    serverValues[body.key] = body.value;
  }
  return {
    ok: postStatus === 200,
    status: postStatus,
    headers: { get: (h: string) => (h === "x-config-revision" ? serverRevision : null) },
    json: async () => postStatus === 200 ? { revision: serverRevision } : { error: "save rejected" },
  };
}

function installFetchMock() {
  fetchCalls = [];
  serverRevision = "rev-initial";
  revisionCounter = 0;
  postStatus = 200;
  inFlightPosts = 0;
  maxInFlightPosts = 0;
  serverValues = { name: "Deiphobe", tts_backend: "piper" };
  getResponder = async () => makeGetResponse();
  postResponder = async (body) => makePostResponse(body);
  (global as any).fetch = jest.fn(async (url: any, init?: any) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fetchCalls.push({
      method,
      url: String(url),
      revision: init?.headers?.["x-config-revision"],
      body,
    });
    if (method === "GET") {
      return getResponder();
    }
    inFlightPosts += 1;
    maxInFlightPosts = Math.max(maxInFlightPosts, inFlightPosts);
    try {
      return await postResponder(body);
    } finally {
      inFlightPosts -= 1;
    }
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

  test("a save waits for an in-flight hydration read before taking its revision", async () => {
    let releaseGet!: (response: any) => void;
    getResponder = () => new Promise((resolve) => { releaseGet = resolve; });
    const mod = hydrateFreshClient();
    await flush();
    const save = mod.updateConfig("name", "After hydration");
    await flush();
    expect(posts()).toHaveLength(0);
    releaseGet(makeGetResponse());
    await save;
    expect(posts()).toHaveLength(1);
    expect(posts()[0].revision).toBe("rev-initial");
  });

  test("a stale tab's save is rejected by revision conflict and never retried with client data", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 409;
    serverRevision = "rev-someone-else";
    await expect(mod.updateConfig("name", "StaleValue")).rejects.toMatchObject({
      name: "ConfigConflictError",
      status: 409,
    });
    expect(posts()).toHaveLength(1);
  });

  test("two simultaneous saves produce sequential requests with one in flight", async () => {
    const mod = hydrateFreshClient();
    await flush();
    await Promise.all([
      mod.updateConfig("name", "First"),
      mod.updateConfig("tts_backend", "second"),
    ]);
    expect(posts().map((call) => call.body)).toEqual([
      { key: "name", value: "First" },
      { key: "tts_backend", value: "second" },
    ]);
    expect(maxInFlightPosts).toBe(1);
  });

  test("three simultaneous saves carry three successive revisions in FIFO order", async () => {
    const mod = hydrateFreshClient();
    await flush();
    await Promise.all([
      mod.updateConfig("first", "1"),
      mod.updateConfig("second", "2"),
      mod.updateConfig("third", "3"),
    ]);
    expect(posts().map((call) => call.body.key)).toEqual(["first", "second", "third"]);
    expect(posts().map((call) => call.revision)).toEqual([
      "rev-initial",
      "rev-1",
      "rev-2",
    ]);
  });

  test("each caller promise resolves only after its own request completes", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const releases: Array<() => void> = [];
    postResponder = (body) => new Promise((resolve) => {
      releases.push(() => resolve(makePostResponse(body)));
    });
    const completed: string[] = [];
    const first = mod.updateConfig("first", "1").then(() => completed.push("first"));
    const second = mod.updateConfig("second", "2").then(() => completed.push("second"));
    await flush();
    expect(posts()).toHaveLength(1);
    expect(completed).toEqual([]);
    releases[0]();
    await flush();
    expect(completed).toEqual(["first"]);
    expect(posts()).toHaveLength(2);
    releases[1]();
    await Promise.all([first, second]);
    expect(completed).toEqual(["first", "second"]);
  });

  test("share import persists every intended key", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const mutations = Array.from({ length: 13 }, (_, index) => ({
      key: `share_import_${index}`,
      value: `value-${index}`,
    }));
    await mod.updateConfigs(mutations);
    expect(posts().map((call) => call.body)).toEqual(mutations);
    expect(mutations.every(({ key, value }) => serverValues[key] === value)).toBe(true);
  });

  test("VRM save persists all three intended keys", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const mutations = [
      { key: "vrm_url", value: "blob:vrm" },
      { key: "vrm_hash", value: "hash" },
      { key: "vrm_save_type", value: "local" },
    ];
    await mod.updateConfigs(mutations);
    expect(posts().map((call) => call.body)).toEqual(mutations);
  });

  test("share page save persists both intended keys", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const mutations = [
      { key: "vrm_url", value: "https://example.test/avatar.vrm" },
      { key: "vrm_save_type", value: "web" },
    ];
    await mod.updateConfigs(mutations);
    expect(posts().map((call) => call.body)).toEqual(mutations);
  });

  test("rapid volume changes preserve the final deliberate value", async () => {
    const mod = hydrateFreshClient();
    await flush();
    await Promise.all(["0.1", "0.4", "0.8", "1"].map((value) =>
      mod.updateConfig("tts_volume", value)));
    expect(posts().map((call) => call.body.value)).toEqual(["0.1", "0.4", "0.8", "1"]);
    expect(serverValues.tts_volume).toBe("1");
    expect(localStorage.getItem("chatvrm_tts_volume")).toBe("1");
  });

  test("a failed mutation rejects and is not reported as success", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 500;
    let succeeded = false;
    await expect(mod.updateConfig("name", "failed").then(() => {
      succeeded = true;
    })).rejects.toMatchObject({ status: 500 });
    expect(succeeded).toBe(false);
    expect(localStorage.getItem("chatvrm_name")).toBeNull();
  });

  test("external conflict rejects later queued writes without retrying or dropping them", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 409;
    serverRevision = "external-revision";
    const first = mod.updateConfig("first", "1");
    const second = mod.updateConfig("second", "2");
    const third = mod.updateConfig("third", "3");
    await expect(first).rejects.toMatchObject({ name: "ConfigConflictError" });
    await expect(second).rejects.toMatchObject({
      name: "ConfigQueueInvalidatedError",
      conflict: true,
    });
    await expect(third).rejects.toMatchObject({
      name: "ConfigQueueInvalidatedError",
      conflict: true,
    });
    expect(posts()).toHaveLength(1);
    expect(serverValues.first).toBeUndefined();
    expect(serverValues.second).toBeUndefined();
    expect(serverValues.third).toBeUndefined();
  });

  test("network failure does not advance the revision", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postResponder = async () => { throw new TypeError("network down"); };
    await expect(mod.updateConfig("name", "offline")).rejects.toMatchObject({ status: null });
    expect(mod.authoritativeConfigRevision()).toBe("rev-initial");
  });

  test("server persistence failure does not advance the revision", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 500;
    await expect(mod.updateConfig("name", "not-persisted")).rejects.toMatchObject({ status: 500 });
    expect(mod.authoritativeConfigRevision()).toBe("rev-initial");
    expect(serverValues.name).toBe("Deiphobe");
  });

  test("known fire-and-forget callers attach a rejection observer", async () => {
    const mod = hydrateFreshClient();
    await flush();
    postStatus = 500;
    const unhandled: unknown[] = [];
    const listener = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
    window.addEventListener("unhandledrejection", listener);
    mod.updateConfig("name", "fire-and-forget");
    await flush();
    window.removeEventListener("unhandledrejection", listener);
    expect(unhandled).toEqual([]);
  });

  test("client cache, local state, and server fixture agree after a multi-key burst", async () => {
    const mod = hydrateFreshClient();
    await flush();
    const mutations = [
      { key: "name", value: "Dei" },
      { key: "vrm_url", value: "https://example.test/dei.vrm" },
      { key: "vrm_save_type", value: "web" },
      { key: "tts_volume", value: "0.9" },
    ];
    await mod.updateConfigs(mutations);
    const clientValues = mod.authoritativeConfigSnapshot();
    for (const { key, value } of mutations) {
      expect(serverValues[key]).toBe(value);
      expect(clientValues[key]).toBe(value);
      expect(localStorage.getItem(`chatvrm_${key}`)).toBe(value);
    }
    expect(maxInFlightPosts).toBe(1);
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
