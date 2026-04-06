#!/usr/bin/env node

import { createServer } from "../dist/server.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const pkgRoot = dirname(dirname(__filename));

const args = process.argv.slice(2);
let port = 3120;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number:", args[i + 1]);
      process.exit(1);
    }
    i++;
  }
}

const cwd = process.cwd();

const { app, server } = createServer(port, cwd, pkgRoot);

server.listen(port, async () => {
  const url = `http://localhost:${port}`;
  console.log(`stepflow running at ${url}`);
  console.log(`Working directory: ${cwd}`);

  try {
    const open = await import("open");
    await open.default(url);
  } catch {
    // open is optional — ignore if it fails
  }
});

function shutdown() {
  console.log("\nShutting down...");
  server.close(() => {
    process.exit(0);
  });
  // Force exit after 3s if server doesn't close
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
