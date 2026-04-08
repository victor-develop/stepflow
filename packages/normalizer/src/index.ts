import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────

export type CliSource = "codex" | "claude" | "opencode";

export type EventFamily =
  | "session"
  | "turn"
  | "message"
  | "reasoning"
  | "tool"
  | "plan"
  | "file"
  | "status"
  | "task"
  | "hook"
  | "rate_limit"
  | "error"
  | "stream"
  | "meta";

export type EventPhase = "started" | "updated" | "completed" | "failed";

export interface NormalizedEvent {
  id: string;
  source: CliSource;
  rawType: string;
  rawSubType: string | null;
  family: EventFamily;
  phase: EventPhase;
  actor?: string;
  sessionId?: string;
  messageId?: string;
  itemId?: string;
  text?: string;
  usage?: any;
  costUsd?: number | null;
  toolKind?: string;
  toolName?: string;
  command?: string;
  input?: any;
  output?: any;
  error?: string | null;
  status?: any;
  fileChanges?: any[];
  plan?: any[];
  exitCode?: number | null;
  raw: any;
}

// ── Helpers ────────────────────────────────────────────────────────

export function tryParseJson(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .map(tryParseJson)
    .filter((x): x is any => x !== null);
}

export function makeEvent(
  source: CliSource,
  rawType: string,
  rawSubType: string | null,
  family: EventFamily,
  phase: EventPhase,
  raw: any,
  overrides: Partial<NormalizedEvent> = {}
): NormalizedEvent {
  return {
    id: randomUUID(),
    source,
    rawType,
    rawSubType,
    family,
    phase,
    raw,
    ...overrides,
  };
}

// ── Codex Normalizer ───────────────────────────────────────────────

export function normalizeCodexEvent(record: any): NormalizedEvent {
  const type: string = record.type ?? "unknown";

  // thread.started
  if (type === "thread.started") {
    return makeEvent("codex", type, null, "session", "started", record, {
      sessionId: record.thread?.id,
    });
  }

  // turn.started / turn.completed / turn.failed
  if (type.startsWith("turn.")) {
    const phase = type.split(".")[1] as EventPhase;
    return makeEvent("codex", type, null, "turn", phase, record, {
      usage: record.usage,
      costUsd: record.cost_usd ?? null,
    });
  }

  // item.started / item.updated / item.completed
  if (type.startsWith("item.")) {
    const phase = type.split(".")[1] as EventPhase;
    const item = record.item ?? {};
    const itemType: string = item.type ?? "unknown";

    switch (itemType) {
      case "agent_message":
        return makeEvent("codex", type, itemType, "message", phase, record, {
          actor: "assistant",
          itemId: item.id,
          text: extractContentText(item.content),
        });

      case "reasoning":
        return makeEvent("codex", type, itemType, "reasoning", phase, record, {
          itemId: item.id,
          text: extractReasoningText(item),
        });

      case "command_execution":
        return makeEvent("codex", type, itemType, "tool", phase, record, {
          toolKind: "command",
          itemId: item.id,
          command: item.command,
          input: item.command,
          output: item.output,
          exitCode: item.exit_code ?? null,
          error: item.exit_code && item.exit_code !== 0 ? item.output : null,
        });

      case "file_change":
        return makeEvent("codex", type, itemType, "file", phase, record, {
          itemId: item.id,
          fileChanges: item.changes ?? [item],
        });

      case "mcp_tool_call":
        return makeEvent("codex", type, itemType, "tool", phase, record, {
          toolKind: "mcp",
          toolName: item.tool_name ?? item.name,
          itemId: item.id,
          input: item.arguments ?? item.input,
          output: item.output,
          error: item.error ?? null,
        });

      case "collab_tool_call":
        return makeEvent("codex", type, itemType, "tool", phase, record, {
          toolKind: "collab",
          toolName: item.tool_name ?? item.name,
          itemId: item.id,
          input: item.arguments ?? item.input,
          output: item.output,
        });

      case "web_search":
        return makeEvent("codex", type, itemType, "tool", phase, record, {
          toolKind: "web_search",
          itemId: item.id,
          input: item.query,
          output: item.results,
        });

      case "todo_list":
        return makeEvent("codex", type, itemType, "plan", phase, record, {
          itemId: item.id,
          plan: item.items ?? item.todos ?? [],
        });

      case "error":
        return makeEvent("codex", type, itemType, "error", "failed", record, {
          itemId: item.id,
          error: item.message ?? item.error ?? JSON.stringify(item),
        });

      default:
        return makeEvent("codex", type, itemType, "meta", phase, record, {
          itemId: item.id,
        });
    }
  }

  // fallback
  return makeEvent("codex", type, null, "meta", "updated", record);
}

