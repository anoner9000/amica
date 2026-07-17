import isDev from "@/utils/isDev";
import { readFile, writeFile, writeFileAtomic } from "./utils/apiHelper";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { config } from "@/utils/config";

// Define file paths. The env override exists so tests can point the handler
// at a fixture directory instead of the real host configuration.
const storageDir =
  process.env.AMICA_DATA_HANDLER_STORAGE_DIR ||
  path.resolve("src/features/externalAPI/dataHandlerStorage");

export const configFilePath = path.join(storageDir, "config.json");
export const subconsciousFilePath = path.join(storageDir, "subconscious.json");
export const logsFilePath = path.join(storageDir, "logs.json");
export const userInputMessagesFilePath = path.join(
  storageDir,
  "userInputMessages.json",
);
export const chatLogsFilePath = path.join(storageDir, "chatLogs.json");

// Optimistic-concurrency token for the authoritative config file: a digest
// of the exact bytes on disk. Owned by the server; clients echo it back.
export class ConfigConflictError extends Error {
  currentRevision: string;
  constructor(message: string, currentRevision: string) {
    super(message);
    this.name = "ConfigConflictError";
    this.currentRevision = currentRevision;
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export const configRevision = (): string => {
  const bytes = fs.readFileSync(configFilePath);
  return createHash("sha256").update(bytes).digest("hex");
};

// GET Request Handlers
export const handleGetConfig = () => readFile(configFilePath);
export const handleGetSubconscious = () => readFile(subconsciousFilePath);
export const handleGetLogs = () => readFile(logsFilePath);
export const handleGetUserInputMessages = () =>
  readFile(userInputMessagesFilePath);
export const handleGetChatLogs = () => readFile(chatLogsFilePath);

// POST Request Handlers
export const handlePostConfig = (body: any, revision?: string) =>
  updateConfig(body, revision);
export const handlePostSubconscious = (body: any) => updateSubconscious(body);
export const handlePostUserInputMessages = (body: any) => updateUserInputMessages(body);
export const handlePostLogs = (body: any) => updateLogs(body);
export const handlePostChatLogs = (body: any) => updateChatLogs(body);

// Update Functions
//
// The server config file is authoritative. Only deliberate single-key
// mutations are accepted; bulk replacement (the vector by which fresh
// clients used to overwrite the host configuration with defaults) is
// structurally impossible. Every write must carry the revision the client
// read; stale or absent revisions are rejected without touching the file.
const updateConfig = (body: any, revision?: string) => {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof body.key !== "string" ||
    body.key.length === 0
  ) {
    throw new ConfigValidationError(
      "Config updates must be a single {key, value} mutation.",
    );
  }
  if (typeof body.value !== "string") {
    throw new ConfigValidationError("Config values must be strings.");
  }

  const currentRevision = configRevision();
  if (!revision) {
    throw new ConfigConflictError(
      "Config update is missing the revision it was based on.",
      currentRevision,
    );
  }
  if (revision !== currentRevision) {
    throw new ConfigConflictError(
      "Config was changed by another writer.",
      currentRevision,
    );
  }

  const config = readFile(configFilePath);
  const { key, value } = body;
  if (!config.hasOwnProperty(key)) {
    throw new ConfigValidationError(`Config key "${key}" not found.`);
  }
  config[key] = value;
  writeFileAtomic(configFilePath, config, { defaultMode: 0o600 });
  const newRevision = configRevision();
  console.info(
    `[dataHandler] config updated key=${key} revision=${newRevision.slice(0, 12)}`,
  );
  return { message: "Config updated successfully.", revision: newRevision };
};

const updateSubconscious = (body: any) => {
  if (!isDev || config("external_api_enabled") !== "true") {
    return;
  }

  if (!Array.isArray(body.subconscious)) {
    throw new Error("Subconscious data must be an array.");
  }
  writeFile(subconsciousFilePath, body.subconscious);
  return { message: "Subconscious data updated successfully." };
};

const updateUserInputMessages = (body: any) => {
  if (!isDev || config("external_api_enabled") !== "true") {
    return;
  }

  let existingMessage = readFile(userInputMessagesFilePath);
  if (!Array.isArray(existingMessage)) {
    existingMessage = [];
  }
  existingMessage.push(body);
  writeFile(userInputMessagesFilePath, existingMessage);
  return { message: "User input messages updated successfully." };
};

const updateLogs = (body: any) => {
  if (!isDev || config("external_api_enabled") !== "true") {
    return;
  }

  const { type, ts, arguments: logArguments } = body;
  const logEntry = { type, ts, arguments: logArguments };
  let existingLogs = readFile(logsFilePath);
  if (!Array.isArray(existingLogs)) {
    existingLogs = [];
  }
  existingLogs.push(logEntry);
  writeFile(logsFilePath, existingLogs);
  return { message: "Logs updated successfully." };
};

const updateChatLogs = (body: any) => {
  if (!isDev || config("external_api_enabled") !== "true") {
    return;
  }

  if (!Array.isArray(body)) {
    throw new Error("Chat logs data must be an array.");
  }
  writeFile(chatLogsFilePath, body);
  return { message: "Chat logs data updated successfully." };
};
