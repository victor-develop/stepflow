import { describe, it, expect, afterEach } from "vitest";
import {
  createExecution,
  getCliInvocation,
  stopExecution,
  stepDirName,
  buildPromptFromFiles,
} from "../src/executor.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("createExecution", () => {
  it("creates execution state with correct defaults", () => {
    const state = createExecution(
      "Test Task",
      [
        { name: "Step 1", description: "First step" },
        { name: "Step 2", description: "Second step" },
      ],
      "/tmp/test"
    );

    expect(state.taskName).toBe("Test Task");
    expect(state.steps).toHaveLength(2);
    expect(state.currentStep).toBe(0);
    expect(state.status).toBe("idle");
    expect(state.events).toHaveLength(2);
    expect(state.events[0]).toEqual([]);
    expect(state.events[1]).toEqual([]);
    expect(state.childProcess).toBeNull();
  });

  it("assigns correct indices and cwd to steps", () => {
    const state = createExecution(
      "Test",
      [{ name: "A", description: "a" }],
      "/my/dir"
    );

    expect(state.steps[0].index).toBe(0);
    expect(state.steps[0].name).toBe("A");
    expect(state.steps[0].cwd).toBe("/my/dir");
  });
});

describe("getCliInvocation", () => {
  it("returns codex invocation", () => {
    const { command, args } = getCliInvocation("codex", "do something");
    expect(command).toBe("codex");
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("do something");
  });

  it("returns claude invocation", () => {
    const { command, args } = getCliInvocation("claude", "do something");
    expect(command).toBe("claude");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("do something");
  });

  it("returns opencode invocation", () => {
    const { command, args } = getCliInvocation("opencode", "do something");
    expect(command).toBe("opencode");
    expect(args).toContain("run");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args).toContain("do something");
  });
});

describe("stopExecution", () => {
  it("sets status to paused", () => {
    const state = createExecution("Test", [{ name: "A", description: "a" }], "/tmp");
    state.status = "running";
    stopExecution(state);
    expect(state.status).toBe("paused");
    expect(state.childProcess).toBeNull();
  });

  it("handles null childProcess gracefully", () => {
    const state = createExecution("Test", [{ name: "A", description: "a" }], "/tmp");
    state.status = "running";
    state.childProcess = null;
    expect(() => stopExecution(state)).not.toThrow();
    expect(state.status).toBe("paused");
  });
});

describe("stepDirName", () => {
  it("formats index and slugifies name", () => {
    expect(stepDirName(0, "Setup DB")).toBe("step-01-setup-db");
    expect(stepDirName(9, "Final Step")).toBe("step-10-final-step");
    expect(stepDirName(0, "Hello World!")).toBe("step-01-hello-world");
  });

  it("pads single-digit indices", () => {
    expect(stepDirName(0, "a")).toBe("step-01-a");
    expect(stepDirName(8, "b")).toBe("step-09-b");
  });
});

describe("buildPromptFromFiles", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("combines shared prompt and step prompt", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-exec-test-"));
    const sfDir = join(tempDir, ".stepflow");
    const stepDir = join(sfDir, "step-01-init");
    await mkdir(stepDir, { recursive: true });

    await writeFile(join(sfDir, "shared-prompt.md"), "# Shared prompt content", "utf-8");
    await writeFile(join(stepDir, "prompt.md"), "## Step 1 of 1: Init\n\nDo init", "utf-8");

    const steps = [{ index: 0, name: "Init", description: "Do init", cwd: tempDir }];
    const prompt = await buildPromptFromFiles(tempDir, steps, 0);

    expect(prompt).toContain("# Shared prompt content");
    expect(prompt).toContain("## Step 1 of 1: Init");
    expect(prompt).toContain("Do init");
    expect(prompt).not.toContain("Previous Step Result");
  });

  it("includes previous step result when available", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-exec-test-"));
    const sfDir = join(tempDir, ".stepflow");
    const step1Dir = join(sfDir, "step-01-first");
    const step2Dir = join(sfDir, "step-02-second");
    await mkdir(step1Dir, { recursive: true });
    await mkdir(step2Dir, { recursive: true });

    await writeFile(join(sfDir, "shared-prompt.md"), "# Shared", "utf-8");
    await writeFile(join(step1Dir, "prompt.md"), "## Step 1", "utf-8");
    await writeFile(join(step1Dir, "result.md"), "Step 1 completed successfully", "utf-8");
    await writeFile(join(step2Dir, "prompt.md"), "## Step 2", "utf-8");

    const steps = [
      { index: 0, name: "First", description: "First step", cwd: tempDir },
      { index: 1, name: "Second", description: "Second step", cwd: tempDir },
    ];
    const prompt = await buildPromptFromFiles(tempDir, steps, 1);

    expect(prompt).toContain("# Shared");
    expect(prompt).toContain("## Step 2");
    expect(prompt).toContain("## Previous Step Result");
    expect(prompt).toContain("Step 1 completed successfully");
  });

  it("omits previous result section when result.md missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-exec-test-"));
    const sfDir = join(tempDir, ".stepflow");
    const step1Dir = join(sfDir, "step-01-first");
    const step2Dir = join(sfDir, "step-02-second");
    await mkdir(step1Dir, { recursive: true });
    await mkdir(step2Dir, { recursive: true });

    await writeFile(join(sfDir, "shared-prompt.md"), "# Shared", "utf-8");
    await writeFile(join(step1Dir, "prompt.md"), "## Step 1", "utf-8");
    await writeFile(join(step2Dir, "prompt.md"), "## Step 2", "utf-8");

    const steps = [
      { index: 0, name: "First", description: "First step", cwd: tempDir },
      { index: 1, name: "Second", description: "Second step", cwd: tempDir },
    ];
    const prompt = await buildPromptFromFiles(tempDir, steps, 1);

    expect(prompt).toContain("# Shared");
    expect(prompt).toContain("## Step 2");
    expect(prompt).not.toContain("Previous Step Result");
  });
});
