import express, { type Request, type Response } from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import {
  type CliSource,
  type NormalizedEvent,
  normalizeCliRecord,
  tryParseJson,
} from "@starsea/normalizer";

interface SseClient { id: number; res: Response; }

export function createVisServer(
  port: number,
  source: CliSource,
  pkgRoot?: string
): { app: express.Express; server: Server } {
  if (!pkgRoot) {
    const __filename = fileURLToPath(import.meta.url);
    pkgRoot = dirname(dirname(__filename));
  }

  const app = express();
  const webDistPath = join(pkgRoot, "web-dist");
  app.use(express.static(webDistPath));

  // Event buffer and SSE
  const events: NormalizedEvent[] = [];
  let clientIdCounter = 0;
  const sseClients: SseClient[] = [];
  let finished = false;

  function broadcast(event: NormalizedEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.res.write(payload);
    }
  }

  function broadcastFinish() {
    const payload = `event: finish\ndata: {}\n\n`;
    for (const client of sseClients) {
      client.res.write(payload);
    }
  }

  // Read stdin and normalize
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const record = tryParseJson(line);
    if (!record) return;
    const event = normalizeCliRecord(source, record);
    events.push(event);
    broadcast(event);
  });
  rl.on("close", () => {
    finished = true;
    broadcastFinish();
  });

  // API: SSE event stream
  app.get("/api/events", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send all buffered events first (replay)
    for (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (finished) {
      res.write(`event: finish\ndata: {}\n\n`);
    }

    const client: SseClient = { id: clientIdCounter++, res };
    sseClients.push(client);

    _req.on("close", () => {
      const idx = sseClients.findIndex((c) => c.id === client.id);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  // API: Get current state
  app.get("/api/state", (_req: Request, res: Response) => {
    res.json({
      source,
      eventCount: events.length,
      finished,
    });
  });

  // SPA fallback
  app.get("/{*splat}", (_req: Request, res: Response) => {
    res.sendFile(join(webDistPath, "index.html"));
  });

  const server = createHttpServer(app);
  return { app, server };
}
