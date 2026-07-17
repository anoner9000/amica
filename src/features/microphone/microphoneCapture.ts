/**
 * Click-time microphone capture for the chat composer.
 *
 * Replaces the previous mount-time useMicVAD flow, which requested the
 * microphone during component mount (no user gesture), held the stream for
 * the whole session, and permanently disabled the button after any failure.
 *
 * Rules implemented here:
 * - capture starts only from an explicit user gesture (start() is called
 *   from the button click handler);
 * - capability is evaluated at click time, never cached from mount;
 * - failures are classified structurally and never poison later attempts;
 * - a stale device preference falls back to a general audio request;
 * - every acquired track is stopped on completion, cancellation, error,
 *   unmount, retry, and timeout;
 * - duplicate sessions are prevented;
 * - a hanging permission prompt times out without freezing the UI;
 * - microphone state is browser-local and never touches server config.
 */

export type MicrophoneFailureClass =
  | "insecure_context"
  | "api_unavailable"
  | "permission_denied"
  | "policy_blocked"
  | "no_input_device"
  | "device_busy_or_unreadable"
  | "constraints_unsatisfied"
  | "recording_unsupported"
  | "capture_aborted"
  | "unknown_capture_failure";

export interface MicrophoneEnvironment {
  origin: string;
  secureContext: boolean;
  apiAvailable: boolean;
  permission: string | null;
  policyAllowed: boolean | null;
}

export interface MicrophoneFailure {
  failureClass: MicrophoneFailureClass;
  guidance: string;
  errorName: string | null;
  environment: MicrophoneEnvironment;
}

export const MICROPHONE_GUIDANCE: Record<MicrophoneFailureClass, string> = {
  insecure_context:
    "This page is not using a secure browser context. Open Amica through " +
    "its HTTPS address (or http://localhost) to use the microphone.",
  api_unavailable:
    "This browser does not expose microphone APIs on this page. Open Amica " +
    "through its HTTPS address, or use a browser that supports microphone capture.",
  permission_denied:
    "Microphone access is blocked for this site. Allow Microphone in your " +
    "browser's site settings (Brave: the shield/lock icon in the address " +
    "bar), then try again.",
  policy_blocked:
    "Microphone access is blocked by this page's embedding or permissions " +
    "policy. Open Amica directly rather than inside an embedded frame.",
  no_input_device:
    "No microphone was detected. Connect or enable an input device, then retry.",
  device_busy_or_unreadable:
    "The microphone could not be read. It may be in use by another " +
    "application. Close other apps using the microphone, then retry.",
  constraints_unsatisfied:
    "The selected microphone is unavailable. Choose another device or retry " +
    "with the system default.",
  recording_unsupported:
    "Audio recording is not supported by this browser on this page.",
  capture_aborted:
    "Microphone capture was interrupted. Try again.",
  unknown_capture_failure:
    "The microphone could not be started. Check the browser's microphone " +
    "permissions and input devices, then try again.",
};

export async function probeMicrophoneEnvironment(): Promise<MicrophoneEnvironment> {
  const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
  const doc: any = typeof document !== "undefined" ? document : undefined;
  const win: any = typeof window !== "undefined" ? window : undefined;

  let permission: string | null = null;
  try {
    if (nav?.permissions?.query) {
      const status = await nav.permissions.query({ name: "microphone" });
      permission = status?.state ?? null;
    }
  } catch {
    permission = null;
  }

  let policyAllowed: boolean | null = null;
  try {
    const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
    if (policy?.allowsFeature) {
      policyAllowed = Boolean(policy.allowsFeature("microphone"));
    }
  } catch {
    policyAllowed = null;
  }

  return {
    origin: win?.location?.origin ?? "unknown",
    secureContext: Boolean(win?.isSecureContext),
    apiAvailable: typeof nav?.mediaDevices?.getUserMedia === "function",
    permission,
    policyAllowed,
  };
}

export function classifyMicrophoneFailure(
  error: unknown,
  environment: MicrophoneEnvironment,
): MicrophoneFailureClass {
  // Environmental classes take precedence: an insecure context produces a
  // TypeError, but the actionable cause is the origin, not the exception.
  if (!environment.secureContext) {
    return "insecure_context";
  }
  if (!environment.apiAvailable) {
    return "api_unavailable";
  }

  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as any).name)
      : "";

  switch (name) {
    case "NotAllowedError":
      return environment.policyAllowed === false
        ? "policy_blocked"
        : "permission_denied";
    case "SecurityError":
      return "policy_blocked";
    case "NotFoundError":
      return "no_input_device";
    case "NotReadableError":
      return "device_busy_or_unreadable";
    case "OverconstrainedError":
      return "constraints_unsatisfied";
    case "AbortError":
    case "InvalidStateError":
      return "capture_aborted";
    case "TypeError":
      return "api_unavailable";
    case "NotSupportedError":
      return "recording_unsupported";
    default:
      return "unknown_capture_failure";
  }
}

