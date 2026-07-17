import { Message } from "./messages";

export function stripLeadingAmicaExpressionTag(text: string): string {
  const match = text.match(/^\s*\[([^\]]+)\]\s*/);
  if (!match) {
    return text;
  }

  const tag = match[1]?.trim().toLowerCase();
  const allowedTags = new Set([
    "neutral",
    "happy",
    "angry",
    "sad",
    "relaxed",
    "surprised",
    "shy",
    "jealous",
    "bored",
    "serious",
    "suspicious",
    "victory",
    "sleep",
    "love",
  ]);
  if (!allowedTags.has(tag)) {
    return text;
  }

  return text.slice(match[0].length);
}

export type DeiphobeConversationSegmentControl = {
  text?: string | null;
  new_segment: boolean;
  continue_previous_segment: boolean;
};

export type DeiphobeInteractionRequest = {
  request_id: string;
  kind: string;
  title: string;
  explanation: string;
  requested_capability: string;
  action_digest: string;
  required_authentication: string;
  expires_at: string;
  review?: {
    summary: string;
    sensitivity?: string;
    choices: Array<{ choice_id: string; label: string }>;
  };
};

export type DeiphobeMemoryAction = {
  action: "explicit_low_risk_save";
  outcome: "saved" | "unchanged";
  changed: boolean;
  undo_token?: string;
  undo_expires_at?: string;
};

type DeiphobeResponse = {
  text: string;
  interaction_request?: DeiphobeInteractionRequest;
  memory_action?: DeiphobeMemoryAction;
};

type DeiphobeChatRequest = {
  text?: string | null;
  messages?: Message[];
  new_segment?: boolean;
  continue_previous_segment?: boolean;
};

function getLastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages[i].content;
    }
  }

  return messages[messages.length - 1]?.content ?? "";
}

function stripLastUserMessageAmicaExpressionTag(messages: Message[]): Message[] {
  const nextMessages = [...messages];
  for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
    if (nextMessages[i]?.role === "user") {
      nextMessages[i] = {
        ...nextMessages[i],
        content: stripLeadingAmicaExpressionTag(nextMessages[i].content),
      };
      break;
    }
  }
  return nextMessages;
}

async function postDeiphobeChat(body: DeiphobeChatRequest): Promise<DeiphobeResponse> {
  const response = await fetch("/api/deiphobeChat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Deiphobe chat error (${response.status})`);
  }

  const payload = (await response.json()) as DeiphobeResponse;
  if (typeof payload.text !== "string") {
    throw new Error("Deiphobe chat returned an invalid response");
  }
  return payload;
}

export async function getDeiphobeChatResponseStream(
  messages: Message[],
): Promise<ReadableStream> {
  const text = stripLeadingAmicaExpressionTag(getLastUserMessage(messages)).trim();
  if (!text) {
    throw new Error("Deiphobe backend requires a user message");
  }

  console.debug("[Deiphobe] request", {
    messageCount: messages.length,
    textChars: text.length,
  });

  const payload = await postDeiphobeChat({
    text,
    messages: stripLastUserMessageAmicaExpressionTag(messages),
  });
  if (payload.interaction_request && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DeiphobeInteractionRequest>("deiphobe:interaction-request", {
        detail: payload.interaction_request,
      }),
    );
  }
  if (payload.memory_action && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DeiphobeMemoryAction>("deiphobe:memory-action", {
        detail: payload.memory_action,
      }),
    );
  }
  const encoded = new TextEncoder().encode(payload.text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

export async function sendDeiphobeConversationSegmentControl(
  control: DeiphobeConversationSegmentControl,
): Promise<string> {
  const payload = await postDeiphobeChat(control);
  return payload.text.trim();
}
