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
  /**
   * Recipient team ID (T...). Required by chat.startStream when posting to
   * a channel. Auto-resolved via auth.test if omitted.
   */
  recipientTeamId?: string;
  /**
   * Recipient user ID (U...). Required by chat.startStream when posting to
   * a channel. Defaults to the bot's own user ID via auth.test.
   */
  recipientUserId?: string;
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

  const debug = process.env.AGENT_VIS_SLACK_DEBUG === "1";

  async function slackCall(method: string, body: any): Promise<any> {
    if (debug) {
      console.error(`[slack-sink] → ${method}: ${JSON.stringify(body)}`);
    }
    const res = await fetchImpl(`${apiBase}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${opts.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (debug) {
      console.error(`[slack-sink] ← ${method}: ${JSON.stringify(json)}`);
    }
    if (!json.ok) {
      const meta = json.response_metadata?.messages
        ? ` [${json.response_metadata.messages.join("; ")}]`
        : "";
      const errs = json.errors ? ` errors=${JSON.stringify(json.errors)}` : "";
      throw new Error(`${method}: ${json.error ?? "unknown_error"}${meta}${errs}`);
    }
    return json;
  }

  let recipientTeamId = opts.recipientTeamId;
  let recipientUserId = opts.recipientUserId;

  async function resolveRecipients(): Promise<void> {
    if (recipientTeamId && recipientUserId) return;
    const auth = await slackCall("auth.test", {});
    recipientTeamId = recipientTeamId ?? auth.team_id;
    recipientUserId = recipientUserId ?? auth.user_id;
  }

  async function ensureThreadTs(): Promise<string> {
    if (opts.threadTs) return opts.threadTs;
    // chat.startStream requires thread_ts. When the caller hasn't supplied one,
    // post a lightweight parent message and reply in its thread.
    const parent = await slackCall("chat.postMessage", {
      channel: opts.channel,
      text: opts.planTitle ?? "Agent Run",
    });
    return parent.ts;
  }

  async function ensureStarted(initialChunks?: Chunk[]): Promise<void> {
    if (ts) return;
    if (!starting) {
      starting = (async () => {
        await resolveRecipients();
        const threadTs = await ensureThreadTs();
        const body: Record<string, any> = {
          channel: opts.channel,
          thread_ts: threadTs,
        };
        if (recipientTeamId) body.recipient_team_id = recipientTeamId;
        if (recipientUserId) body.recipient_user_id = recipientUserId;
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
