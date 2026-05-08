import type { NormalizedEvent } from "@starsea/normalizer";
import type { StepDef, VisSink } from "./server.js";

/**
 * Slack sink for agent-vis.
 *
 * Streams agent progress to a Slack channel/thread using the Thinking Steps
 * streaming API:
 *   - chat.startStream  (open the streaming message)
 *   - chat.appendStream (push markdown / task / plan chunks)
 *   - chat.stopStream   (finalize)
 *
 * Step Protocol mapping:
 *   step:init     -> startStream with a plan_update + N pending task_update chunks
 *   step:start    -> appendStream task_update {status: "in_progress"}
 *   step:complete -> appendStream task_update {status: "complete"}
 *   step:error    -> appendStream task_update {status: "error", details}
 *
 * Non-step events:
 *   - assistant message text -> debounced markdown_text chunks
 *   - tool started/completed -> task_update chunks (one per tool call)
 *   - errors                 -> markdown_text chunks
 */

export interface SlackOptions {
  /** Bot token (xoxb-...). Required — used for chat:write streaming calls. */
  botToken: string;
  /**
   * App-level token (xapp-...). Optional. Accepted for forward compatibility
   * (Socket Mode / future bidirectional features); not used by streaming calls.
   */
  appToken?: string;
  /** Channel ID (e.g., C0123456789). */
  channel: string;
  /** Optional thread timestamp to reply inside an existing thread. */
  threadTs?: string;
  /** Optional bot display username override. */
  username?: string;
  /** Optional emoji icon (e.g., ":robot_face:"). */
  iconEmoji?: string;
  /** Display mode for tasks: timeline (default) or plan. */
  taskDisplayMode?: "timeline" | "plan";
  /** Title shown at the top of the plan. Default: "Agent Run". */
  planTitle?: string;
  /** Override the Slack API base URL (mainly for testing). */
  apiBase?: string;
  /** Override fetch implementation (mainly for testing). */
  fetchImpl?: typeof fetch;
}

type Chunk =
  | { type: "markdown_text"; text: string }
  | {
      type: "task_update";
      id: string;
      title?: string;
      status?: "pending" | "in_progress" | "complete" | "error";
      details?: string;
      output?: string;
      sources?: Array<{ type: "url"; text: string; url: string }>;
    }
  | { type: "plan_update"; title: string }
  | { type: "blocks"; blocks: any[] };

const DEFAULT_API_BASE = "https://slack.com/api";
const TEXT_FLUSH_MS = 800;
const MAX_DETAIL_CHARS = 500;
const MAX_OUTPUT_CHARS = 1000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function summarize(value: any, max: number): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return truncate(value, max);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return undefined;
  }
}