function extractContentText(content: any): string | undefined {
  if (!content) return undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text" || c.type === "output_text")
      .map((c: any) => c.text ?? c.content ?? "")
      .join("");
  }
  return undefined;
}

function extractReasoningText(item: any): string | undefined {
  if (item.text) return item.text;
  if (item.content) {
    if (typeof item.content === "string") return item.content;
    if (Array.isArray(item.content)) {
      return item.content.map((c: any) => c.text ?? "").join("");
    }
  }
  return undefined;
}

// ── Claude Normalizer ──────────────────────────────────────────────

/**
 * Normalize a Claude Code stream-json record.
 * Returns an array because one record (e.g. "assistant") may contain
 * multiple content blocks (thinking, tool_use, text) that each become
 * their own NormalizedEvent.
 */
export function normalizeClaudeEvent(record: any): NormalizedEvent[] {
  const type: string = record.type ?? "unknown";
  const subtype: string | null = record.subtype ?? null;

  switch (type) {
    case "system": {
      switch (subtype) {
        case "init":
          return [makeEvent("claude", type, subtype, "session", "started", record, {
            sessionId: record.session_id,
            status: record.status,
          })];

        case "compact_boundary":
          return [makeEvent("claude", type, subtype, "session", "updated", record)];

        case "status":
          return [makeEvent("claude", type, subtype, "status", "updated", record, {
            status: record.message ?? record.status,
          })];

        case "api_retry":
          return [makeEvent("claude", type, subtype, "status", "updated", record, {
            error: record.message ?? record.error,
          })];

        case "task_started":
          return [makeEvent("claude", type, subtype, "task", "started", record)];

        case "task_completed":
          return [makeEvent("claude", type, subtype, "task", "completed", record)];

        case "hook_start":
          return [makeEvent("claude", type, subtype, "hook", "started", record, {
            toolName: record.hook_name ?? record.name,
          })];

        case "hook_end":
          return [makeEvent("claude", type, subtype, "hook", "completed", record, {
            toolName: record.hook_name ?? record.name,
            exitCode: record.exit_code ?? null,
          })];

        default:
          return [makeEvent("claude", type, subtype, "meta", "updated", record)];
      }
    }

    // ── Claude Code "assistant" — expand content blocks ──
    case "assistant": {
      const msg = record.message ?? {};
      const content: any[] = Array.isArray(msg.content) ? msg.content : [];
      const sessionId = record.session_id;
      const messageId = msg.id;
      const usage = msg.usage;

      // If no content blocks, emit a single message event
      if (content.length === 0) {
        return [makeEvent("claude", type, subtype, "message", "completed", record, {
          actor: "assistant",
          messageId,
          sessionId,
          usage,
        })];
      }

      return content.map((block: any) => {
        switch (block.type) {
          case "text":
            return makeEvent("claude", type, "text", "message", "completed", record, {
              actor: "assistant",
              messageId,
              sessionId,
              text: block.text,
              usage,
            });

          case "tool_use":
            return makeEvent("claude", type, "tool_use", "tool", "started", record, {
              toolKind: "tool",
              toolName: block.name,
              itemId: block.id,
              input: block.input,
              sessionId,
            });

          case "thinking":
            return makeEvent("claude", type, "thinking", "reasoning", "updated", record, {
              text: block.thinking,
              sessionId,
            });

          default:
            return makeEvent("claude", type, block.type ?? "unknown", "meta", "updated", record, {
              sessionId,
            });
        }
      });
    }

    // ── Claude Code "user" — extract tool results ──
    case "user": {
      const msg = record.message ?? {};
      const content: any[] = Array.isArray(msg.content) ? msg.content : [];
      const sessionId = record.session_id;
      const toolResult = record.tool_use_result;

      // New format: tool_use_result at top level
      if (toolResult) {
        return [makeEvent("claude", type, "tool_result", "tool", "completed", record, {
          actor: "user",
          toolName: toolResult.name,
          output: toolResult.content,
          error: toolResult.is_error ? (typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content)) : null,
          sessionId,
        })];
      }

      // Content blocks
      if (content.length > 0) {
        return content.map((block: any) => {
          if (block.type === "tool_result") {
            return makeEvent("claude", type, "tool_result", "tool", "completed", record, {
              actor: "user",
              toolName: block.tool_use_id,
              output: block.content,
              error: block.is_error ? (typeof block.content === "string" ? block.content : JSON.stringify(block.content)) : null,
              sessionId,
            });
          }
          return makeEvent("claude", type, block.type ?? "user", "meta", "updated", record, {
            actor: "user",
            text: block.text,
            sessionId,
          });
        });
      }

      return [makeEvent("claude", type, subtype, "message", "completed", record, {
        actor: "user",
        text: extractClaudeText(record),
        sessionId,
      })];
    }

    case "result":
      return [makeEvent(
        "claude",
        type,
        subtype,
        "turn",
        subtype === "error" ? "failed" : "completed",
        record,
        {
          text: record.result ?? extractClaudeText(record),
          usage: record.usage,
          costUsd: record.total_cost_usd ?? record.cost_usd ?? null,
          error: subtype === "error" ? (record.error ?? record.message) : null,
          exitCode: record.exit_code ?? null,
        }
      )];

    case "rate_limit_event":
      return [makeEvent("claude", type, subtype, "rate_limit", "updated", record, {
        error: record.rate_limit_info?.status ?? record.message ?? "Rate limited",
      })];

    case "tool_progress":
      return [makeEvent("claude", type, subtype, "tool", "updated", record, {
        toolKind: record.tool_type ?? "tool",
        toolName: record.tool_name ?? record.name,
        input: record.input,
        output: record.content ?? record.output,
      })];

    case "streamlined_text":
      return [makeEvent("claude", type, subtype, "stream", "updated", record, {
        text: record.text ?? record.content,
      })];

    case "streamlined_tool_use_summary":
    case "tool_use_summary":
      return [makeEvent("claude", type, subtype, "tool", "completed", record, {
        toolKind: record.tool_type ?? "tool",
        toolName: record.tool_name ?? record.name,
        input: record.input,
        output: record.output ?? record.result,
      })];

    case "auth_status":
      return [makeEvent("claude", type, subtype, "status", "updated", record, {
        status: record.status ?? record.message,
      })];

    case "prompt_suggestion":
      return [makeEvent("claude", type, subtype, "meta", "updated", record, {
        text: record.suggestion ?? record.text,
      })];

    case "stream_event":
      return [makeEvent("claude", type, subtype, "stream", "updated", record)];

    // ── Raw Anthropic API / content-block formats ──

    case "message":
      return [makeEvent("claude", type, record.role ?? subtype, "message",
        record.stop_reason ? "completed" : "started", record, {
          actor: record.role ?? "assistant",
          messageId: record.id,
          text: extractClaudeText(record),
          usage: record.usage,
        })];

    case "message_start":
      return [makeEvent("claude", type, subtype, "message", "started", record, {
        actor: record.message?.role ?? "assistant",
        messageId: record.message?.id,
        usage: record.message?.usage,
      })];

    case "message_delta":
      return [makeEvent("claude", type, subtype, "message", "updated", record, {
        usage: record.usage,
        text: record.delta?.stop_reason ? `[stop: ${record.delta.stop_reason}]` : undefined,
      })];

    case "message_stop":
      return [makeEvent("claude", type, subtype, "message", "completed", record)];

    case "content_block_start": {
      const cb = record.content_block ?? {};
      if (cb.type === "tool_use") {
        return [makeEvent("claude", type, "tool_use", "tool", "started", record, {
          toolName: cb.name,
          toolKind: "tool",
          input: cb.input,
        })];
      }
      if (cb.type === "thinking") {
        return [makeEvent("claude", type, "thinking", "reasoning", "started", record, {
          text: cb.thinking,
        })];
      }
      return [makeEvent("claude", type, cb.type ?? subtype, "message", "started", record, {
        text: cb.text,
      })];
    }

    case "content_block_delta": {
      const delta = record.delta ?? {};
      if (delta.type === "input_json_delta") {
        return [makeEvent("claude", type, "tool_input", "tool", "updated", record, {
          input: delta.partial_json,
        })];
      }
      if (delta.type === "thinking_delta") {
        return [makeEvent("claude", type, "thinking", "reasoning", "updated", record, {
          text: delta.thinking,
        })];
      }
      return [makeEvent("claude", type, delta.type ?? subtype, "message", "updated", record, {
        text: delta.text,
      })];
    }

    case "content_block_stop":
      return [makeEvent("claude", type, subtype, "message", "completed", record)];

    case "tool_use":
      return [makeEvent("claude", type, subtype, "tool", "completed", record, {
        toolKind: "tool",
        toolName: record.name,
        input: record.input,
      })];

    case "tool_result":
      return [makeEvent("claude", type, subtype, "tool", "completed", record, {
        toolKind: "tool",
        toolName: record.tool_use_id,
        output: record.content,
        error: record.is_error ? (typeof record.content === "string" ? record.content : JSON.stringify(record.content)) : null,
      })];

    default:
      return [makeEvent("claude", type, subtype, "meta", "updated", record)];
  }
}

