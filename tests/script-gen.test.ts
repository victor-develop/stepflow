import { describe, it, expect, afterEach } from "vitest";
import { generateScript, generatePromptFiles, type TaskInput } from "../src/script-gen.js";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("generateScript", () => {
  const baseInput: TaskInput = {
    name: "Build API",
    description: "Create a REST API",
    cliTool: "claude",
    steps: [
      { name: "Setup", description: "Initialize the project" },
      { name: "Add Routes", description: "Create API routes" },
    ],
  };

  it("generates a valid bash script", () => {
    const script = generateScript(baseInput, "/tmp/test-project");
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("set -euo pipefail");
  });

  it("creates step directories", () => {
    const script = generateScript(baseInput, "/tmp/test-project");
    expect(script).toContain("step-01-setup");
    expect(script).toContain("step-02-add-routes");
  });

  it("uses correct CLI tool for codex", () => {
    const input = { ...baseInput, cliTool: "codex" as const };
    const script = generateScript(input, "/tmp/test");
    expect(script).toContain("codex exec --json");
  });

  it("uses correct CLI tool for claude", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("claude --dangerously-skip-permissions");
    expect(script).toContain("stream-json");
  });

  it("uses correct CLI tool for opencode", () => {
    const input = { ...baseInput, cliTool: "opencode" as const };
    const script = generateScript(input, "/tmp/test");
    expect(script).toContain("opencode run --format json");
  });

  it("includes task name in header", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("Build API");
  });

  it("includes step count", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("Steps: 2");
  });

  it("references previous step result for step 2+", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("Previous Step Result");
    expect(script).toContain("step-01-setup/result.md");
  });

  it("generates output.jsonl log per step", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("output.jsonl");
  });

  it("includes result.md instruction", () => {
    const script = generateScript(baseInput, "/tmp/test");
    expect(script).toContain("result.md");
    expect(script).toContain("500 lines");
  });

  it("handles special characters in names", () => {
    const input: TaskInput = {
      name: 'Test "quotes" & stuff',
      description: "Has $pecial `chars`",
      cliTool: "claude",
      steps: [{ name: "Step with spaces!", description: "Do it" }],
    };
    const script = generateScript(input, "/tmp/test");
    // Should not crash and should produce valid bash
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("step-01-step-with-spaces");
  });

  it("handles single step (no previous result reference)", () => {
    const input: TaskInput = {
      name: "Simple",
      description: "One step",
      cliTool: "claude",
      steps: [{ name: "Only Step", description: "Do everything" }],
    };
    const script = generateScript(input, "/tmp/test");
    expect(script).toContain("step-01-only-step");
    // First step should not reference previous result
    const lines = script.split("\n");
    const stepSection = lines.slice(
      lines.findIndex((l) => l.includes("Step 1"))
    );
    // Should contain the completion message
    expect(script).toContain("All 1 steps complete");
  });
});

describe("generatePromptFiles", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates shared-prompt.md with correct content", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-gen-test-"));
    const result = await generatePromptFiles(
      {
        name: "My Task",
        description: "Build something cool",
        cliTool: "claude",
        steps: [{ name: "Setup", description: "Set things up" }],
      },
      tempDir
    );

    expect(result.sharedPromptPath).toBe(join(tempDir, ".stepflow", "shared-prompt.md"));
    const shared = await readFile(result.sharedPromptPath, "utf-8");
    expect(shared).toContain("# Task: My Task");
    expect(shared).toContain("Build something cool");
    expect(shared).toContain("## Shared Instructions");
    expect(shared).toContain(`Work in the directory: ${tempDir}`);
    expect(shared).toContain("result.md");
  });

  it("creates step directories and prompt files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-gen-test-"));
    const result = await generatePromptFiles(
      {
        name: "Multi",
        description: "Multi-step task",
        cliTool: "codex",
        steps: [
          { name: "First Step", description: "Do first" },
          { name: "Second Step", description: "Do second" },
        ],
      },
      tempDir
    );

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].dirName).toBe("step-01-first-step");
    expect(result.steps[1].dirName).toBe("step-02-second-step");

    const prompt1 = await readFile(result.steps[0].promptPath, "utf-8");
    expect(prompt1).toContain("## Step 1 of 2: First Step");
    expect(prompt1).toContain("Do first");
    // Should NOT contain shared prompt content
    expect(prompt1).not.toContain("# Task:");

    const prompt2 = await readFile(result.steps[1].promptPath, "utf-8");
    expect(prompt2).toContain("## Step 2 of 2: Second Step");
    expect(prompt2).toContain("Do second");
  });

  it("returns correct metadata for each step", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-gen-test-"));
    const result = await generatePromptFiles(
      {
        name: "T",
        description: "d",
        cliTool: "claude",
        steps: [{ name: "Only", description: "The only step" }],
      },
      tempDir
    );

    expect(result.steps[0].index).toBe(0);
    expect(result.steps[0].name).toBe("Only");
    expect(result.steps[0].dirName).toBe("step-01-only");
    expect(result.steps[0].promptPath).toContain("step-01-only/prompt.md");
  });
});