export function createSlackSink(opts: SlackOptions): VisSink {
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? globalThis.fetch;

  let ts: string | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;
  let steps: StepDef[] = [];
  const toolTaskIds = new Map<string, string>();

  let textBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Serialize Slack API calls so chunks arrive in order.
  let queue: Promise<void> = Promise.resolve();
  function enqueue(fn: () => Promise<void>): Promise<void> {
    queue = queue.then(fn).catch((err) => {
      console.error("[slack-sink]", err instanceof Error ? err.message : err);
    });
    return queue;
  }

  async function slackCall(method: string, body: any): Promise<any> {
    const res = await fetchImpl(`${apiBase}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${opts.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!json.ok) {
      throw new Error(`${method}: ${json.error ?? "unknown_error"}`);
    }
    return json;
  }

  async function ensureStarted(initialChunks?: Chunk[]): Promise<void> {
    if (ts) return;
    if (!starting) {
      starting = (async () => {
        const body: Record<string, any> = { channel: opts.channel };
        if (opts.threadTs) body.thread_ts = opts.threadTs;
        if (opts.username) body.username = opts.username;
        if (opts.iconEmoji) body.icon_emoji = opts.iconEmoji;
        if (opts.taskDisplayMode) body.task_display_mode = opts.taskDisplayMode;
        if (initialChunks && initialChunks.length > 0) {
          body.chunks = initialChunks;
        } else {
          body.markdown_text = "Agent run started.";
        }
        const res = await slackCall("chat.startStream", body);
        ts = res.ts ?? null;
      })();
    }
    await starting;
  }

  async function append(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await ensureStarted();
    if (!ts) return;
    await slackCall("chat.appendStream", {
      channel: opts.channel,
      ts,
      chunks,
    });
  }

  function flushText() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const text = textBuffer.trim();
    textBuffer = "";
    if (!text) return;
    enqueue(() => append([{ type: "markdown_text", text: truncate(text, 12000) }]));
  }

  function bufferText(t: string) {
    if (!t) return;
    textBuffer += (textBuffer ? "\n\n" : "") + t;
    if (!flushTimer) {
      flushTimer = setTimeout(flushText, TEXT_FLUSH_MS);
    }
  }

  return {
    onStepInit(s: StepDef[]) {
      steps = s;
      const planTitle = (opts.planTitle ?? "Agent Run").slice(0, 256);
      const chunks: Chunk[] = [{ type: "plan_update", title: planTitle }];
      for (let i = 0; i < s.length; i++) {
        chunks.push({
          type: "task_update",
          id: `step-${i}`,
          title: s[i].name,
          status: "pending",
          details: s[i].description,
        });
      }
      enqueue(() => ensureStarted(chunks));
    },

    onStepStart(idx: number) {
      const step = steps[idx];
      if (!step) return;
      enqueue(() =>
        append([
          {
            type: "task_update",
            id: `step-${idx}`,
            title: step.name,
            status: "in_progress",
          },
        ])
      );
    },

    onStepComplete(idx: number) {
      const step = steps[idx];
      if (!step) return;
      enqueue(() =>
        append([
          {
            type: "task_update",
            id: `step-${idx}`,
            title: step.name,
            status: "complete",
          },
        ])
      );
    },

    onStepError(idx: number, error?: string) {
      const step = steps[idx];
      if (!step) return;
      enqueue(() =>
        append([
          {
            type: "task_update",
            id: `step-${idx}`,
            title: step.name,
            status: "error",
            details: error,
          },
        ])
      );
    },

    onEvent(ev: NormalizedEvent) {
      // Assistant text → batched markdown
      if (ev.family === "message" && ev.actor === "assistant" && ev.text) {
        bufferText(ev.text);
        return;
      }

      // Tool calls → task cards (one per tool invocation)
      if (ev.family === "tool" && ev.itemId) {
        const taskId = `tool-${ev.itemId}`;
        toolTaskIds.set(ev.itemId, taskId);
        const toolLabel = ev.toolName ?? ev.toolKind ?? "tool";

        if (ev.phase === "started") {
          enqueue(() =>
            append([
              {
                type: "task_update",
                id: taskId,
                title: `🔧 ${toolLabel}`,
                status: "in_progress",
                details: summarize(ev.input ?? ev.command, MAX_DETAIL_CHARS),
              },
            ])
          );
          return;
        }

        if (ev.phase === "completed" || ev.phase === "failed") {
          enqueue(() =>
            append([
              {
                type: "task_update",
                id: taskId,
                title: `🔧 ${toolLabel}`,
                status: ev.error ? "error" : "complete",
                details: ev.error ?? undefined,
                output: summarize(ev.output, MAX_OUTPUT_CHARS),
              },
            ])
          );
          return;
        }
      }

      // Errors → markdown
      if (ev.family === "error" && ev.error) {
        bufferText(`❌ ${ev.error}`);
        return;
      }
    },

    async onFinish(): Promise<void> {
      if (stopped) return;
      stopped = true;

      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const trailing = textBuffer.trim();
      textBuffer = "";

      await enqueue(async () => {
        if (!ts) {
          // Nothing streamed yet — open a short message so we can close cleanly.
          await ensureStarted();
        }
        if (trailing) {
          await append([{ type: "markdown_text", text: truncate(trailing, 12000) }]);
        }
      });
      await enqueue(async () => {
        if (!ts) return;
        await slackCall("chat.stopStream", { channel: opts.channel, ts });
      });
    },
  };
}
