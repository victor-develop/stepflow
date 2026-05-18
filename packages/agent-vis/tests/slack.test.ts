import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { createSlackSink } from "../src/slack.js";
import { createVisServer } from "../src/server.js";

interface CapturedCall { method: string; body: any }

function makeMockFetch(): { calls: CapturedCall[]; fetch: typeof fetch } {
  const calls: CapturedCall[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = u.split("/").pop() ?? "";
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    return new Response(
      JSON.stringify({ ok: true, ts: "1234567890.000100", channel: body.channel }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  return { calls, fetch: fn as unknown as typeof fetch };
}

async function flushQueue() {
  // Slack sink serializes API calls through a promise chain; each enqueued call
  // does 1+ awaits, so we need to drain enough microtasks for all chained ops.
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("createSlackSink", () => {
  let mock: ReturnType<typeof makeMockFetch>;

  beforeEach(() => {
    mock = makeMockFetch();
  });

  it("opens stream with plan + tasks on step:init and closes on finish", async () => {
    const sink = createSlackSink({
      botToken: "xoxb-test",
      channel: "C123",
      apiBase: "https://slack.invalid/api",
      fetchImpl: mock.fetch,
    });

    sink.onStepInit!([{ name: "Setup" }, { name: "Build" }]);
    await flushQueue();

    const start = mock.calls.find((c) => c.method === "chat.startStream");
    expect(start).toBeDefined();
    expect(start!.body.channel).toBe("C123");
    expect(start!.body.chunks[0]).toEqual({ type: "plan_update", title: "Agent Run" });
    expect(start!.body.chunks).toHaveLength(3);
    expect(start!.body.chunks[1]).toMatchObject({
      type: "task_update",
      id: "step-0",
      status: "pending",
    });

    sink.onStepStart!(0);
    sink.onStepComplete!(0);
    sink.onStepStart!(1);
    sink.onStepError!(1, "boom");
    await flushQueue();

    const appends = mock.calls.filter((c) => c.method === "chat.appendStream");
    expect(appends).toHaveLength(4);
    expect(appends[0].body.chunks[0]).toMatchObject({ id: "step-0", status: "in_progress" });
    expect(appends[1].body.chunks[0]).toMatchObject({ id: "step-0", status: "complete" });
    expect(appends[2].body.chunks[0]).toMatchObject({ id: "step-1", status: "in_progress" });
    expect(appends[3].body.chunks[0]).toMatchObject({ id: "step-1", status: "error", details: "boom" });

    await sink.onFinish!();
    const stop = mock.calls.find((c) => c.method === "chat.stopStream");
    expect(stop).toBeDefined();
    expect(stop!.body.ts).toBe("1234567890.000100");
  });

  it("threads thread_ts and display options into startStream", async () => {
    const sink = createSlackSink({
      botToken: "xoxb-test",
      channel: "C9",
      threadTs: "111.222",
      taskDisplayMode: "plan",
      iconEmoji: ":robot_face:",
      apiBase: "https://slack.invalid/api",
      fetchImpl: mock.fetch,
    });

    sink.onStepInit!([{ name: "Only" }]);
    await flushQueue();

    const start = mock.calls.find((c) => c.method === "chat.startStream")!;
    expect(start.body.thread_ts).toBe("111.222");
    expect(start.body.task_display_mode).toBe("plan");
    expect(start.body.icon_emoji).toBe(":robot_face:");
  });

  it("integrates with createVisServer step protocol", async () => {
    const sink = createSlackSink({
      botToken: "xoxb",
      channel: "C1",
      apiBase: "https://slack.invalid/api",
      fetchImpl: mock.fetch,
    });

    const input = new PassThrough();
    const { server } = createVisServer(0, "claude", undefined, input, [sink]);

    input.write(JSON.stringify({
      type: "step:init",
      steps: [{ name: "A" }, { name: "B" }],
    }) + "\n");
    input.write(JSON.stringify({ type: "step:start", stepIndex: 0 }) + "\n");
    input.write(JSON.stringify({ type: "step:complete", stepIndex: 0 }) + "\n");
    input.end();

    // Wait for readline 'close' to propagate to onFinish + queued calls.
    await new Promise((r) => setTimeout(r, 100));
    await flushQueue();
    // Give the queued async stopStream a moment to land.
    await new Promise((r) => setTimeout(r, 50));

    const methods = mock.calls.map((c) => c.method);
    expect(methods).toContain("chat.startStream");
    expect(methods).toContain("chat.appendStream");
    expect(methods).toContain("chat.stopStream");

    server.close();
  });
});
