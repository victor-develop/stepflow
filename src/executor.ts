import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  type CliSource,
  type NormalizedEvent,
  normalizeCliRecord,
  tryParseJson,
  extractFinalText,
} from "./normalizer.js";

// ── Types ──────────────────────────────────────────────────────────

export interface StepConfig {
  index: number;
  name: string;
  description: string;
  cwd: string;
}

export interface ExecutionState {
  taskName: string;
  steps: StepConfig[];
  currentStep: number;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  events: NormalizedEvent[][];
  childProcess: ChildProcess | null;
}

export type SseEmitter = (event: { type: string; data: any }) => void;

// ── CLI Invocation ─────────────────────────────────────────────────

export function getCliInvocation(
  tool: CliSource,
  prompt: string
): { command: string; args: string[] } {
  switch (tool) {
    case "codex":
      return {
        command: "codex",
        args: ["exec", "--json", "--color", "never", prompt],
      };
    case "claude":
      return {
        command: "claude",
        args: [
          "--dangerously-skip-permissions",
          "-p",
          "--verbose",
          "--output-format",
          "stream-json",
          prompt,
        ],
      };
    case "opencode":
      return {
        command: "opencode",
        args: ["run", "--format", "json", prompt],
      };
  }
}

// ── Step Directory Helpers ─────────────────────────────────────────

function stepDirName(index: number, name: string): string {
  const nn = String(index + 1).padStart(2, "0");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `step-${nn}-${slug}`;
}

async function readPreviousResult(
  baseCwd: string,
  steps: StepConfig[],
  stepIndex: number
): Promise<string | null> {
  if (stepIndex === 0) return null;
  const prevStep = steps[stepIndex - 1];
  const prevDir = join(baseCwd, ".stepflow", stepDirName(prevStep.index, prevStep.name));
  try {
    return await readFile(join(prevDir, "result.md"), "utf-8");
  } catch {
    return null;
  }
}

function buildPrompt(
  taskName: string,
  step: StepConfig,
  totalSteps: number,
  previousResult: string | null,
  stepDir: string
): string {
  const parts: string[] = [];

  parts.push(`# Task: ${taskName}`);
  parts.push(`## Step ${step.index + 1} of ${totalSteps}: ${step.name}`);
  parts.push("");
  parts.push(step.description);

  if (previousResult) {
    parts.push("");
    parts.push("## Previous Step Result");
    parts.push(previousResult);
  }

  parts.push("");
  parts.push("## Instructions");
  parts.push(`Work in the directory: ${step.cwd}`);
  parts.push(
    `When you are done, produce a comprehensive result.md file at: ${join(stepDir, "result.md")}`
  );
  parts.push(
    "The result.md should summarize what you did, key decisions, file changes, and any issues encountered (up to 500 lines)."
  );

  return parts.join("\n");
}

// ── Execution ──────────────────────────────────────────────────────

export function createExecution(
  taskName: string,
  steps: Array<{ name: string; description: string }>,
  baseCwd: string
): ExecutionState {
  return {
    taskName,
    steps: steps.map((s, i) => ({
      index: i,
      name: s.name,
      description: s.description,
      cwd: baseCwd,
    })),
    currentStep: 0,
    status: "idle",
    events: steps.map(() => []),
    childProcess: null,
  };
}

export async function executeStep(
  state: ExecutionState,
  stepIndex: number,
  cliTool: CliSource,
  sseEmitter: SseEmitter,
  baseCwd: string
): Promise<void> {
  const step = state.steps[stepIndex];
  if (!step) throw new Error(`Invalid step index: ${stepIndex}`);

  const dirName = stepDirName(step.index, step.name);
  const stepDir = join(baseCwd, ".stepflow", dirName);
  await mkdir(stepDir, { recursive: true });

  const previousResult = await readPreviousResult(baseCwd, state.steps, stepIndex);
  const prompt = buildPrompt(
    state.taskName,
    step,
    state.steps.length,
    previousResult,
    stepDir
  );

  sseEmitter({ type: "step:start", data: { stepIndex, stepName: step.name } });

  const { command, args } = getCliInvocation(cliTool, prompt);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: step.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    state.childProcess = child;
    state.currentStep = stepIndex;

    const rl = createInterface({ input: child.stdout! });

    rl.on("line", (line) => {
      const parsed = tryParseJson(line);
      if (parsed) {
        const event = normalizeCliRecord(cliTool, parsed);
        state.events[stepIndex].push(event);
        sseEmitter({ type: "step:event", data: { stepIndex, event } });
      }
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      state.childProcess = null;

      if (code === 0 || code === null) {
        sseEmitter({
          type: "step:complete",
          data: { stepIndex, stepName: step.name },
        });
        resolve();
      } else {
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        sseEmitter({
          type: "step:error",
          data: { stepIndex, error: errorMsg },
        });
        reject(new Error(errorMsg));
      }
    });

    child.on("error", (err) => {
      state.childProcess = null;
      sseEmitter({
        type: "step:error",
        data: { stepIndex, error: err.message },
      });
      reject(err);
    });
  });
}

export async function executeAll(
  state: ExecutionState,
  cliTool: CliSource,
  sseEmitter: SseEmitter,
  baseCwd: string,
  startFrom: number = 0
): Promise<void> {
  state.status = "running";

  try {
    for (let i = startFrom; i < state.steps.length; i++) {
      if (state.status !== "running") break;
      await executeStep(state, i, cliTool, sseEmitter, baseCwd);
    }

    if (state.status === "running") {
      state.status = "completed";
      sseEmitter({ type: "execution:complete", data: {} });
    }
  } catch (err: any) {
    state.status = "failed";
    sseEmitter({
      type: "execution:error",
      data: { error: err.message ?? String(err) },
    });
  }
}

export function stopExecution(state: ExecutionState): void {
  if (state.childProcess) {
    state.childProcess.kill("SIGTERM");
    state.childProcess = null;
  }
  state.status = "paused";
}