export function buildMicrophoneFailure(
  error: unknown,
  environment: MicrophoneEnvironment,
): MicrophoneFailure {
  const failureClass = classifyMicrophoneFailure(error, environment);
  return {
    failureClass,
    guidance: MICROPHONE_GUIDANCE[failureClass],
    errorName:
      error && typeof error === "object" && "name" in error
        ? String((error as any).name)
        : null,
    environment,
  };
}

// Structured diagnostic event. Never records audio or device labels.
export function emitMicrophoneDiagnostic(
  event: string,
  detail: Record<string, unknown>,
): void {
  console.info("[mic-diagnostic]", { event, ...detail });
}

export interface MicrophoneCaptureCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVADMisfire?: () => void;
  onFailure?: (failure: MicrophoneFailure) => void;
  onStopped?: () => void;
}

export interface MicrophoneCaptureOptions extends MicrophoneCaptureCallbacks {
  workletURL: string;
  modelURL: string;
  // Browser-local device preference; a stale id falls back to the default.
  preferredDeviceId?: string | null;
  // How long a permission prompt may hang before the attempt is abandoned.
  permissionTimeoutMs?: number;
}

interface ActiveSession {
  stream: MediaStream;
  vad: { start: () => void; pause: () => void; destroy: () => void } | null;
  onDeviceChange: (() => void) | null;
}

const DEFAULT_PERMISSION_TIMEOUT_MS = 20_000;

// Injection point for tests; production uses the real vad-web MicVAD.
export type VadFactory = (options: Record<string, unknown>) => Promise<{
  start: () => void;
  pause: () => void;
  destroy: () => void;
}>;

async function defaultVadFactory(options: Record<string, unknown>) {
  const { MicVAD } = await import("@ricky0123/vad-web");
  return MicVAD.new(options as any);
}

export class MicrophoneCapture {
  private session: ActiveSession | null = null;
  private starting = false;
  private generation = 0;
  private vadFactory: VadFactory;

  constructor(vadFactory: VadFactory = defaultVadFactory) {
    this.vadFactory = vadFactory;
  }

  get isActive(): boolean {
    return this.session !== null;
  }

  get isStarting(): boolean {
    return this.starting;
  }

  /**
   * Start capture. Must be called from an explicit user gesture.
   * Returns null on success, or a MicrophoneFailure describing why capture
   * could not start. Failure never poisons later attempts.
   */
  async start(options: MicrophoneCaptureOptions): Promise<MicrophoneFailure | null> {
    // Duplicate clicks while starting or listening never create a second
    // recorder.
    if (this.starting || this.session) {
      return null;
    }
    this.starting = true;
    const generation = ++this.generation;

    try {
      const environment = await probeMicrophoneEnvironment();
      if (!environment.secureContext || !environment.apiAvailable) {
        const failure = buildMicrophoneFailure(null, environment);
        this.reportFailure(failure, options, { notify: false });
        return failure;
      }

      let stream: MediaStream;
      try {
        stream = await this.acquireStream(options, environment);
      } catch (error) {
        const failure = buildMicrophoneFailure(error, environment);
        this.reportFailure(failure, options, { notify: false });
        return failure;
      }

      // The user may have clicked stop (or the component unmounted) while
      // the permission prompt was open; release the late stream.
      if (generation !== this.generation) {
        stopTracks(stream);
        return null;
      }

      let vad: ActiveSession["vad"] = null;
      try {
        vad = await this.vadFactory({
          stream,
          workletURL: options.workletURL,
          modelURL: options.modelURL,
          startOnLoad: false,
          onSpeechStart: options.onSpeechStart,
          onSpeechEnd: options.onSpeechEnd,
          onVADMisfire: options.onVADMisfire,
        });
      } catch (error) {
        stopTracks(stream);
        const failure = buildMicrophoneFailure(error, environment);
        this.reportFailure(failure, options, { notify: false });
        return failure;
      }

      if (generation !== this.generation) {
        stopTracks(stream);
        try { vad?.destroy(); } catch {}
        return null;
      }

      const onDeviceChange = () => this.handleDeviceChange(options);
      try {
        navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
      } catch {}

      this.session = { stream, vad, onDeviceChange };
      vad!.start();
      emitMicrophoneDiagnostic("capture_started", {
        origin: environment.origin,
        secureContext: environment.secureContext,
        permission: environment.permission,
      });
      return null;
    } finally {
      this.starting = false;
    }
  }

