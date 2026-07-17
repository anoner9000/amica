import { randomBytes } from "crypto";
import type { NextApiResponse } from "next";
import fs from "fs";
import { sseClients } from "./sseClients";

export interface ApiResponse {
  sessionId?: string;
  outputType?: string;
  response?: any;
  error?: string;
}

export interface apiLogEntry {
  sessionId: string;
  timestamp: string;
  inputType: string;
  outputType: string;
  response?: any;
  error?: string;
}

export const generateSessionId = (sessionId?: string): string =>
  sessionId || randomBytes(8).toString("hex");

export const sendError = (
  res: NextApiResponse,
  sessionId: string,
  message: string,
  status = 400,
) => res.status(status).json({ sessionId, error: message });

export const sendToClients = (message: { type: string; data: any }) => {
  const formattedMessage = JSON.stringify(message);
  sseClients.forEach((client) => client.res.write(`data: ${formattedMessage}\n\n`));
};

export const readFile = (filePath: string): any => {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading file at ${filePath}:`, error);
    throw new Error(`Failed to read file: ${error}`);
  }
};

export const writeFile = (filePath: string, content: any): void => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf8");
  } catch (error) {
    console.error(`Error writing file at ${filePath}:`, error);
    throw new Error(`Failed to write file: ${error}`);
  }
};

// Atomic replacement for authoritative files: serialize, write to a temp
// file on the same filesystem, flush, then rename over the target. The
// previous version is kept as a single bounded .bak. A partially written
// file can never become authoritative.
export const writeFileAtomic = (
  filePath: string,
  content: any,
  options: { defaultMode?: number } = {},
): void => {
  const serialized = JSON.stringify(content, null, 2);
  if (serialized === undefined) {
    throw new Error("Refusing to write unserializable content");
  }
  let mode = options.defaultMode ?? 0o600;
  let exists = false;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
    exists = true;
  } catch {
    // Target does not exist yet; use the default mode.
  }
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, "w", mode);
    fs.writeSync(fd, serialized, null, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (exists) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
      fs.chmodSync(`${filePath}.bak`, mode);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tmpPath); } catch {}
    console.error(`Error atomically writing file at ${filePath}:`, error);
    throw new Error(`Failed to write file: ${error}`);
  }
};