function extractClaudeText(record: any): string | undefined {
  if (record.result) return record.result;
  if (record.text) return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  // Claude Code wraps content in record.message.content
  const msg = record.message;
  if (msg && Array.isArray(msg.content)) {
    const texts = msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text ?? "");
    if (texts.length > 0) return texts.join("");
  }
  if (msg && typeof msg === "string") return msg;
  return undefined;
}

// ── OpenCode Normalizer ────────────────────────────────────────────

export function normalizeOpencodeEvent(record: any): NormalizedEvent {
  const type: string = record.type ?? "unknown";

  switch (type) {
    case "step_start":
      return makeEvent("opencode", type, null, "turn", "started", record, {
        sessionId: record.session_id,
      });

    case "text":
      return makeEvent("opencode", type, null, "message", "completed", record, {
        actor: "assistant",
        text: record.text ?? record.content,
      });

    case "reasoning":
      return makeEvent("opencode", type, null, "reasoning", "updated", record, {
        text: record.text ?? record.content,
      });

    case "tool_use":
      return makeEvent("opencode", type, null, "tool", "completed", record, {
        toolKind: record.tool_type ?? "tool",
        toolName: record.tool_name ?? record.name,
        input: record.input,
        output: record.output ?? record.result,
        error: record.error ?? null,
      });

    case "step_finish":
      return makeEvent("opencode", type, null, "turn", "completed", record, {
        usage: record.usage,
        costUsd: record.cost_usd ?? null,
      });

    default:
      return makeEvent("opencode", type, null, "meta", "updated", record);
  }
}

