import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";
import type { Server } from "node:http";

describe("server", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const result = createServer(0, "/tmp");
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

  it("generates a script", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        description: "A test",
        cliTool: "claude",
        steps: [{ name: "Step1", description: "Do stuff" }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.script).toContain("#!/usr/bin/env bash");
    expect(data.steps).toHaveLength(1);
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
