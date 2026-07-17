import type { NextApiResponse } from "next";

export type SseClient = { res: NextApiResponse };

export const sseClients: SseClient[] = [];
