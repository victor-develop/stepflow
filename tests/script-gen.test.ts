import { describe, it, expect } from "vitest";
import { generateScript, type TaskInput } from "../src/script-gen.js";

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
