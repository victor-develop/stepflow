import { describe, it, expect } from "vitest";
import {
  tryParseJson,
  parseJsonl,
  normalizeCodexEvent,
  normalizeClaudeEvent,
  normalizeOpencodeEvent,
  normalizeCliRecord,
  extractFinalText,
  collectCliOutput,
} from "../src/normalizer.js";

// ── tryParseJson ──────────────────────────────────────────────────

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"type":"test"}')).toEqual({ type: "test" });
  });

  it("returns null for invalid JSON", () => {
    expect(tryParseJson("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(tryParseJson("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(tryParseJson('"just a string"')).toBeNull();
  });
});

// ── parseJsonl ────────────────────────────────────────────────────

describe("parseJsonl", () => {
  it("parses multiple lines", () => {
    const input = '{"a":1}\n{"b":2}\n';
    const result = parseJsonl(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ a: 1 });
    expect(result[1]).toEqual({ b: 2 });
  });

  it("skips invalid lines", () => {
    const input = '{"a":1}\nbad line\n{"b":2}';
    const result = parseJsonl(input);
    expect(result).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(parseJsonl("")).toHaveLength(0);
  });
});

// ── Codex Normalizer ──────────────────────────────────────────────

describe("normalizeCodexEvent", () => {
  it("normalizes thread.started", () => {
    const event = normalizeCodexEvent({
      type: "thread.started",
      thread: { id: "t1" },
    });
    expect(event.family).toBe("session");
    expect(event.phase).toBe("started");
    expect(event.source).toBe("codex");
    expect(event.sessionId).toBe("t1");
  });

  it("normalizes turn.started", () => {
    const event = normalizeCodexEvent({ type: "turn.started" });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("started");
  });

  it("normalizes turn.completed with usage", () => {
    const event = normalizeCodexEvent({
      type: "turn.completed",
      usage: { total_tokens: 100 },
    });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("completed");
    expect(event.usage).toEqual({ total_tokens: 100 });
  });

  it("normalizes turn.failed", () => {
    const event = normalizeCodexEvent({ type: "turn.failed" });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("failed");
  });

  it("normalizes agent_message item", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "msg1",
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    expect(event.family).toBe("message");
    expect(event.phase).toBe("completed");
    expect(event.actor).toBe("assistant");
    expect(event.text).toBe("Hello world");
    expect(event.itemId).toBe("msg1");
  });

  it("normalizes reasoning item", () => {
    const event = normalizeCodexEvent({
      type: "item.updated",
      item: { type: "reasoning", id: "r1", text: "thinking..." },
    });
    expect(event.family).toBe("reasoning");
    expect(event.text).toBe("thinking...");
  });

  it("normalizes command_execution item", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        id: "cmd1",
        command: "ls -la",
        output: "file1\nfile2",
        exit_code: 0,
      },
    });
    expect(event.family).toBe("tool");
    expect(event.toolKind).toBe("command");
    expect(event.command).toBe("ls -la");
    expect(event.output).toBe("file1\nfile2");
    expect(event.exitCode).toBe(0);
  });

  it("normalizes file_change item", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: {
        type: "file_change",
        id: "fc1",
        changes: [{ path: "test.ts", action: "create" }],
      },
    });
    expect(event.family).toBe("file");
    expect(event.fileChanges).toEqual([{ path: "test.ts", action: "create" }]);
  });

  it("normalizes todo_list item", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: {
        type: "todo_list",
        id: "td1",
        items: ["task1", "task2"],
      },
    });
    expect(event.family).toBe("plan");
    expect(event.plan).toEqual(["task1", "task2"]);
  });

  it("normalizes error item", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: { type: "error", id: "e1", message: "something broke" },
    });
    expect(event.family).toBe("error");
    expect(event.phase).toBe("failed");
    expect(event.error).toBe("something broke");
  });

  it("normalizes mcp_tool_call", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: {
        type: "mcp_tool_call",
        id: "mcp1",
        tool_name: "search",
        arguments: { q: "test" },
        output: "results",
      },
    });
    expect(event.family).toBe("tool");
    expect(event.toolKind).toBe("mcp");
    expect(event.toolName).toBe("search");
  });

  it("normalizes unknown item type as meta", () => {
    const event = normalizeCodexEvent({
      type: "item.completed",
      item: { type: "future_type", id: "x" },
    });
    expect(event.family).toBe("meta");
  });

  it("handles unknown top-level type", () => {
    const event = normalizeCodexEvent({ type: "something_new" });
    expect(event.family).toBe("meta");
  });
});

