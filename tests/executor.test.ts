import { describe, it, expect } from "vitest";
import {
  createExecution,
  getCliInvocation,
  stopExecution,
} from "../src/executor.js";

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
