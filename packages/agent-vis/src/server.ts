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

interface StepDef { name: string; description?: string; }

interface StepState {
  steps: StepDef[];
  currentStep: number;           // -1 = not started
  completedSteps: number[];
  erroredSteps: Map<number, string>;
}

export function createVisServer(
  port: number,
  source: CliSource,
  pkgRoot?: string,
  input?: NodeJS.ReadableStream
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
  let startedAt: string | null = null;

  // Step protocol state
  let stepState: StepState | null = null;

  function broadcast(event: NormalizedEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.res.write(payload);
    }
  }

  function broadcastNamedEvent(eventType: string, data: any) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.res.write(payload);
    }
  }

  function broadcastFinish() {
    broadcastNamedEvent("finish", {});
  }

  // Step protocol handler
  function handleStepProtocol(record: any) {
    switch (record.type) {
      case "step:init": {
        stepState = {
          steps: record.steps ?? [],
          currentStep: -1,
          completedSteps: [],
          erroredSteps: new Map(),
        };
        broadcastNamedEvent("step:init", { steps: stepState.steps });
        break;
      }
      case "step:start": {
        if (!stepState) return;
        stepState.currentStep = record.stepIndex ?? 0;
        broadcastNamedEvent("step:start", { stepIndex: stepState.currentStep });
        break;
      }
      case "step:complete": {
        if (!stepState) return;
        const idx = record.stepIndex ?? stepState.currentStep;
        if (!stepState.completedSteps.includes(idx)) {
          stepState.completedSteps.push(idx);
        }
        broadcastNamedEvent("step:complete", { stepIndex: idx });
        break;
      }
      case "step:error": {
        if (!stepState) return;
        const idx = record.stepIndex ?? stepState.currentStep;
        stepState.erroredSteps.set(idx, record.error ?? "Unknown error");
        broadcastNamedEvent("step:error", { stepIndex: idx, error: record.error });
        break;
      }
    }
  }

  // Read stdin and normalize
  const rl = createInterface({ input: input ?? process.stdin });

  rl.on("line", (line) => {
    const record = tryParseJson(line);
    if (!record) return;

    // Step protocol intercept
    if (typeof record.type === "string" && record.type.startsWith("step:")) {
      handleStepProtocol(record);
      return;
    }

    const raw = normalizeCliRecord(source, record);
    const normalized = Array.isArray(raw) ? raw : [raw];
    const now = new Date().toISOString();
    if (!startedAt) startedAt = now;
    for (const event of normalized) {
      (event as any).receivedAt = now;
      if (stepState && stepState.currentStep >= 0) {
        (event as any)._stepIndex = stepState.currentStep;
      }
      events.push(event);
      broadcast(event);
    }
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

    // Replay step state for late-joining clients
    if (stepState) {
      res.write(`event: step:init\ndata: ${JSON.stringify({ steps: stepState.steps })}\n\n`);
      for (const idx of stepState.completedSteps) {
        res.write(`event: step:complete\ndata: ${JSON.stringify({ stepIndex: idx })}\n\n`);
      }
      for (const [idx, error] of stepState.erroredSteps) {
        res.write(`event: step:error\ndata: ${JSON.stringify({ stepIndex: idx, error })}\n\n`);
      }
      if (stepState.currentStep >= 0
        && !stepState.completedSteps.includes(stepState.currentStep)
        && !stepState.erroredSteps.has(stepState.currentStep)) {
        res.write(`event: step:start\ndata: ${JSON.stringify({ stepIndex: stepState.currentStep })}\n\n`);
      }
    }

    // Replay all buffered events
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
      startedAt,
      stepMode: stepState !== null,
      steps: stepState?.steps ?? null,
      currentStep: stepState?.currentStep ?? null,
      completedSteps: stepState?.completedSteps ?? null,
    });
  });

  // SPA fallback
  app.get("/{*splat}", (_req: Request, res: Response) => {
    res.sendFile(join(webDistPath, "index.html"));
  });

  const server = createHttpServer(app);
  return { app, server };
}
