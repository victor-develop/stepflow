# @starsea/agent-vis

Pipe any agent CLI's JSONL output into a live web visualizer. Supports flat event streaming and multi-step workflows via the **Step Protocol**.

## Quick Start

```bash
# Flat mode — visualize any CLI's JSONL output
claude -p "your prompt" --output-format stream-json --verbose \
  | npx @starsea/agent-vis claude

# Also works with Codex and OpenCode
codex exec --json "your prompt" | npx @starsea/agent-vis codex
opencode run --format json "your prompt" | npx @starsea/agent-vis opencode
```

Opens `http://localhost:3130`. Events appear in real time as they stream in.

### Custom port

```bash
... | npx @starsea/agent-vis --port 8080 claude
```

## Step Protocol

Any script can output **step protocol events** on stdout alongside normal JSONL events to activate the step-aware UI — breadcrumbs, per-step progress, and grouped event views.

This is designed to be **LLM-friendly**: an AI agent reading this protocol spec can generate a wrapper script that orchestrates multi-step tasks with full visualization, without depending on any specific framework.

### Protocol Events

There are four event types. All are single-line JSON objects on stdout:

#### `step:init` — Declare steps (must come first)

```json
{"type":"step:init","steps":[{"name":"Setup","description":"Initialize project"},{"name":"Build"},{"name":"Test"}]}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"step:init"` | yes | |
| `steps` | `Array<{ name: string; description?: string }>` | yes | Ordered list of steps |

#### `step:start` — Begin a step

```json
{"type":"step:start","stepIndex":0}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"step:start"` | yes | |
| `stepIndex` | `number` | yes | 0-based index into the steps array |

#### `step:complete` — Finish a step successfully

```json
{"type":"step:complete","stepIndex":0}
```

#### `step:error` — Mark a step as failed

```json
{"type":"step:error","stepIndex":1,"error":"Build failed: exit code 1"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | `string` | no | Error message |

### Sequencing Rules

1. `step:init` must appear **before** any other step events
2. `step:start` before `step:complete` or `step:error` for that step
3. Only one step is active at a time (a new `step:start` implies the previous is done)
4. Any non-step JSONL lines between `step:start` and `step:complete` are automatically associated with that step

### Example: Bash Wrapper Script

```bash
#!/bin/bash
# multi-step.sh — pipe this into agent-vis

echo '{"type":"step:init","steps":[{"name":"Analyze"},{"name":"Implement"},{"name":"Test"}]}'

echo '{"type":"step:start","stepIndex":0}'
claude -p "Analyze the codebase" --output-format stream-json --verbose
echo '{"type":"step:complete","stepIndex":0}'

echo '{"type":"step:start","stepIndex":1}'
claude -p "Implement the feature" --output-format stream-json --verbose
echo '{"type":"step:complete","stepIndex":1}'

echo '{"type":"step:start","stepIndex":2}'
claude -p "Write tests" --output-format stream-json --verbose
echo '{"type":"step:complete","stepIndex":2}'
```

Run it:

```bash
bash multi-step.sh | npx @starsea/agent-vis claude
```

### Example: Node.js Script

```js
const steps = [
  { name: "Research", description: "Gather requirements" },
  { name: "Design", description: "Plan architecture" },
  { name: "Code", description: "Write implementation" },
];

// Declare steps
console.log(JSON.stringify({ type: "step:init", steps }));

for (let i = 0; i < steps.length; i++) {
  console.log(JSON.stringify({ type: "step:start", stepIndex: i }));

  // Your agent work here — any JSONL output is captured
  // e.g. spawn('claude', [...]) and pipe stdout

  console.log(JSON.stringify({ type: "step:complete", stepIndex: i }));
}
```

### Backward Compatibility

If no step protocol events appear in the stream, agent-vis behaves as a flat event visualizer — no breadcrumbs, no step grouping. Step mode activates automatically when a `step:init` event is detected.

## UI Features

### Flat Mode (no step protocol)

- Real-time event cards with family-based categorization (message, tool, reasoning, error, file)
- Timestamps: wall-clock time + elapsed since first event
- Family filter pills (Messages, Tools, Reasoning, Errors, Files)
- Collapsible tool details, reasoning blocks, and raw JSON
- Token usage and cost aggregation in footer
- Late join: all buffered events replay on page load

### Step Mode (with step protocol)

Everything in flat mode, plus:

- **Step breadcrumbs**: clickable pills showing each step's status (pending, active, completed, errored)
- **Per-step filtering**: click a step to see only its events; click "All" to see everything
- **Event counts**: each step pill shows how many events it contains
- **Step label on events**: in "All" view, each event card shows which step it belongs to
- **Progress in header**: "Step 2/5: Build" while running
- **Summary in footer**: "3/5 steps completed" when done

## SSE API

Agent-vis exposes a Server-Sent Events stream for programmatic consumers:

### `GET /api/events`

Replays all buffered events and step state, then streams new events in real time.

**Default events** (unnamed, received via `onmessage`):
```
data: {"id":"...","source":"claude","family":"message","text":"Hello",...}
```

**Step protocol events** (named, received via `addEventListener`):
```
event: step:init
data: {"steps":[{"name":"Setup"},{"name":"Build"}]}

