import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CliSource } from "@starsea/normalizer";

// ── Types ──────────────────────────────────────────────────────────

export interface TaskInput {
  name: string;
  description: string;
  cliTool: CliSource;
  steps: Array<{ name: string; description: string }>;
}

export interface GeneratedPrompts {
  sharedPromptPath: string;
  steps: Array<{
    index: number;
    name: string;
    dirName: string;
    promptPath: string;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function stepDirName(index: number, name: string): string {
  const nn = String(index + 1).padStart(2, "0");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `step-${nn}-${slug}`;
}

function cliCommand(tool: CliSource, promptVar: string): string {
  switch (tool) {
    case "codex":
      return `codex exec --json --color never "$${promptVar}"`;
    case "claude":
      return `claude --dangerously-skip-permissions -p --verbose --output-format stream-json "$${promptVar}"`;
    case "opencode":
      return `opencode run --format json "$${promptVar}"`;
  }
}

// ── Generator ──────────────────────────────────────────────────────

export function generateScript(input: TaskInput, baseCwd: string): string {
  const lines: string[] = [];

  lines.push("#!/usr/bin/env bash");
  lines.push("set -euo pipefail");
  lines.push("");
  lines.push(`# StepFlow generated script: ${input.name}`);
  lines.push(`# CLI tool: ${input.cliTool}`);
  lines.push(`# Steps: ${input.steps.length}`);
  lines.push("");
  lines.push(`BASE_DIR=${shellEscape(baseCwd)}`);
  lines.push(`STEPFLOW_DIR="$BASE_DIR/.stepflow"`);
  lines.push(`mkdir -p "$STEPFLOW_DIR"`);
  lines.push("");

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    const dirName = stepDirName(i, step.name);
    const stepNum = i + 1;

    lines.push(`# ── Step ${stepNum}: ${step.name} ──`);
    lines.push("");
    lines.push(`STEP_DIR="$STEPFLOW_DIR/${dirName}"`);
    lines.push(`mkdir -p "$STEP_DIR"`);
    lines.push(`echo "▶ Step ${stepNum}/${input.steps.length}: ${step.name}"`);
    lines.push("");

    // Build the prompt
    lines.push(`PROMPT="# Task: ${escapeForDoubleQuote(input.name)}`);
    lines.push(`## Step ${stepNum} of ${input.steps.length}: ${escapeForDoubleQuote(step.name)}`);
    lines.push("");
    lines.push(escapeForDoubleQuote(step.description));

    if (i > 0) {
      const prevDirName = stepDirName(i - 1, input.steps[i - 1].name);
      lines.push("");
      lines.push("## Previous Step Result");
      // Inline previous result.md if it exists
      lines.push('$(cat "$STEPFLOW_DIR/' + prevDirName + '/result.md" 2>/dev/null || echo "No previous result available.")');
    }

    lines.push("");
    lines.push("## Instructions");
    lines.push('Work in the directory: $BASE_DIR');
    lines.push('When you are done, produce a comprehensive result.md file at: $STEP_DIR/result.md');
    lines.push(
      'The result.md should summarize what you did, key decisions, file changes, and any issues encountered (up to 500 lines)."'
    );
    lines.push("");

    const cmd = cliCommand(input.cliTool, "PROMPT");
    lines.push(`${cmd} > "$STEP_DIR/output.jsonl" 2>&1`);
    lines.push("");
    lines.push(`echo "✓ Step ${stepNum} complete"`);
    lines.push("");
  }

  lines.push(`echo "✓ All ${input.steps.length} steps complete"`);

  return lines.join("\n") + "\n";
}

function escapeForDoubleQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

// ── Prompt File Generator ─────────────────────────────────────────

export async function generatePromptFiles(
  input: TaskInput,
  baseCwd: string
): Promise<GeneratedPrompts> {
  const sfDir = join(baseCwd, ".stepflow");
  await mkdir(sfDir, { recursive: true });

  // Write shared prompt
  const sharedPromptPath = join(sfDir, "shared-prompt.md");
  const sharedContent = [
    `# Task: ${input.name}`,
    "",
    input.description,
    "",
    "## Shared Instructions",
    "",
    `Work in the directory: ${baseCwd}`,
    "When you are done with your step, produce a comprehensive result.md file in your step directory.",
    "The result.md should summarize what you did, key decisions, file changes, and any issues encountered (up to 500 lines).",
  ].join("\n");
  await writeFile(sharedPromptPath, sharedContent, "utf-8");

  // Write per-step prompts
  const totalSteps = input.steps.length;
  const stepsResult: GeneratedPrompts["steps"] = [];

  for (let i = 0; i < totalSteps; i++) {
    const step = input.steps[i];
    const dirName = stepDirName(i, step.name);
    const stepDir = join(sfDir, dirName);
    await mkdir(stepDir, { recursive: true });

    const promptPath = join(stepDir, "prompt.md");
    const promptContent = [
      `## Step ${i + 1} of ${totalSteps}: ${step.name}`,
      "",
      step.description,
    ].join("\n");
    await writeFile(promptPath, promptContent, "utf-8");

    stepsResult.push({
      index: i,
      name: step.name,
      dirName,
      promptPath,
    });
  }

  return { sharedPromptPath, steps: stepsResult };
}