// ── Unified Entry Point ────────────────────────────────────────────

/**
 * Normalize one JSONL record into one or more NormalizedEvents.
 * Claude Code records may expand into multiple events (one per content block).
 */
export function normalizeCliRecord(
  source: CliSource,
  record: any
): NormalizedEvent[] {
  switch (source) {
    case "codex":
      return [normalizeCodexEvent(record)];
    case "claude":
      return normalizeClaudeEvent(record);
    case "opencode":
      return [normalizeOpencodeEvent(record)];
  }
}

// ── Extraction Utilities ───────────────────────────────────────────

/**
 * Extract the final assistant text from an array of normalized events.
 */
export function extractFinalText(events: NormalizedEvent[]): string | null {
  // Walk backwards looking for the last message from the assistant
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.family === "message" && ev.actor === "assistant" && ev.text) {
      return ev.text;
    }
    // Also check result/turn completed with text
    if (ev.family === "turn" && ev.phase === "completed" && ev.text) {
      return ev.text;
    }
  }
  return null;
}

/**
 * Collect events from a JSONL string emitted by a CLI tool.
 */
export function collectCliOutput(
  source: CliSource,
  jsonlText: string
): NormalizedEvent[] {
  const records = parseJsonl(jsonlText);
  return records.flatMap((r) => normalizeCliRecord(source, r));
}
