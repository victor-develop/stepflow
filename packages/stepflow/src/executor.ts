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
} from "@starsea/normalizer";

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

export function stepDirName(index: number, name: string): string {
  const nn = String(index + 1).padStart(2, "0");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `step-${nn}-${slug}`;
}

export async function buildPromptFromFiles(
  baseCwd: string,
  steps: StepConfig[],
  stepIndex: number
): Promise<string> {
  const sfDir = join(baseCwd, ".stepflow");
  const step = steps[stepIndex];
  const dirName = stepDirName(step.index, step.name);

  // Read shared prompt
  const sharedPrompt = await readFile(join(sfDir, "shared-prompt.md"), "utf-8");

  // Read step prompt
  const stepPrompt = await readFile(join(sfDir, dirName, "prompt.md"), "utf-8");

  const parts: string[] = [sharedPrompt, "", stepPrompt];

  // Read previous step's result.md if exists
  if (stepIndex > 0) {
    const prevStep = steps[stepIndex - 1];
    const prevDirName = stepDirName(prevStep.index, prevStep.name);
    try {
      const prevResult = await readFile(
        join(sfDir, prevDirName, "result.md"),
        "utf-8"
      );
      parts.push("");
      parts.push("## Previous Step Result");
      parts.push(prevResult);
    } catch {
      // No previous result available
    }
  }

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

  const prompt = await buildPromptFromFiles(baseCwd, state.steps, stepIndex);

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
        const raw = normalizeCliRecord(cliTool, parsed);
        const events = Array.isArray(raw) ? raw : [raw];
        for (const event of events) {
          state.events[stepIndex].push(event);
          sseEmitter({ type: "step:event", data: { stepIndex, event } });
        }
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
