/**
 * Microphone capture session behavior: structural failure classification,
 * click-time capability evaluation, retryability, device fallback, duplicate
 * prevention, permission-timeout handling, and guaranteed track cleanup.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  MicrophoneCapture,
  MICROPHONE_GUIDANCE,
  buildMicrophoneFailure,
  classifyMicrophoneFailure,
  probeMicrophoneEnvironment,
  type MicrophoneEnvironment,
  type VadFactory,
} from "../src/features/microphone/microphoneCapture";

function makeError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

const SECURE_ENV: MicrophoneEnvironment = {
  origin: "https://amica.home",
  secureContext: true,
  apiAvailable: true,
  permission: "granted",
  policyAllowed: true,
};

function makeTrack() {
  return { stop: jest.fn(), readyState: "live" as string };
}

function makeStream(trackCount = 1) {
  const tracks = Array.from({ length: trackCount }, makeTrack);
  return {
    getTracks: () => tracks,
    tracks,
  } as any;
}

function makeVad() {
  return {
    start: jest.fn<() => void | Promise<void>>(),
    pause: jest.fn<() => void>(),
    destroy: jest.fn<() => void>(),
  };
}

function installMediaDevices(getUserMedia: any) {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
}

function removeMediaDevices() {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
}

const BASE_OPTS = { workletURL: "/w.js", modelURL: "/m.onnx" };

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("classification", () => {
  test("insecure context wins over the raw exception", () => {
    const env = { ...SECURE_ENV, secureContext: false, apiAvailable: false };
    expect(classifyMicrophoneFailure(makeError("TypeError"), env)).toBe(
      "insecure_context",
    );
    expect(classifyMicrophoneFailure(null, env)).toBe("insecure_context");
  });

  test("missing mediaDevices classifies as api_unavailable", () => {
    const env = { ...SECURE_ENV, apiAvailable: false };
    expect(classifyMicrophoneFailure(null, env)).toBe("api_unavailable");
    expect(classifyMicrophoneFailure(makeError("TypeError"), env)).toBe(
      "api_unavailable",
    );
  });

  test("browser exceptions map to distinct structural classes", () => {
    expect(classifyMicrophoneFailure(makeError("NotAllowedError"), SECURE_ENV)).toBe("permission_denied");
    expect(classifyMicrophoneFailure(makeError("NotFoundError"), SECURE_ENV)).toBe("no_input_device");
    expect(classifyMicrophoneFailure(makeError("NotReadableError"), SECURE_ENV)).toBe("device_busy_or_unreadable");
    expect(classifyMicrophoneFailure(makeError("OverconstrainedError"), SECURE_ENV)).toBe("constraints_unsatisfied");
    expect(classifyMicrophoneFailure(makeError("SecurityError"), SECURE_ENV)).toBe("policy_blocked");
    expect(classifyMicrophoneFailure(makeError("AbortError"), SECURE_ENV)).toBe("capture_aborted");
    expect(classifyMicrophoneFailure(makeError("InvalidStateError"), SECURE_ENV)).toBe("capture_aborted");
    expect(classifyMicrophoneFailure(makeError("NotSupportedError"), SECURE_ENV)).toBe("recording_unsupported");
    expect(classifyMicrophoneFailure(makeError("SomethingElse"), SECURE_ENV)).toBe("unknown_capture_failure");
  });

  test("NotAllowedError with a disallowing permissions policy is policy_blocked", () => {
    const env = { ...SECURE_ENV, policyAllowed: false };
    expect(classifyMicrophoneFailure(makeError("NotAllowedError"), env)).toBe(
      "policy_blocked",
    );
  });

  test("every failure class carries actionable guidance", () => {
    for (const [clazz, guidance] of Object.entries(MICROPHONE_GUIDANCE)) {
      expect(guidance.length).toBeGreaterThan(20);
      const failure = buildMicrophoneFailure(null, {
        ...SECURE_ENV,
        secureContext: clazz === "insecure_context" ? false : true,
        apiAvailable: clazz === "insecure_context" ? false : true,
      });
      expect(failure.guidance.length).toBeGreaterThan(20);
    }
  });
});

describe("environment probe", () => {
  test("insecure context is reported with the real origin", async () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    removeMediaDevices();
    const env = await probeMicrophoneEnvironment();
    expect(env.secureContext).toBe(false);
    expect(env.apiAvailable).toBe(false);
    expect(env.origin).toBe(window.location.origin);
  });
});

describe("capture sessions", () => {
  test("insecure context fails cleanly with the secure-origin message and stays retryable", async () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    removeMediaDevices();
    const capture = new MicrophoneCapture(jest.fn() as unknown as VadFactory);
    const failure = await capture.start(BASE_OPTS);
    expect(failure?.failureClass).toBe("insecure_context");
    expect(failure?.guidance).toContain("HTTPS");
    expect(capture.isActive).toBe(false);
    // A later attempt is evaluated freshly, not poisoned by the first.
    const second = await capture.start(BASE_OPTS);
    expect(second?.failureClass).toBe("insecure_context");
  });

  test("permission denial is retryable and succeeds after the grant", async () => {
    const stream = makeStream();
    const getUserMedia = jest
      .fn<() => Promise<any>>()
      .mockRejectedValueOnce(makeError("NotAllowedError"))
      .mockResolvedValueOnce(stream);
    installMediaDevices(getUserMedia);
    const vad = makeVad();
    const capture = new MicrophoneCapture(async () => vad);

    const first = await capture.start(BASE_OPTS);
    expect(first?.failureClass).toBe("permission_denied");
    expect(first?.guidance).toContain("site settings");
    expect(capture.isActive).toBe(false);

    const second = await capture.start(BASE_OPTS);
    expect(second).toBeNull();
    expect(capture.isActive).toBe(true);
    expect(vad.start).toHaveBeenCalledTimes(1);
    capture.stop();
  });

  test("a stale preferred device falls back to the system default", async () => {
    const stream = makeStream();
    const getUserMedia = jest
      .fn<(c: any) => Promise<any>>()
      .mockImplementation(async (constraints: any) => {
        if (constraints?.audio?.deviceId) {
          throw makeError("OverconstrainedError");
        }
        return stream;
      });
    installMediaDevices(getUserMedia);
    const capture = new MicrophoneCapture(async () => makeVad());

    const failure = await capture.start({
      ...BASE_OPTS,
      preferredDeviceId: "stale-device-id",
    });
    expect(failure).toBeNull();
    expect(capture.isActive).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: true });
    capture.stop();
  });

  test("a failed general request is terminal, not endlessly retried", async () => {
    const getUserMedia = jest
      .fn<() => Promise<any>>()
      .mockRejectedValue(makeError("NotFoundError"));
    installMediaDevices(getUserMedia);
    const capture = new MicrophoneCapture(async () => makeVad());
    const failure = await capture.start(BASE_OPTS);
    expect(failure?.failureClass).toBe("no_input_device");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test("duplicate clicks never create parallel recorders", async () => {
    const stream = makeStream();
    let releaseStream!: (v: any) => void;
    const getUserMedia = jest.fn(
      () => new Promise((resolve) => { releaseStream = resolve; }),
    );
    installMediaDevices(getUserMedia);
    const vad = makeVad();
    const capture = new MicrophoneCapture(async () => vad);

    const first = capture.start(BASE_OPTS);
    const second = capture.start(BASE_OPTS);
    await flushMicrotasks();
    releaseStream(stream);
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(vad.start).toHaveBeenCalledTimes(1);

    // Starting again while active is also a no-op.
    await capture.start(BASE_OPTS);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    capture.stop();
  });

  test("every track is stopped after success and stop()", async () => {
    const stream = makeStream(2);
    installMediaDevices(jest.fn<() => Promise<any>>().mockResolvedValue(stream));
    const vad = makeVad();
    const capture = new MicrophoneCapture(async () => vad);

    await capture.start(BASE_OPTS);
    capture.stop();
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(vad.destroy).toHaveBeenCalled();
    expect(capture.isActive).toBe(false);
  });

  test("every track is stopped when the VAD engine fails after acquisition", async () => {
    const stream = makeStream(2);
    installMediaDevices(jest.fn<() => Promise<any>>().mockResolvedValue(stream));
    const capture = new MicrophoneCapture(async () => {
      throw makeError("NotSupportedError");
    });

    const failure = await capture.start(BASE_OPTS);
    expect(failure?.failureClass).toBe("recording_unsupported");
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(capture.isActive).toBe(false);
  });

  test("a synchronous VAD start failure is classified and cleans the entire startup transaction", async () => {
    const stream = makeStream(2);
    installMediaDevices(jest.fn<() => Promise<any>>().mockResolvedValue(stream));
    const vad = makeVad();
    vad.start.mockImplementation(() => {
      throw makeError("NotSupportedError");
    });
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    const capture = new MicrophoneCapture(async () => vad);

    const failure = await capture.start(BASE_OPTS);

    expect(failure).toMatchObject({
      failureClass: "recording_unsupported",
      errorName: "NotSupportedError",
    });
    expect(vad.pause).toHaveBeenCalledTimes(1);
    expect(vad.destroy).toHaveBeenCalledTimes(1);
    stream.tracks.forEach((track: any) => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(capture.isActive).toBe(false);
    expect(capture.isStarting).toBe(false);
    expect(navigator.mediaDevices.addEventListener).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.removeEventListener).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls.filter((call) =>
      call[0] === "[mic-diagnostic]" && (call[1] as any)?.event === "capture_failed"
    )).toHaveLength(1);
  });

  test("an asynchronous VAD start rejection cleans every track and a later click can succeed", async () => {
    const failedStream = makeStream(2);
    const successfulStream = makeStream();
    installMediaDevices(
      jest.fn<() => Promise<any>>()
        .mockResolvedValueOnce(failedStream)
        .mockResolvedValueOnce(successfulStream),
    );
    const failedVad = makeVad();
    failedVad.start.mockImplementation(() =>
      Promise.reject(makeError("AbortError"))
    );
    const successfulVad = makeVad();
    let factoryCalls = 0;
    const capture = new MicrophoneCapture(async () =>
      factoryCalls++ === 0 ? failedVad : successfulVad
    );

    const failure = await capture.start(BASE_OPTS);

    expect(failure).toMatchObject({
      failureClass: "capture_aborted",
      errorName: "AbortError",
    });
    expect(failedVad.pause).toHaveBeenCalledTimes(1);
    expect(failedVad.destroy).toHaveBeenCalledTimes(1);
    failedStream.tracks.forEach((track: any) => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(capture.isActive).toBe(false);
    expect(capture.isStarting).toBe(false);
    expect(navigator.mediaDevices.addEventListener).not.toHaveBeenCalled();

    const retry = await capture.start(BASE_OPTS);
    expect(retry).toBeNull();
    expect(capture.isActive).toBe(true);
    expect(successfulVad.start).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.addEventListener).toHaveBeenCalledTimes(1);
    capture.stop();
  });

  test("a stream resolved after stop() during startup is released, not leaked", async () => {
    const stream = makeStream();
    let releaseStream!: (v: any) => void;
    installMediaDevices(
      jest.fn(() => new Promise((resolve) => { releaseStream = resolve; })),
    );
    const vad = makeVad();
    const capture = new MicrophoneCapture(async () => vad);

    const pending = capture.start(BASE_OPTS);
    await flushMicrotasks();
    capture.stop(); // user cancels while the permission prompt is open
    releaseStream(stream);
    expect(await pending).toBeNull();
    expect(capture.isActive).toBe(false);
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(vad.start).not.toHaveBeenCalled();
  });

  test("a hanging permission prompt times out as capture_aborted and stays retryable", async () => {
    const neverResolves = new Promise(() => {});
    installMediaDevices(jest.fn(() => neverResolves));
    const capture = new MicrophoneCapture(async () => makeVad());

    const failure = await capture.start({ ...BASE_OPTS, permissionTimeoutMs: 30 });
    expect(failure?.failureClass).toBe("capture_aborted");
    expect(capture.isActive).toBe(false);
    expect(capture.isStarting).toBe(false);
  });

  test("microphone activity performs no configuration fetches", async () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const stream = makeStream();
    installMediaDevices(jest.fn<() => Promise<any>>().mockResolvedValue(stream));
    const capture = new MicrophoneCapture(async () => makeVad());

    await capture.start(BASE_OPTS);
    capture.stop();
    const denied = new MicrophoneCapture(async () => makeVad());
    installMediaDevices(
      jest.fn<() => Promise<any>>().mockRejectedValue(makeError("NotAllowedError")),
    );
    await denied.start(BASE_OPTS);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("diagnostics record structure without audio or device labels", async () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    installMediaDevices(
      jest.fn<() => Promise<any>>().mockRejectedValue(makeError("NotAllowedError")),
    );
    const capture = new MicrophoneCapture(async () => makeVad());
    await capture.start(BASE_OPTS);

    const diagnostic = infoSpy.mock.calls.find(
      (call) => call[0] === "[mic-diagnostic]",
    );
    expect(diagnostic).toBeTruthy();
    const payload = diagnostic![1] as Record<string, unknown>;
    expect(payload.event).toBe("capture_failed");
    expect(payload.failureClass).toBe("permission_denied");
    expect(payload).toHaveProperty("secureContext");
    expect(payload).toHaveProperty("origin");
    expect(JSON.stringify(payload)).not.toMatch(/label|audioData|samples/);
  });
});
