import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false,
  },
};

function getPath(req: NextApiRequest): string {
  const parts = req.query.path;
  if (Array.isArray(parts)) {
    return parts.map(encodeURIComponent).join("/");
  }
  return typeof parts === "string" ? encodeURIComponent(parts) : "";
}

function getTargetBase(): string {
  return (
    process.env.DEIPHOBE_SPEECH_ORCHESTRATOR_URL ||
    process.env.NEXT_PUBLIC_DEIPHOBE_SPEECH_ORCHESTRATOR_URL ||
    "http://127.0.0.1:8767"
  ).replace(/\/+$/, "");
}

async function readBody(req: NextApiRequest): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method || "GET";
  const targetUrl = new URL(`${getTargetBase()}/${getPath(req)}`);
  const queryIndex = req.url?.indexOf("?");
  if (queryIndex !== undefined && queryIndex >= 0) {
    targetUrl.search = req.url!.slice(queryIndex);
  }

  try {
    const body = await readBody(req);
    const upstream = await fetch(targetUrl, {
      method,
      headers: {
        ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}),
        ...(req.headers.accept ? { accept: String(req.headers.accept) } : {}),
      },
      body,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (["connection", "content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
        return;
      }
      res.setHeader(key, value);
    });

    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(502).json({
      error: "Deiphobe speech proxy failed",
      detail: error instanceof Error ? error.message : String(error),
      target: targetUrl.origin,
    });
  }
}
