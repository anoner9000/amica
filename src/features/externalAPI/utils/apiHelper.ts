import { randomBytes } from "crypto";
import type { NextApiResponse } from "next";
import fs from "fs";
import path from "path";
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

export type AtomicWritePhase =
  | "target-stat"
  | "temporary-file"
  | "temporary-file-mode"
  | "temporary-file-write"
  | "temporary-file-fsync"
  | "temporary-file-close"
  | "backup"
  | "target-rename"
  | "directory-open"
  | "directory-fsync"
  | "directory-close";

export class AtomicPersistenceError extends Error {
  readonly phase: AtomicWritePhase;
  readonly targetReplaced: boolean;

  constructor(phase: AtomicWritePhase, targetReplaced: boolean, cause: unknown) {
    const durability = targetReplaced
      ? "The new configuration may be visible, but durable persistence was not confirmed."
      : "The previous configuration remains authoritative.";
    super(`Atomic configuration persistence failed during ${phase}. ${durability}`, {
      cause,
    });
    this.name = "AtomicPersistenceError";
    this.phase = phase;
    this.targetReplaced = targetReplaced;
  }
}

function closeFileDescriptor(fd: number, phase: AtomicWritePhase, replaced: boolean) {
  try {
    fs.closeSync(fd);
  } catch (error) {
    throw new AtomicPersistenceError(phase, replaced, error);
  }
}

function writeCompleteBytes(fd: number, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw new Error("Filesystem made no progress while writing configuration.");
    }
    offset += written;
  }
}

// Atomic replacement for authoritative files. Both the new file contents and
// the final directory entry are synchronized before success is reported. The
// previous version is kept as one atomically replaced, bounded .bak file.
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new AtomicPersistenceError("target-stat", false, error);
    }
    // The target genuinely does not exist; use the configured default mode.
  }
  const bytes = Buffer.from(serialized, "utf8");
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const tmpPath = `${filePath}.tmp-${nonce}`;
  const backupPath = `${filePath}.bak`;
  const backupTmpPath = `${backupPath}.tmp-${nonce}`;
  let fd: number | null = null;
  let backupFd: number | null = null;
  let directoryFd: number | null = null;
  let phase: AtomicWritePhase = "temporary-file";
  let targetReplaced = false;
  try {
    fd = fs.openSync(tmpPath, "wx", mode);
    phase = "temporary-file-mode";
    fs.fchmodSync(fd, mode);
    phase = "temporary-file-write";
    writeCompleteBytes(fd, bytes);
    phase = "temporary-file-fsync";
    fs.fsyncSync(fd);
    phase = "temporary-file-close";
    closeFileDescriptor(fd, phase, false);
    fd = null;

    if (exists) {
      phase = "backup";
      fs.copyFileSync(filePath, backupTmpPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backupTmpPath, mode);
      backupFd = fs.openSync(backupTmpPath, "r");
      fs.fsyncSync(backupFd);
      closeFileDescriptor(backupFd, "backup", false);
      backupFd = null;
      fs.renameSync(backupTmpPath, backupPath);
    }

    phase = "target-rename";
    fs.renameSync(tmpPath, filePath);
    targetReplaced = true;

    phase = "directory-open";
    directoryFd = fs.openSync(
      path.dirname(filePath),
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
    );
    phase = "directory-fsync";
    fs.fsyncSync(directoryFd);
    phase = "directory-close";
    closeFileDescriptor(directoryFd, phase, true);
    directoryFd = null;
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (backupFd !== null) {
      try { fs.closeSync(backupFd); } catch {}
    }
    if (directoryFd !== null) {
      try { fs.closeSync(directoryFd); } catch {}
    }
    try { fs.unlinkSync(tmpPath); } catch {}
    try { fs.unlinkSync(backupTmpPath); } catch {}
    const persistenceError = error instanceof AtomicPersistenceError
      ? error
      : new AtomicPersistenceError(phase, targetReplaced, error);
    console.error(
      `Atomic file persistence failed path=${filePath} phase=${persistenceError.phase} targetReplaced=${persistenceError.targetReplaced}`,
    );
    throw persistenceError;
  }
};