  /** Stop capture and release every acquired track. Always safe to call. */
  stop(): void {
    this.generation += 1;
    const session = this.session;
    this.session = null;
    if (!session) {
      return;
    }
    if (session.onDeviceChange) {
      try {
        navigator.mediaDevices?.removeEventListener?.(
          "devicechange",
          session.onDeviceChange,
        );
      } catch {}
    }
    try { session.vad?.pause(); } catch {}
    try { session.vad?.destroy(); } catch {}
    stopTracks(session.stream);
    emitMicrophoneDiagnostic("capture_stopped", {});
  }

  private reportFailure(
    failure: MicrophoneFailure,
    options: MicrophoneCaptureCallbacks,
    { notify = true }: { notify?: boolean } = {},
  ): void {
    emitMicrophoneDiagnostic("capture_failed", {
      failureClass: failure.failureClass,
      errorName: failure.errorName,
      origin: failure.environment.origin,
      secureContext: failure.environment.secureContext,
      apiAvailable: failure.environment.apiAvailable,
      permission: failure.environment.permission,
      policyAllowed: failure.environment.policyAllowed,
    });
    // Start-path failures are returned to the caller; onFailure is reserved
    // for asynchronous mid-session failures (e.g. the device disappearing).
    if (notify) {
      options.onFailure?.(failure);
    }
  }

  private async acquireStream(
    options: MicrophoneCaptureOptions,
    environment: MicrophoneEnvironment,
  ): Promise<MediaStream> {
    const timeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    const constraintsList: MediaStreamConstraints[] = [];
    if (options.preferredDeviceId) {
      constraintsList.push({
        audio: { deviceId: { exact: options.preferredDeviceId } },
      });
    }
    constraintsList.push({ audio: true });

    let lastError: unknown = null;
    for (const constraints of constraintsList) {
      try {
        return await withTimeout(
          navigator.mediaDevices.getUserMedia(constraints),
          timeoutMs,
        );
      } catch (error) {
        lastError = error;
        const name =
          error && typeof error === "object" && "name" in error
            ? String((error as any).name)
            : "";
        const wasDeviceSpecific =
          constraints !== constraintsList[constraintsList.length - 1];
        // A stale device preference falls back to the system default; any
        // other failure (or a failed general request) is terminal.
        if (
          !wasDeviceSpecific ||
          !["OverconstrainedError", "NotFoundError", "NotReadableError"].includes(name)
        ) {
          throw error;
        }
        emitMicrophoneDiagnostic("device_fallback", {
          errorName: name,
          origin: environment.origin,
        });
      }
    }
    throw lastError;
  }

  private async handleDeviceChange(options: MicrophoneCaptureOptions) {
    const session = this.session;
    if (!session) {
      return;
    }
    // If every live track ended (the active input disappeared), stop the
    // session cleanly instead of leaving a dead recorder.
    const anyLive = session.stream
      .getTracks()
      .some((track) => track.readyState === "live");
    if (!anyLive) {
      this.stop();
      const environment = await probeMicrophoneEnvironment();
      this.reportFailure(
        {
          failureClass: "no_input_device",
          guidance: MICROPHONE_GUIDANCE.no_input_device,
          errorName: null,
          environment,
        },
        options,
      );
    }
  }
}

function stopTracks(stream: MediaStream): void {
  try {
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  } catch {}
}

function withTimeout(
  promise: Promise<MediaStream>,
  ms: number,
): Promise<MediaStream> {
  return new Promise<MediaStream>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(
        new DOMException(
          "Timed out waiting for microphone permission",
          "AbortError",
        ),
      );
    }, ms);
    promise.then(
      (stream) => {
        clearTimeout(timer);
        if (timedOut) {
          // The prompt was answered after the attempt was abandoned; the
          // stream must not stay live in the background.
          stopTracks(stream);
          return;
        }
        resolve(stream);
      },
      (error) => {
        clearTimeout(timer);
        if (!timedOut) {
          reject(error);
        }
      },
    );
  });
}
