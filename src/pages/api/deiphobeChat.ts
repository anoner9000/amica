import type { NextApiRequest, NextApiResponse } from "next";
import { spawn } from "child_process";

import { handleConfig } from "@/features/externalAPI/externalAPI";
import { config } from "@/utils/config";
import { Message } from "@/features/chat/messages";
import { stripLeadingAmicaExpressionTag } from "@/features/chat/deiphobeChat";

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getLastUserMessage(messages: Message[] | undefined): string {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages[i].content;
    }
  }

  return "";
}

function hasBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function getSegmentControlRequest(body: Record<string, unknown>) {
  const hasNewSegment = Object.prototype.hasOwnProperty.call(body, "new_segment");
  const hasContinuePreviousSegment = Object.prototype.hasOwnProperty.call(
    body,
    "continue_previous_segment",
  );
  if (!hasNewSegment && !hasContinuePreviousSegment) {
    return null;
  }

  if (!hasBoolean(body.new_segment) || !hasBoolean(body.continue_previous_segment)) {
    throw new Error("Invalid conversation segment control");
  }

  if (body.new_segment && body.continue_previous_segment) {
    throw new Error("Conversation segment controls conflict");
  }

  if (!body.new_segment && !body.continue_previous_segment) {
    throw new Error("Conversation segment control is missing");
  }

  const text = typeof body.text === "string" ? stripLeadingAmicaExpressionTag(body.text).trim() : "";
  if (text !== "") {
    throw new Error("Conversation segment controls must not include ordinary text");
  }

  return {
    new_segment: body.new_segment,
    continue_previous_segment: body.continue_previous_segment,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await handleConfig("fetch");

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body ?? {};
  let segmentControl: ReturnType<typeof getSegmentControlRequest> | null = null;
  let text = "";
  let amicaMessageCount = 0;
  let amicaIncomingChars = 0;
  try {
    segmentControl = getSegmentControlRequest(body);
    const hasText = typeof body.text === "string";
    const rawText = hasText ? body.text : getLastUserMessage(body.messages);
    text = stripLeadingAmicaExpressionTag(rawText).trim();
    const rawMessages: Message[] = Array.isArray(body.messages) ? (body.messages as Message[]) : [];
    amicaMessageCount = rawMessages.length;
    amicaIncomingChars = rawMessages.reduce(
      (sum: number, m: Message) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );

    if (!segmentControl && !text.trim()) {
      res.status(400).json({ error: "Missing text" });
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const repoRoot = config("deiphobe_repo_root");
  const command = config("deiphobe_command");
  const userId = config("deiphobe_user_id");
  const sessionId = config("deiphobe_session_id");
  const namespace = config("deiphobe_namespace");
  const privateMode = config("deiphobe_private_mode");
  const privateMemoryRoot = config("deiphobe_private_memory_root").trim();
  const timeoutSeconds = Number.parseInt(
    config("deiphobe_timeout_seconds") || "120",
    10,
  );

  // Optional token budget for the Deiphobe chat subprocess.
  // Precedence: process.env.LLM_NUM_PREDICT (explicit server env) > deiphobe_chat_num_predict config > unset.
  // Empty string or absent config = no cap (current behavior).
  const chatNumPredictRaw = config("deiphobe_chat_num_predict").trim();
  let chatNumPredict: string | null = null;
  if (chatNumPredictRaw !== "") {
    const parsed = Number.parseInt(chatNumPredictRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0 && String(parsed) === chatNumPredictRaw) {
      chatNumPredict = chatNumPredictRaw;
    } else {
      console.warn("[Amica Deiphobe] deiphobe_chat_num_predict ignored: expected a positive integer");
    }
  }

  console.debug("[Amica Deiphobe] starting", {
    privateMode: isTruthy(privateMode),
    privateMemoryRoot: privateMemoryRoot ? "[configured]" : "[not configured]",
    chatNumPredict: chatNumPredict ?? "[unset]",
    timeoutSeconds,
    textChars: text.length,
    messageCount: amicaMessageCount,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEIPHOBE_CHAT_USER_ID: userId,
    DEIPHOBE_CHAT_SESSION_ID: sessionId,
    DEIPHOBE_CHAT_NAMESPACE: namespace,
    DEIPHOBE_PRIVATE_MODE: isTruthy(privateMode) ? "1" : "0",
    CLOCKD_SESSION_OVERRIDE_JSON: process.env.CLOCKD_SESSION_OVERRIDE_JSON || '{"active": true}',
    DEIPHOBE_AMICA_MESSAGE_COUNT: String(amicaMessageCount),
    DEIPHOBE_AMICA_INCOMING_CHARS: String(amicaIncomingChars),
  };
  if (privateMemoryRoot) {
    env.DEIPHOBE_PRIVATE_MEMORY_ROOT = privateMemoryRoot;
  }
  // Apply config token budget only when the server env does not already set it.
  if (!process.env.LLM_NUM_PREDICT && chatNumPredict !== null) {
    env.LLM_NUM_PREDICT = chatNumPredict;
  }

  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? timeoutSeconds * 1000
    : 120000;

  const chatArgs = segmentControl
    ? ["chat", segmentControl.new_segment ? "--new-segment" : "--continue-previous-segment"]
    : ["chat", "--text", text, "--json"];
  const timeout = setTimeout(() => {
    console.warn("[Amica Deiphobe] timeout reached, killing child process");
    child?.kill("SIGKILL");
  }, timeoutMs);

  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(command, chatArgs, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.once("spawn", () => {
      console.debug("[Amica Deiphobe] child spawned");
    });

    child.stdout!.on("data", (chunk: Buffer) => {
      const textChunk = chunk.toString("utf-8");
      stdout += textChunk;
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const textChunk = chunk.toString("utf-8");
      stderr += textChunk;
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        try {
          if (segmentControl) {
            res.status(200).json({ text: stdout.trim() });
            return;
          }
          const payload = JSON.parse(stdout.trim());
          res.status(200).json(payload);
        } catch {
          res.status(502).json({ error: "Invalid Deiphobe response" });
        }
        return;
      }

      console.error("[Amica Deiphobe] failed", {
        code,
        signal,
        stderrChars: stderr.length,
        stdoutChars: stdout.length,
      });

      if (!res.headersSent) {
        res.status(500);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }

      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: "Deiphobe execution failed" }));
      }
    });
  } catch (error) {
    clearTimeout(timeout);
    console.error("[Amica Deiphobe] spawn error", error);
    if (!res.headersSent) {
      res.status(500);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    if (!res.writableEnded) {
      res.status(500);
      res.end(JSON.stringify({ error: "Deiphobe execution failed" }));
    }
  }
}
