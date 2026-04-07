import express, { type Request, type Response } from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  createExecution,
  executeAll,
  stopExecution,
  stepDirName,
  type ExecutionState,
  type SseEmitter,
} from "./executor.js";
import { generateScript, generatePromptFiles, type TaskInput } from "./script-gen.js";
import type { CliSource } from "./normalizer.js";
import {
  gitStatus,
  gitBranches,
  gitCommit,
  gitCheckout,
  gitDiff,
} from "./git-ops.js";

// ── SSE Client Management ──────────────────────────────────────────

interface SseClient {
  id: number;
  res: Response;
}

let clientIdCounter = 0;
const sseClients: SseClient[] = [];

function addSseClient(res: Response): SseClient {
  const client: SseClient = { id: clientIdCounter++, res };
  sseClients.push(client);
  return client;
}

function removeSseClient(client: SseClient): void {
  const idx = sseClients.findIndex((c) => c.id === client.id);
  if (idx !== -1) sseClients.splice(idx, 1);
}

function broadcastSse(event: { type: string; data: any }): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const client of sseClients) {
    client.res.write(payload);
  }
}

// ── Server Factory ─────────────────────────────────────────────────

export function createServer(
  port: number,
  cwd: string,
  pkgRoot?: string
): { app: express.Express; server: Server } {
  if (!pkgRoot) {
    // Fallback: resolve from this module's location (dist/server.js → package root)
    const __filename = fileURLToPath(import.meta.url);
    pkgRoot = dirname(dirname(__filename));
  }
  const app = express();
  app.use(express.json());

  // Serve static files from web-dist/ (built frontend)
  const webDistPath = join(pkgRoot, "web-dist");
  app.use(express.static(webDistPath));

  // ── Singleton execution state ──
  let currentExecution: ExecutionState | null = null;

  // ── Generated task state (persists between generate and execute) ──
  let generatedTask: {
    taskName: string;
    cliTool: CliSource;
    steps: Array<{ name: string; description: string; dirName: string }>;
  } | null = null;

  const sseEmitter: SseEmitter = (event) => broadcastSse(event);

  // ── API: Generate prompt files ──
  app.post("/api/generate", async (req: Request, res: Response) => {
    try {
      const { name, description, cliTool, steps } = req.body as TaskInput;
      if (!name || !steps?.length) {
        res.status(400).json({ error: "name and steps are required" });
        return;
      }
      const result = await generatePromptFiles(
        { name, description, cliTool, steps },
        cwd
      );

      // Store for later use by /api/execute
      generatedTask = {
        taskName: name,
        cliTool: cliTool ?? "claude",
        steps: result.steps.map((s) => ({
          name: s.name,
          description: steps[s.index].description,
          dirName: s.dirName,
        })),
      };

      res.json({ sharedPromptPath: result.sharedPromptPath, steps: result.steps });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Read all prompt files ──
  app.get("/api/prompts", async (_req: Request, res: Response) => {
    try {
      if (!generatedTask) {
        res.status(400).json({ error: "No generated task. Call /api/generate first." });
        return;
      }
      const sfDir = join(cwd, ".stepflow");
      const sharedPrompt = await readFile(join(sfDir, "shared-prompt.md"), "utf-8");
      const stepsData = await Promise.all(
        generatedTask.steps.map(async (s, i) => {
          const prompt = await readFile(join(sfDir, s.dirName, "prompt.md"), "utf-8");
          return { index: i, name: s.name, dirName: s.dirName, prompt };
        })
      );
      res.json({ sharedPrompt, steps: stepsData });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Save edited prompts ──
  app.put("/api/prompts", async (req: Request, res: Response) => {
    try {
      const { sharedPrompt, steps } = req.body as {
        sharedPrompt: string;
        steps: Array<{ dirName: string; prompt: string }>;
      };
      const sfDir = join(cwd, ".stepflow");
      if (sharedPrompt !== undefined) {
        await writeFile(join(sfDir, "shared-prompt.md"), sharedPrompt, "utf-8");
      }
      if (steps) {
        for (const s of steps) {
          await writeFile(join(sfDir, s.dirName, "prompt.md"), s.prompt, "utf-8");
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Start execution (reads from disk) ──
  app.post("/api/execute", (req: Request, res: Response) => {
    try {
      const { startFrom } = req.body ?? {};

      if (!generatedTask) {
        res.status(400).json({ error: "No generated task. Call /api/generate first." });
        return;
      }

      if (currentExecution?.status === "running") {
        res.status(409).json({ error: "An execution is already running" });
        return;
      }

      currentExecution = createExecution(
        generatedTask.taskName,
        generatedTask.steps,
        cwd
      );

      // Start execution async — don't await
      executeAll(
        currentExecution,
        generatedTask.cliTool,
        sseEmitter,
        cwd,
        startFrom ?? 0
      );

      res.json({ executionId: generatedTask.taskName, status: "running" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Stop execution ──
  app.post("/api/stop", (_req: Request, res: Response) => {
    if (!currentExecution || currentExecution.status !== "running") {
      res.status(400).json({ error: "No running execution" });
      return;
    }
    stopExecution(currentExecution);
    res.json({ status: "paused" });
  });

  // ── API: Resume execution ──
  app.post("/api/resume", (req: Request, res: Response) => {
    const { startFrom } = req.body;
    if (!currentExecution) {
      res.status(400).json({ error: "No execution to resume" });
      return;
    }
    if (currentExecution.status === "running") {
      res.status(409).json({ error: "Execution is already running" });
      return;
    }

    const cliTool = generatedTask?.cliTool ?? "claude";

    currentExecution.status = "running" as const;

    executeAll(
      currentExecution,
      cliTool,
      sseEmitter,
      cwd,
      startFrom ?? currentExecution.currentStep
    );

    res.json({ status: "running", startFrom });
  });

  // ── API: SSE event stream ──
  app.get("/api/events", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const client = addSseClient(res);

    // Send current state as initial event
    if (currentExecution) {
      res.write(
        `event: status\ndata: ${JSON.stringify({
          status: currentExecution.status,
          currentStep: currentExecution.currentStep,
          totalSteps: currentExecution.steps.length,
        })}\n\n`
      );
    }

    _req.on("close", () => {
      removeSseClient(client);
    });
  });

  // ── API: Execution status ──
  app.get("/api/status", (_req: Request, res: Response) => {
    if (!currentExecution) {
      res.json({ status: "idle" });
      return;
    }
    res.json({
      taskName: currentExecution.taskName,
      status: currentExecution.status,
      currentStep: currentExecution.currentStep,
      totalSteps: currentExecution.steps.length,
      steps: currentExecution.steps.map((s) => ({
        index: s.index,
        name: s.name,
      })),
      eventCounts: currentExecution.events.map((e) => e.length),
    });
  });

  // ── API: Git operations ──
  app.get("/api/git/status", async (_req: Request, res: Response) => {
    try {
      const status = await gitStatus(cwd);
      res.json({ status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/git/branches", async (_req: Request, res: Response) => {
    try {
      const result = await gitBranches(cwd);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/git/commit", async (req: Request, res: Response) => {
    try {
      const { message, files } = req.body;
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }
      const result = await gitCommit(cwd, message, files);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/git/checkout", async (req: Request, res: Response) => {
    try {
      const { branch, create } = req.body;
      if (!branch) {
        res.status(400).json({ error: "branch is required" });
        return;
      }
      const result = await gitCheckout(cwd, branch, create);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/git/diff", async (_req: Request, res: Response) => {
    try {
      const diff = await gitDiff(cwd);
      res.json({ diff });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Fallback: serve index.html for SPA routes ──
  app.get("/{*splat}", (_req: Request, res: Response) => {
    res.sendFile(join(webDistPath, "index.html"));
  });

  const server = createHttpServer(app);

  return { app, server };
}
