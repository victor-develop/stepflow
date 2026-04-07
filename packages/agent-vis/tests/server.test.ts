import { describe, it, expect, afterAll } from "vitest";
import { createVisServer } from "../src/server.js";
import { join } from "node:path";

// We need to provide a mock stdin for tests
// The createVisServer reads from process.stdin, so we test the HTTP parts

describe("createVisServer", () => {
  const { app, server } = createVisServer(0, "claude", join(import.meta.dirname ?? ".", ".."));

  afterAll(() => {
    server.close();
  });

  it("returns app and server", () => {
    expect(app).toBeDefined();
    expect(server).toBeDefined();
  });

  it("/api/state returns correct initial state", async () => {
    // Start server on a random port
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = addr.port;

    const res = await fetch(`http://localhost:${port}/api/state`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("claude");
    expect(body.eventCount).toBe(0);
    expect(typeof body.finished).toBe("boolean");
  });

  it("/api/events returns event-stream content type", async () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = (addr as any).port;

    const controller = new AbortController();
    const res = await fetch(`http://localhost:${port}/api/events`, {
      signal: controller.signal,
    });

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });
});
