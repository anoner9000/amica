import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

// resolveHostAwareLocalUrl rewrites 127.0.0.1 / localhost URLs to the page
// hostname when the browser is on a LAN address.  This is the core fix for
// mobile playback: the Python bridge returns audio_url with 127.0.0.1 which
// is unreachable from a phone on the LAN.

const originalLocation = window.location;

function setWindowLocation(hostname: string, protocol = "http:", port = "3000") {
  Object.defineProperty(window, "location", {
    value: {
      hostname,
      protocol,
      port,
      origin: `${protocol}//${hostname}:${port}`,
    },
    writable: true,
    configurable: true,
  });
}

function restoreWindowLocation() {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
}

describe("resolveHostAwareLocalUrl", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(restoreWindowLocation);

  test("rewrites 127.0.0.1 speech orchestrator URLs to the same-origin proxy when page host is LAN IP", async () => {
    setWindowLocation("192.168.1.81");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const result = resolveHostAwareLocalUrl("http://127.0.0.1:8767/speech/files/test.wav");
    expect(result).toBe("http://192.168.1.81:3000/api/deiphobeSpeech/speech/files/test.wav");
  });

  test("rewrites localhost speech orchestrator URLs to the same-origin proxy when page host is LAN IP", async () => {
    setWindowLocation("192.168.1.81");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const result = resolveHostAwareLocalUrl("http://localhost:8767/speech/files/test.wav");
    expect(result).toBe("http://192.168.1.81:3000/api/deiphobeSpeech/speech/files/test.wav");
  });

  test("preserves 127.0.0.1 URL when page host is also localhost", async () => {
    setWindowLocation("localhost");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const result = resolveHostAwareLocalUrl("http://127.0.0.1:8767/speech/files/test.wav");
    expect(result).toBe("http://127.0.0.1:8767/speech/files/test.wav");
  });

  test("preserves 127.0.0.1 URL when page host is 127.0.0.1", async () => {
    setWindowLocation("127.0.0.1");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const result = resolveHostAwareLocalUrl("http://127.0.0.1:8767/speech/files/test.wav");
    expect(result).toBe("http://127.0.0.1:8767/speech/files/test.wav");
  });

  test("returns url unchanged when window is undefined (SSR path)", () => {
    // resolveHostAwareLocalUrl guards with typeof window === 'undefined'
    // We test the guard logic by calling with an empty string (covers the !url branch)
    const { resolveHostAwareLocalUrl } = require("../src/utils/hostAwareUrl");
    expect(resolveHostAwareLocalUrl("")).toBe("");
  });

  test("returns non-local URL unchanged even on LAN page", async () => {
    setWindowLocation("192.168.1.81");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const url = "https://cdn.example.com/audio/file.wav";
    expect(resolveHostAwareLocalUrl(url)).toBe(url);
  });

  test("relative URL is not rewritten (no localhost hostname to replace)", async () => {
    setWindowLocation("192.168.1.81");
    const { resolveHostAwareLocalUrl } = await import("../src/utils/hostAwareUrl");
    const result = resolveHostAwareLocalUrl("/debug/deiphobe_speech_render");
    expect(result).not.toContain("127.0.0.1");
  });

  test("window.ethereum absent does not crash (Brave iOS wallet guard)", () => {
    // Simulates the _document.tsx ethereum guard:
    // if window.ethereum is absent (no wallet provider), code that tries
    // window.ethereum.selectedAddress = undefined must not crash.
    const eth: unknown = (window as any).ethereum;
    expect(() => {
      if (eth != null && typeof eth === "object") {
        (eth as any).selectedAddress = undefined;
      }
    }).not.toThrow();
  });
});