// ── Claude Normalizer ─────────────────────────────────────────────

// Helper: normalizeClaudeEvent now returns arrays
function claudeFirst(record: any) {
  return normalizeClaudeEvent(record)[0];
}

describe("normalizeClaudeEvent", () => {
  it("normalizes system.init", () => {
    const event = claudeFirst({ type: "system", subtype: "init", session_id: "s1" });
    expect(event.family).toBe("session");
    expect(event.phase).toBe("started");
    expect(event.sessionId).toBe("s1");
  });

  it("normalizes system.compact_boundary", () => {
    const event = claudeFirst({ type: "system", subtype: "compact_boundary" });
    expect(event.family).toBe("session");
    expect(event.phase).toBe("updated");
  });

  it("normalizes system.status", () => {
    const event = claudeFirst({ type: "system", subtype: "status", message: "Processing..." });
    expect(event.family).toBe("status");
    expect(event.status).toBe("Processing...");
  });

  it("normalizes system.task_started", () => {
    const event = claudeFirst({ type: "system", subtype: "task_started" });
    expect(event.family).toBe("task");
    expect(event.phase).toBe("started");
  });

  it("normalizes assistant with message.content", () => {
    const evs = normalizeClaudeEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello!" }], usage: { input_tokens: 10 } },
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].family).toBe("message");
    expect(evs[0].actor).toBe("assistant");
    expect(evs[0].text).toBe("Hello!");
  });

  it("expands assistant with multiple content blocks", () => {
    const evs = normalizeClaudeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    expect(evs).toHaveLength(2);
    expect(evs[0].family).toBe("reasoning");
    expect(evs[1].family).toBe("tool");
    expect(evs[1].toolName).toBe("Bash");
  });

  it("normalizes user with tool_use_result", () => {
    const evs = normalizeClaudeEvent({
      type: "user",
      tool_use_result: { name: "Bash", content: "output", is_error: false },
    });
    expect(evs[0].family).toBe("tool");
    expect(evs[0].output).toBe("output");
  });

  it("normalizes result success", () => {
    const event = claudeFirst({
      type: "result",
      subtype: "success",
      result: "Done",
      total_cost_usd: 0.05,
      usage: { total_tokens: 50 },
    });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("completed");
    expect(event.text).toBe("Done");
    expect(event.costUsd).toBe(0.05);
  });

  it("normalizes result error", () => {
    const event = claudeFirst({ type: "result", subtype: "error", error: "Failed" });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("failed");
    expect(event.error).toBe("Failed");
  });

  it("normalizes rate_limit_event", () => {
    const event = claudeFirst({ type: "rate_limit_event", message: "Rate limited" });
    expect(event.family).toBe("rate_limit");
  });

  it("normalizes tool_progress", () => {
    const event = claudeFirst({ type: "tool_progress", tool_name: "Bash", content: "running..." });
    expect(event.family).toBe("tool");
    expect(event.toolName).toBe("Bash");
  });

  it("normalizes streamlined_text", () => {
    const event = claudeFirst({ type: "streamlined_text", text: "partial output" });
    expect(event.family).toBe("stream");
    expect(event.text).toBe("partial output");
  });

  it("normalizes tool_use_summary", () => {
    const event = claudeFirst({ type: "tool_use_summary", tool_name: "Read", output: "file content" });
    expect(event.family).toBe("tool");
    expect(event.phase).toBe("completed");
  });

  it("normalizes auth_status", () => {
    const event = claudeFirst({ type: "auth_status", status: "authenticated" });
    expect(event.family).toBe("status");
  });

  it("normalizes unknown type as meta", () => {
    const event = claudeFirst({ type: "future_event" });
    expect(event.family).toBe("meta");
  });
});

