import { config } from "@/utils/config";
import {
  MAX_STORAGE_TOKENS,
  TimestampedPrompt,
} from "../amicaLife/eventHandler";
import { Message } from "../chat/messages";

export const configUrl = new URL(
  `${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler`,
);
configUrl.searchParams.append("type", "config");

export const userInputUrl = new URL(
  `${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler`,
);
userInputUrl.searchParams.append("type", "userInputMessages");

export const subconsciousUrl = new URL(
  `${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler`,
);
subconsciousUrl.searchParams.append("type", "subconscious");

export const logsUrl = new URL(
  `${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler`,
);
logsUrl.searchParams.append("type", "logs");

export const chatLogsUrl = new URL(
  `${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler`,
);
chatLogsUrl.searchParams.append("type", "chatLogs");

// Cached server config
export let serverConfig: Record<string, string> = {};

// Optimistic-concurrency token for the server config file. The server issues
// it on every config GET/POST; a config write is only accepted when it carries
// the revision the client last read. Never invented client-side.
export let serverConfigRevision: string | null = null;
let configFetchPromise: Promise<any> | null = null;

export const CONFIG_REVISION_HEADER = "x-config-revision";

export class ConfigRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null = null) {
    super(message);
    this.name = "ConfigRequestError";
    this.status = status;
    this.code = code;
  }
}

export class ConfigConflictError extends ConfigRequestError {
  constructor(message = "Server configuration changed elsewhere; save rejected.") {
    super(message, 409, "CONFIG_REVISION_CONFLICT");
    this.name = "ConfigConflictError";
  }
}

function responseRevision(response: any): string | null {
  const revision = response?.headers?.get?.(CONFIG_REVISION_HEADER);
  return typeof revision === "string" && revision.length > 0 ? revision : null;
}

async function responseError(response: any, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === "string" && body.error.length > 0
      ? body.error
      : fallback;
  } catch {
    return fallback;
  }
}

export async function fetcher(
  method: "GET" | "POST",
  url: URL,
  data?: Record<string, string>,
  revision?: string,
) {
  let response: any;
  try {
    response = await fetch(url, method === "POST"
      ? {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(revision ? { [CONFIG_REVISION_HEADER]: revision } : {}),
          },
          body: JSON.stringify(data),
        }
      : undefined);
  } catch (error) {
    throw new ConfigRequestError(
      method === "POST"
        ? "Could not reach the configuration server; the save was not confirmed."
        : "Could not load server configuration.",
      null,
    );
  }

  if (!response.ok) {
    if (response.status === 409) {
      throw new ConfigConflictError(await responseError(
        response,
        "Server configuration changed elsewhere; save rejected.",
      ));
    }
    throw new ConfigRequestError(
      await responseError(response, `${method} configuration request failed.`),
      response.status,
    );
  }

  return response;
}

export async function handleConfig(
  type: string,
  data?: Record<string, string>,
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  switch (type) {
    case "fetch":
      // Read-only: populate the server config cache. Hydration, remounts,
      // reloads, and reconnects may only ever take this path. The server
      // file is authoritative; client defaults are not.
      {
        if (configFetchPromise === null) {
          configFetchPromise = (async () => {
            const response = await fetcher("GET", configUrl);
            const revision = responseRevision(response);
            if (!revision) {
              throw new ConfigRequestError(
                "Configuration response did not include a revision.",
                response.status ?? 200,
              );
            }
            serverConfig = await response.json();
            serverConfigRevision = revision;
            return response;
          })();
        }
        const currentFetch = configFetchPromise;
        try {
          return await currentFetch;
        } finally {
          if (configFetchPromise === currentFetch) {
            configFetchPromise = null;
          }
        }
      }

    case "update":
      // Deliberate single-key mutation from an explicit user action.
      // A write must carry the revision the client read, so read first if
      // this client has never fetched the server config.
      if (serverConfigRevision === null) {
        await handleConfig("fetch");
      }
      if (!data || typeof data.key !== "string" || typeof data.value !== "string") {
        throw new ConfigRequestError("Invalid configuration mutation.", null);
      }
      {
        // Read the revision at execution time. The serialized caller queue
        // guarantees this request completes and advances it before the next
        // mutation can reach this point.
        const submittedRevision = serverConfigRevision;
        if (!submittedRevision) {
          throw new ConfigRequestError(
            "No authoritative configuration revision is available.",
            null,
          );
        }
        const response = await fetcher("POST", configUrl, data, submittedRevision);
        const returnedRevision = responseRevision(response);
        if (!returnedRevision) {
          throw new ConfigRequestError(
            "Configuration save succeeded without a returned revision.",
            response.status ?? 200,
          );
        }
        serverConfig = { ...serverConfig, [data.key]: data.value };
        serverConfigRevision = returnedRevision;
        return response;
      }

    default:
      return;
  }
}

export async function handleUserInput(message: string) {
  if (process.env.NODE_ENV !== "development" || config("external_api_enabled") !== "true") {
    return;
  }

  fetch(userInputUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: config("system_prompt"),
      message: message,
    }),
  }).catch(() => {});
}

export async function handleChatLogs(messages: Message[]) {
  if (process.env.NODE_ENV !== "development" || config("external_api_enabled") !== "true") {
    return;
  }

  fetch(chatLogsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  }).catch(() => {});
}

export async function handleSubconscious(
  timestampedPrompt: TimestampedPrompt,
): Promise<any> {
  if (process.env.NODE_ENV !== "development" || config("external_api_enabled") !== "true") {
    return;
  }

  const data = await fetch(subconsciousUrl);
  if (!data.ok) {
    throw new Error("Failed to get subconscious data");
  }

  const currentStoredSubconscious: TimestampedPrompt[] = await data.json();
  currentStoredSubconscious.push(timestampedPrompt);

  let totalStorageTokens = currentStoredSubconscious.reduce(
    (totalTokens, prompt) => totalTokens + prompt.prompt.length,
    0,
  );
  while (totalStorageTokens > MAX_STORAGE_TOKENS) {
    const removed = currentStoredSubconscious.shift();
    totalStorageTokens -= removed!.prompt.length;
  }

  const response = await fetch(subconsciousUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subconscious: currentStoredSubconscious }),
  });

  if (!response.ok) {
    throw new Error("Failed to update subconscious data");
  }

  return currentStoredSubconscious;
}
