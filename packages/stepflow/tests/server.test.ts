import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "../src/server.js";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("server", () => {
  let server: Server;
  let baseUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stepflow-server-test-"));
    const result = createServer(0, tempDir);
    server = result.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns idle status when no execution", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("idle");
  });

  it("rejects generate without name", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: [{ name: "a", description: "b" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects generate without steps", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("generates prompt files and returns paths", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        description: "A test",
        cliTool: "claude",
        steps: [
          { name: "Step1", description: "Do stuff" },
          { name: "Step2", description: "Do more" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sharedPromptPath).toContain("shared-prompt.md");
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].promptPath).toContain("prompt.md");
    expect(data.steps[0].dirName).toBe("step-01-step1");
    expect(data.steps[1].dirName).toBe("step-02-step2");
  });

  it("reads prompt files via GET /api/prompts", async () => {
    const res = await fetch(`${baseUrl}/api/prompts`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sharedPrompt).toContain("# Task: Test");
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].prompt).toContain("Step 1 of 2: Step1");
    expect(data.steps[1].prompt).toContain("Step 2 of 2: Step2");
  });

  it("saves edited prompts via PUT /api/prompts", async () => {
    const putRes = await fetch(`${baseUrl}/api/prompts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedPrompt: "# Edited shared prompt",
        steps: [
          { dirName: "step-01-step1", prompt: "Edited step 1 prompt" },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const putData = await putRes.json();
    expect(putData.ok).toBe(true);

    // Verify the edits persisted
    const getRes = await fetch(`${baseUrl}/api/prompts`);
    const getData = await getRes.json();
    expect(getData.sharedPrompt).toBe("# Edited shared prompt");
    expect(getData.steps[0].prompt).toBe("Edited step 1 prompt");
  });

  it("rejects execute when no task generated", async () => {
    // Create a fresh server with no generated task
    const tempDir2 = await mkdtemp(join(tmpdir(), "stepflow-server-test2-"));
    const result2 = createServer(0, tempDir2);
    const server2 = result2.server;
    await new Promise<void>((resolve) => {
      server2.listen(0, () => resolve());
    });
    const addr2 = server2.address();
    const port2 = typeof addr2 === "object" && addr2 ? addr2.port : 0;
    const baseUrl2 = `http://localhost:${port2}`;

    const res = await fetch(`${baseUrl2}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    await new Promise<void>((resolve) => {
      server2.close(() => resolve());
    });
    await rm(tempDir2, { recursive: true, force: true });
  });

  it("rejects stop when no execution running", async () => {
    const res = await fetch(`${baseUrl}/api/stop`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("rejects resume when no execution exists", async () => {
    const res = await fetch(`${baseUrl}/api/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startFrom: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("SSE endpoint returns event-stream content type", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });
});
