#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createVisServer } from "../dist/server.js";
import { createSlackSink } from "../dist/slack.js";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Parse CLI args
const args = process.argv.slice(2);
let source = "claude"; // default
let port = 3130;
let slackEnabled = false;
let slackBotToken = process.env.SLACK_BOT_TOKEN;
let slackAppToken = process.env.SLACK_APP_TOKEN;
let slackChannel = process.env.SLACK_CHANNEL ?? process.env.SLACK_CHANNEL_ID;
let slackThreadTs = process.env.SLACK_THREAD_TS;
let slackPlanTitle = process.env.SLACK_PLAN_TITLE;
let slackTaskMode = process.env.SLACK_TASK_DISPLAY_MODE;
let slackTeamId = process.env.SLACK_TEAM_ID;
let slackUserId = process.env.SLACK_USER_ID;
let noWeb = false;

function nextArg(i) {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`Missing value for ${args[i]}`);
    process.exit(1);
  }
  return v;
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") {
    port = parseInt(nextArg(i), 10);
    i++;
  } else if (a === "--slack") {
    slackEnabled = true;
  } else if (a === "--slack-bot-token") {
    slackBotToken = nextArg(i);
    slackEnabled = true;
    i++;
  } else if (a === "--slack-app-token") {
    slackAppToken = nextArg(i);
    i++;
  } else if (a === "--slack-channel") {
    slackChannel = nextArg(i);
    i++;
  } else if (a === "--slack-thread-ts") {
    slackThreadTs = nextArg(i);
    i++;
  } else if (a === "--slack-plan-title") {
    slackPlanTitle = nextArg(i);
    i++;
  } else if (a === "--slack-task-mode") {
    slackTaskMode = nextArg(i);
    i++;
  } else if (a === "--slack-team-id") {
    slackTeamId = nextArg(i);
    i++;
  } else if (a === "--slack-user-id") {
    slackUserId = nextArg(i);
    i++;
  } else if (a === "--no-web") {
    noWeb = true;
  } else if (a === "--help" || a === "-h") {
    printHelp();
    process.exit(0);
  } else if (!a.startsWith("-")) {
    source = a; // codex | claude | opencode
  }
}

function printHelp() {
  console.error(`Usage: <cli --json> | npx @starsea/agent-vis [options] [codex|claude|opencode]

Options:
  --port <n>               Port for the web visualizer (default 3130)
  --no-web                 Don't start the web server (useful with --slack)

Slack mode:
  --slack                  Enable Slack streaming sink
  --slack-bot-token <t>    Bot token (xoxb-...). Env: SLACK_BOT_TOKEN
  --slack-app-token <t>    App token (xapp-...). Env: SLACK_APP_TOKEN
  --slack-channel <id>     Channel ID. Env: SLACK_CHANNEL
  --slack-thread-ts <ts>   Reply inside an existing thread. Env: SLACK_THREAD_TS
  --slack-plan-title <s>   Title shown above the task list (default "Agent Run")
  --slack-task-mode <m>    "timeline" (default) or "plan"

Slack mode uses chat.startStream / chat.appendStream / chat.stopStream
(Slack Thinking Steps for AI agents). Step Protocol events
(step:init/start/complete/error) are mapped to plan_update + task_update
chunks; assistant text and tool calls are mapped to markdown_text +
task_update chunks. Required scope: chat:write.`);
}

// Check if stdin is a pipe
if (process.stdin.isTTY) {
  printHelp();
  process.exit(1);
}

const sinks = [];

if (slackEnabled) {
  if (!slackBotToken) {
    console.error("--slack requires --slack-bot-token or SLACK_BOT_TOKEN env var");
    process.exit(1);
  }
  if (!slackChannel) {
    console.error("--slack requires --slack-channel or SLACK_CHANNEL env var");
    process.exit(1);
  }
  if (slackTaskMode && slackTaskMode !== "timeline" && slackTaskMode !== "plan") {
    console.error('--slack-task-mode must be "timeline" or "plan"');
    process.exit(1);
  }
  sinks.push(createSlackSink({
    botToken: slackBotToken,
    appToken: slackAppToken,
    channel: slackChannel,
    threadTs: slackThreadTs,
    planTitle: slackPlanTitle,
    taskDisplayMode: slackTaskMode,
    recipientTeamId: slackTeamId,
    recipientUserId: slackUserId,
  }));
  const where = slackThreadTs ? `${slackChannel} (thread ${slackThreadTs})` : slackChannel;
  console.error(`agent-vis: streaming progress to Slack ${where}`);
}

const { server } = createVisServer(port, source, pkgRoot, undefined, sinks);

if (!noWeb) {
  server.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.error(`agent-vis running at ${url} (source: ${source})`);
    try {
      const open = await import("open");
      await open.default(url);
    } catch {}
  });
} else {
  console.error(`agent-vis: web server disabled (--no-web), source: ${source}`);
}

function shutdown() {
  console.error("\nShutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
