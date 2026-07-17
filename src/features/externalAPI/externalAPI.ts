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

export const CONFIG_REVISION_HEADER = "x-config-revision";

function captureRevision(response: any) {
  const revision = response?.headers?.get?.(CONFIG_REVISION_HEADER);
  if (revision) {
    serverConfigRevision = revision;
  }
}

export async function fetcher(method: string, url: URL, data?: any) {
  let response: any;
  switch (method) {
    case "POST":
      try {
        response = await fetch(url, {
          method: method,
          headers: {
            "Content-Type": "application/json",
            ...(serverConfigRevision
              ? { [CONFIG_REVISION_HEADER]: serverConfigRevision }
              : {}),
          },
          body: JSON.stringify(data),
        });
        if (response.ok || response.status === 409) {
          // On success the server issues the new revision; on conflict it
          // reports the current one so the next deliberate save can proceed.
          // A conflicted write is never retried with the client's data.
          captureRevision(response);
        }
        if (response.status === 409) {
          console.warn("Server config changed elsewhere; save rejected.");
        }
      } catch (error) {
        console.error("Failed to POST server config: ", error);
      }
      break;

    case "GET":
      try {
        response = await fetch(url);
        if (response.ok) {
          serverConfig = await response.json();
          captureRevision(response);
        }
      } catch (error) {
        console.error("Failed to fetch server config:", error);
      }
      break;

    default:
      break;
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
      return fetcher("GET", configUrl);

    case "update":
      // Deliberate single-key mutation from an explicit user action.
      // A write must carry the revision the client read, so read first if
      // this client has never fetched the server config.
      if (serverConfigRevision === null) {
        await fetcher("GET", configUrl);
      }
      return fetcher("POST", configUrl, data);

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
