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

// Helper: normalizeClaudeEvent now returns arrays
function claudeFirst(record: any): NormalizedEvent {
  return normalizeClaudeEvent(record)[0];
}

describe("normalizeClaudeEvent", () => {
  it("normalizes system init", () => {
    const ev = claudeFirst({ type: "system", subtype: "init", session_id: "s1" });
    expect(ev.family).toBe("session");
    expect(ev.phase).toBe("started");
    expect(ev.sessionId).toBe("s1");
  });

  it("normalizes assistant with message.content text block", () => {
    const evs = normalizeClaudeEvent({
      type: "assistant",
      message: {
        id: "msg_1",
        content: [{ type: "text", text: "Hello!" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      session_id: "s1",
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].family).toBe("message");
    expect(evs[0].actor).toBe("assistant");
    expect(evs[0].text).toBe("Hello!");
    expect(evs[0].usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("expands assistant with multiple content blocks", () => {
    const evs = normalizeClaudeEvent({
      type: "assistant",
      message: {
        id: "msg_2",
        content: [
          { type: "thinking", thinking: "Let me consider..." },
          { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
      session_id: "s1",
    });
    expect(evs).toHaveLength(2);
    expect(evs[0].family).toBe("reasoning");
    expect(evs[0].text).toBe("Let me consider...");
    expect(evs[1].family).toBe("tool");
    expect(evs[1].toolName).toBe("Bash");
    expect(evs[1].input).toEqual({ command: "ls" });
  });

  it("normalizes user with tool_use_result", () => {
    const evs = normalizeClaudeEvent({
      type: "user",
      tool_use_result: { name: "Bash", content: "file.txt", is_error: false },
      session_id: "s1",
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].family).toBe("tool");
    expect(evs[0].phase).toBe("completed");
    expect(evs[0].output).toBe("file.txt");
    expect(evs[0].error).toBeNull();
  });

  it("normalizes user with error tool_use_result", () => {
    const evs = normalizeClaudeEvent({
      type: "user",
      tool_use_result: { name: "Bash", content: "Permission denied", is_error: true },
    });
    expect(evs[0].error).toBe("Permission denied");
  });

  it("normalizes result success with total_cost_usd", () => {
    const ev = claudeFirst({
      type: "result",
      subtype: "success",
      result: "Task done!",
      total_cost_usd: 0.065,
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
    expect(ev.family).toBe("turn");
    expect(ev.phase).toBe("completed");
    expect(ev.text).toBe("Task done!");
    expect(ev.costUsd).toBe(0.065);
  });

  it("normalizes result error", () => {
    const ev = claudeFirst({
      type: "result",
      subtype: "error",
      error: "Something broke",
    });
    expect(ev.family).toBe("turn");
    expect(ev.phase).toBe("failed");
    expect(ev.error).toBe("Something broke");
  });

  it("normalizes rate_limit_event", () => {
    const ev = claudeFirst({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    });
    expect(ev.family).toBe("rate_limit");
  });
});

describe("normalizeClaudeEvent — raw API formats", () => {
  it("normalizes raw message with role", () => {
    const ev = claudeFirst({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from Claude!" }],
    });
    expect(ev.family).toBe("message");
    expect(ev.actor).toBe("assistant");
    expect(ev.text).toBe("Hello from Claude!");
  });

  it("normalizes tool_use content block", () => {
    const ev = claudeFirst({
      type: "tool_use",
      name: "Read",
      input: { path: "/tmp/test.txt" },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("completed");
    expect(ev.toolName).toBe("Read");
  });

  it("normalizes tool_result", () => {
    const ev = claudeFirst({
      type: "tool_result",
      tool_use_id: "tu_123",
      content: "file contents here",
    });
    expect(ev.family).toBe("tool");
    expect(ev.output).toBe("file contents here");
    expect(ev.error).toBeNull();
  });

  it("normalizes tool_result with error", () => {
    const ev = claudeFirst({
      type: "tool_result",
      tool_use_id: "tu_456",
      content: "Permission denied",
      is_error: true,
    });
    expect(ev.family).toBe("tool");
    expect(ev.error).toBe("Permission denied");
  });

  it("normalizes content_block_start with tool_use", () => {
    const ev = claudeFirst({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", name: "Bash", input: {} },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("started");
    expect(ev.toolName).toBe("Bash");
  });

  it("normalizes content_block_start with thinking", () => {
    const ev = claudeFirst({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "Let me think..." },
    });
    expect(ev.family).toBe("reasoning");
    expect(ev.phase).toBe("started");
    expect(ev.text).toBe("Let me think...");
  });

  it("normalizes content_block_delta with text", () => {
    const ev = claudeFirst({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "partial text" },
    });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("updated");
    expect(ev.text).toBe("partial text");
  });

  it("normalizes content_block_delta with input_json", () => {
    const ev = claudeFirst({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"path":' },
    });
    expect(ev.family).toBe("tool");
    expect(ev.phase).toBe("updated");
    expect(ev.input).toBe('{"path":');
  });

  it("normalizes content_block_delta with thinking", () => {
    const ev = claudeFirst({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "more thoughts" },
    });
    expect(ev.family).toBe("reasoning");
    expect(ev.text).toBe("more thoughts");
  });

  it("normalizes message_start", () => {
    const ev = claudeFirst({
      type: "message_start",
      message: { id: "msg_1", role: "assistant", usage: { input_tokens: 10 } },
    });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("started");
    expect(ev.actor).toBe("assistant");
  });

  it("normalizes message_stop", () => {
    const ev = claudeFirst({ type: "message_stop" });
    expect(ev.family).toBe("message");
    expect(ev.phase).toBe("completed");
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

describe("normalizeCliRecord", () => {
  it("routes to codex (returns array)", () => {
    const evs = normalizeCliRecord("codex", { type: "thread.started" });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("codex");
    expect(evs[0].family).toBe("session");
  });

  it("routes to claude (returns array, may expand)", () => {
    const evs = normalizeCliRecord("claude", {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("claude");
    expect(evs[0].family).toBe("message");
    expect(evs[0].text).toBe("hi");
  });

  it("routes to opencode (returns array)", () => {
    const evs = normalizeCliRecord("opencode", { type: "text", text: "hi" });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe("opencode");
    expect(evs[0].family).toBe("message");
  });
});

describe("extractFinalText", () => {
  it("extracts last assistant message", () => {
    const events: NormalizedEvent[] = [
      ...normalizeCliRecord("claude", {
        type: "assistant",
        message: { content: [{ type: "text", text: "First" }] },
      }),
      ...normalizeCliRecord("claude", {
        type: "assistant",
        message: { content: [{ type: "text", text: "Last" }] },
      }),
    ];
    expect(extractFinalText(events)).toBe("Last");
  });

  it("returns null when no text", () => {
    expect(extractFinalText([])).toBeNull();
  });
});

describe("collectCliOutput", () => {
  it("parses and normalizes JSONL", () => {
    const jsonl = '{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}';
    const events = collectCliOutput("claude", jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].family).toBe("session");
    expect(events[1].family).toBe("message");
    expect(events[1].text).toBe("Hi");
  });

  it("expands multi-block assistant into multiple events", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", name: "Bash", id: "tu1", input: { command: "ls" } },
        ],
      },
    });
    const events = collectCliOutput("claude", jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].family).toBe("reasoning");
    expect(events[1].family).toBe("tool");
  });
});

describe("real Claude Code stream-json format", () => {
  it("handles full session: init → assistant → user(tool_result) → result", () => {
    const lines = [
      { type: "system", subtype: "init", session_id: "s1" },
      {
        type: "assistant",
        message: {
          id: "msg_1",
          content: [
            { type: "thinking", thinking: "Let me check" },
            { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "wc -l file.txt" } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
        session_id: "s1",
      },
      {
        type: "user",
        tool_use_result: { name: "Bash", content: "42 file.txt", is_error: false },
        session_id: "s1",
      },
      {
        type: "assistant",
        message: {
          id: "msg_2",
          content: [{ type: "text", text: "The file has 42 lines." }],
          usage: { input_tokens: 200, output_tokens: 10 },
        },
        session_id: "s1",
      },
      {
        type: "result",
        subtype: "success",
        result: "The file has 42 lines.",
        total_cost_usd: 0.045,
        usage: { input_tokens: 300, output_tokens: 30 },
      },
    ];

    const jsonl = lines.map((l) => JSON.stringify(l)).join("\n");
    const events = collectCliOutput("claude", jsonl);

    // init(1) + thinking+tool_use(2) + tool_result(1) + text(1) + result(1) = 6
    expect(events).toHaveLength(6);
    expect(events.map((e) => e.family)).toEqual([
      "session", "reasoning", "tool", "tool", "message", "turn",
    ]);
    expect(events[1].text).toBe("Let me check");
    expect(events[2].toolName).toBe("Bash");
    expect(events[3].output).toBe("42 file.txt");
    expect(events[4].text).toBe("The file has 42 lines.");
    expect(events[5].costUsd).toBe(0.045);
  });
});