event: step:start
data: {"stepIndex":0}

event: step:complete
data: {"stepIndex":0}

event: step:error
data: {"stepIndex":1,"error":"Failed"}

event: finish
data: {}
```

Events tagged with `_stepIndex` when a step is active:
```
data: {"id":"...","family":"tool","toolName":"Bash","_stepIndex":0,...}
```

### `GET /api/state`

Returns current state snapshot:

```json
{
  "source": "claude",
  "eventCount": 42,
  "finished": false,
  "startedAt": "2025-01-01T00:00:00.000Z",
  "stepMode": true,
  "steps": [{"name": "Setup"}, {"name": "Build"}],
  "currentStep": 1,
  "completedSteps": [0]
}
```

## Slack Mode

Stream agent progress into a Slack channel or thread using the Slack
[Thinking Steps for AI agents](https://slack.dev/slack-thinking-steps-ai-agents/)
streaming API (`chat.startStream` / `chat.appendStream` / `chat.stopStream`).

### Setup

1. Create a Slack app and add the **`chat:write`** bot scope.
2. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
3. (Optional) Generate an **App-Level Token** (`xapp-…`) — currently accepted
   for forward compatibility (Socket Mode); not required for streaming.
4. Invite the bot to the target channel and copy the **Channel ID**
   (e.g., `C0123456789`).

### Usage

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_CHANNEL=C0123456789

claude -p "your prompt" --output-format stream-json --verbose \
  | npx @starsea/agent-vis --slack --no-web claude
```

Equivalent with explicit flags:

```bash
... | npx @starsea/agent-vis \
    --slack \
    --slack-bot-token xoxb-... \
    --slack-app-token xapp-... \
    --slack-channel C0123456789 \
    --slack-thread-ts 1721609600.123456 \
    --no-web claude
```

`--slack` can be combined with the web visualizer (omit `--no-web`) to mirror
progress to both surfaces simultaneously.

### Flags / Env Vars

| Flag | Env | Description |
|------|-----|-------------|
| `--slack` | — | Enable Slack streaming sink |
| `--slack-bot-token` | `SLACK_BOT_TOKEN` | Bot token (`xoxb-…`). **Required.** |
| `--slack-app-token` | `SLACK_APP_TOKEN` | App token (`xapp-…`). Optional. |
| `--slack-channel` | `SLACK_CHANNEL` | Channel ID. **Required.** |
| `--slack-thread-ts` | `SLACK_THREAD_TS` | Reply inside an existing thread |
| `--slack-plan-title` | `SLACK_PLAN_TITLE` | Title for the task list (default `Agent Run`) |
| `--slack-task-mode` | `SLACK_TASK_DISPLAY_MODE` | `timeline` (default) or `plan` |
| `--no-web` | — | Don't start the web visualizer (useful for headless/CI) |

### Event mapping

| Source event | Slack chunk |
|--------------|-------------|
| `step:init` | `chat.startStream` with `plan_update` + N `task_update` (status `pending`) |
| `step:start` | `chat.appendStream` `task_update` (status `in_progress`) |
| `step:complete` | `chat.appendStream` `task_update` (status `complete`) |
| `step:error` | `chat.appendStream` `task_update` (status `error`, `details`) |
| Assistant text | Debounced `markdown_text` chunk |
| Tool call started | `task_update` (status `in_progress`) |
| Tool call completed | `task_update` (status `complete` or `error`) |
| stdin closed | `chat.stopStream` |

If no Step Protocol events appear, the run is reported as a single streaming
message containing assistant text and per-tool task cards.

## License

MIT
