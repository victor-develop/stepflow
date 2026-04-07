import { describe, it, expect } from "vitest";
import {
  tryParseJson,
  parseJsonl,
  normalizeCliRecord,
  normalizeCodexEvent,
  normalizeClaudeEvent,
  normalizeOpencodeEvent,
  collectCliOutput,
  extractFinalText,
  type NormalizedEvent,
} from "../src/index.js";

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
    expect(tryParseJson("[1,2,3]")).toBeNull();
  });
});

describe("parseJsonl", () => {
  it("parses multiple lines", () => {
    const text = '{"a":1}\n{"b":2}\nnot json\n{"c":3}';
    const result = parseJsonl(text);
    expect(result).toHaveLength(3);
  });
});

describe("normalizeCodexEvent", () => {
  it("normalizes thread.started", () => {
    const ev = normalizeCodexEvent({
      type: "thread.started",
      thread: { id: "t1" },
    });
    expect(ev.family).toBe("session");
    expect(ev.phase).toBe("started");
    expect(ev.sessionId).toBe("t1");
    expect(ev.source).toBe("codex");
  });

  it("normalizes turn.completed", () => {
    const ev = normalizeCodexEvent({
      type: "turn.completed",
      usage: { tokens: 100 },
      cost_usd: 0.01,
    });
    expect(ev.family).toBe("turn");
    expect(ev.phase).toBe("completed");
    expect(ev.costUsd).toBe(0.01);
  });

  it("normalizes item with agent_message", () => {
    const ev = normalizeCodexEvent({
      type: "item.completed",
      item: { type: "agent_message", id: "m1", content: "hello" },
    });
    expect(ev.family).toBe("message");
    expect(ev.text).toBe("hello");
  });

  it("normalizes item with command_execution", () => {
    const ev = normalizeCodexEvent({
      type: "item.completed",
      item: { type: "command_execution", id: "c1", command: "ls", output: "file.txt", exit_code: 0 },
    });
    expect(ev.family).toBe("tool");
    expect(ev.command).toBe("ls");
    expect(ev.exitCode).toBe(0);
  });
});

describe("normalizeClaudeEvent", () => {
  it("normalizes system init", () => {
    const ev = normalizeClaudeEvent({
      type: "system",
      subtype: "init",
      session_id: "s1",
    });
    expect(ev.family).toBe("session");
    expect(ev.phase).toBe("started");
    expect(ev.sessionId).toBe("s1");
  });

  it("normalizes assistant message", () => {
    const ev = normalizeClaudeEvent({
      type: "assistant",
      text: "Hello!",
      message_id: "m1",
    });
    expect(ev.family).toBe("message");
    expect(ev.actor).toBe("assistant");
    expect(ev.text).toBe("Hello!");
  });

  it("normalizes result error", () => {
    const ev = normalizeClaudeEvent({
      type: "result",
      subtype: "error",
      error: "Something broke",
    });
    expect(ev.family).toBe("turn");
    expect(ev.phase).toBe("failed");
    expect(ev.error).toBe("Something broke");
  });
});

describe("normalizeOpencodeEvent", () => {
  it("normalizes text", () => {
    const ev = normalizeOpencodeEvent({ type: "text", text: "Hi" });
    expect(ev.family).toBe("message");
    expect(ev.text).toBe("Hi");
  });

  it("normalizes tool_use", () => {
    const ev = normalizeOpencodeEvent({
      type: "tool_use",
      tool_name: "bash",
      input: "ls",
      output: "file.txt",
    });
    expect(ev.family).toBe("tool");
    expect(ev.toolName).toBe("bash");
  });
});

describe("normalizeClaudeEvent — raw API formats", () => {
  it("normalizes raw message with role", () => {
    const ev = normalizeClaudeEvent({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from Claude!" }],
    });
    expect(ev.family).toBe("message");
    expect(ev.actor).toBe("assistant");
    expect(ev.text).toBe("Hello from Claude!");
  });

  it("normalizes tool_use content block", () => {
    const ev = normalizeClaudeEvent({
      type: "tool_use",
      name: "Read",
      input: { path: "/tmp/test.txt" },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("completed");
    expect(ev.toolName).toBe("Read");
  });

  it("normalizes tool_result", () => {
    const ev = normalizeClaudeEvent({
      type: "tool_result",
      tool_use_id: "tu_123",
      content: "file contents here",
    });
    expect(ev.family).toBe("tool");
    expect(ev.output).toBe("file contents here");
    expect(ev.error).toBeNull();
  });

  it("normalizes tool_result with error", () => {
    const ev = normalizeClaudeEvent({
      type: "tool_result",
      tool_use_id: "tu_456",
      content: "Permission denied",
      is_error: true,
    });
    expect(ev.family).toBe("tool");
    expect(ev.error).toBe("Permission denied");
  });

  it("normalizes content_block_start with tool_use", () => {
    const ev = normalizeClaudeEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", name: "Bash", input: {} },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("started");
    expect(ev.toolName).toBe("Bash");
  });

  it("normalizes content_block_start with thinking", () => {
    const ev = normalizeClaudeEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "Let me think..." },
    });
    expect(ev.family).toBe("reasoning");
    expect(ev.phase).toBe("started");
    expect(ev.text).toBe("Let me think...");
  });

  it("normalizes content_block_delta with text", () => {
    const ev = normalizeClaudeEvent({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "partial text" },
    });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("updated");
    expect(ev.text).toBe("partial text");
  });

  it("normalizes content_block_delta with input_json", () => {
    const ev = normalizeClaudeEvent({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"path":' },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("updated");
    expect(ev.input).toBe('{"path":');
  });

  it("normalizes content_block_delta with thinking", () => {
    const ev = normalizeClaudeEvent({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "more thoughts" },
    });
    expect(ev.family).toBe("reasoning");
    expect(ev.text).toBe("more thoughts");
  });

  it("normalizes message_start", () => {
    const ev = normalizeClaudeEvent({
      type: "message_start",
      message: { id: "msg_1", role: "assistant", usage: { input_tokens: 10 } },
    });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("started");
    expect(ev.actor).toBe("assistant");
  });

  it("normalizes message_stop", () => {
    const ev = normalizeClaudeEvent({ type: "message_stop" });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("completed");
  });
});

describe("normalizeCliRecord", () => {
  it("routes to codex", () => {
    const ev = normalizeCliRecord("codex", { type: "thread.started" });
    expect(ev.source).toBe("codex");
    expect(ev.family).toBe("session");
  });

  it("routes to claude", () => {
    const ev = normalizeCliRecord("claude", { type: "assistant", text: "hi" });
    expect(ev.source).toBe("claude");
    expect(ev.family).toBe("message");
  });

  it("routes to opencode", () => {
    const ev = normalizeCliRecord("opencode", { type: "text", text: "hi" });
    expect(ev.source).toBe("opencode");
    expect(ev.family).toBe("message");
  });
});

describe("extractFinalText", () => {
  it("extracts last assistant message", () => {
    const events: NormalizedEvent[] = [
      normalizeCliRecord("claude", { type: "assistant", text: "First" }),
      normalizeCliRecord("claude", { type: "assistant", text: "Last" }),
    ];
    expect(extractFinalText(events)).toBe("Last");
  });

  it("returns null when no text", () => {
    expect(extractFinalText([])).toBeNull();
  });
});

describe("collectCliOutput", () => {
  it("parses and normalizes JSONL", () => {
    const jsonl = '{"type":"system","subtype":"init"}\n{"type":"assistant","text":"Hi"}';
    const events = collectCliOutput("claude", jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].family).toBe("session");
    expect(events[1].family).toBe("message");
  });
});