// ── OpenCode Normalizer ───────────────────────────────────────────

describe("normalizeOpencodeEvent", () => {
  it("normalizes step_start", () => {
    const event = normalizeOpencodeEvent({
      type: "step_start",
      session_id: "s1",
    });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("started");
  });

  it("normalizes text", () => {
    const event = normalizeOpencodeEvent({
      type: "text",
      text: "response",
    });
    expect(event.family).toBe("message");
    expect(event.actor).toBe("assistant");
    expect(event.text).toBe("response");
  });

  it("normalizes reasoning", () => {
    const event = normalizeOpencodeEvent({
      type: "reasoning",
      text: "thinking",
    });
    expect(event.family).toBe("reasoning");
    expect(event.text).toBe("thinking");
  });

  it("normalizes tool_use", () => {
    const event = normalizeOpencodeEvent({
      type: "tool_use",
      tool_name: "exec",
      input: "ls",
      output: "files",
    });
    expect(event.family).toBe("tool");
    expect(event.toolName).toBe("exec");
  });

  it("normalizes step_finish", () => {
    const event = normalizeOpencodeEvent({
      type: "step_finish",
      usage: { total: 100 },
    });
    expect(event.family).toBe("turn");
    expect(event.phase).toBe("completed");
  });

  it("normalizes unknown type as meta", () => {
    const event = normalizeOpencodeEvent({ type: "something" });
    expect(event.family).toBe("meta");
  });
});

// ── normalizeCliRecord ────────────────────────────────────────────

describe("normalizeCliRecord", () => {
  it("routes to codex normalizer (returns array)", () => {
    const evs = normalizeCliRecord("codex", { type: "turn.started" });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("codex");
    expect(evs[0].family).toBe("turn");
  });

  it("routes to claude normalizer (returns array)", () => {
    const evs = normalizeCliRecord("claude", {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("claude");
    expect(evs[0].family).toBe("message");
  });

  it("routes to opencode normalizer (returns array)", () => {
    const evs = normalizeCliRecord("opencode", { type: "text", text: "hi" });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("opencode");
    expect(evs[0].family).toBe("message");
  });
});

// ── extractFinalText ──────────────────────────────────────────────

describe("extractFinalText", () => {
  it("extracts last assistant message", () => {
    const events = [
      ...normalizeCliRecord("claude", {
        type: "assistant",
        message: { content: [{ type: "text", text: "first" }] },
      }),
      ...normalizeCliRecord("claude", {
        type: "assistant",
        message: { content: [{ type: "text", text: "second" }] },
      }),
    ];
    expect(extractFinalText(events)).toBe("second");
  });

  it("falls back to turn completed text", () => {
    const events = [
      ...normalizeCliRecord("claude", {
        type: "result",
        subtype: "success",
        result: "done",
      }),
    ];
    expect(extractFinalText(events)).toBe("done");
  });

  it("returns null for empty events", () => {
    expect(extractFinalText([])).toBeNull();
  });
});

// ── collectCliOutput ──────────────────────────────────────────────

describe("collectCliOutput", () => {
  it("parses JSONL and normalizes events", () => {
    const jsonl = [
      '{"type":"system","subtype":"init","session_id":"s1"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"result","subtype":"success","result":"Done"}',
    ].join("\n");

    const events = collectCliOutput("claude", jsonl);
    expect(events).toHaveLength(3);
    expect(events[0].family).toBe("session");
    expect(events[1].family).toBe("message");
    expect(events[2].family).toBe("turn");
  });
});
