#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createVisServer } from "../dist/server.js";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Parse CLI args
const args = process.argv.slice(2);
let source = "claude"; // default
let port = 3130;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (!args[i].startsWith("-")) {
    source = args[i]; // codex | claude | opencode
  }
}

// Check if stdin is a pipe
if (process.stdin.isTTY) {
  console.error("Usage: some-cli --json | npx @starsea/agent-vis [codex|claude|opencode]");
  console.error("       npx @starsea/agent-vis claude < output.jsonl");
  process.exit(1);
}

const { server } = createVisServer(port, source, pkgRoot);

server.listen(port, async () => {
  const url = `http://localhost:${port}`;
  console.error(`agent-vis running at ${url} (source: ${source})`);
  try {
    const open = await import("open");
    await open.default(url);
  } catch {}
});

function shutdown() {
  console.error("\nShutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
