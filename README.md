# StepFlow Monorepo

A suite of tools for orchestrating and visualizing agent CLI tasks (Claude Code, Codex, OpenCode).

<p align="center">
  <img src="docs/screenshot-input.png" width="320" alt="Task input form" />
  <img src="docs/screenshot-filled.png" width="320" alt="Filled form with steps" />
  <img src="docs/screenshot-review.png" width="320" alt="Prompt editor with shared and step prompts" />
</p>

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@starsea/stepflow`](packages/stepflow/) | 0.3.0 | Step-based agent orchestrator with live web UI |
| [`@starsea/agent-vis`](packages/agent-vis/) | 0.1.0 | Pipe agent JSONL output to a live web visualizer |
| [`@starsea/normalizer`](packages/normalizer/) | 0.1.0 | Shared JSONL event normalizer for codex/claude/opencode |

## Quick Start

### StepFlow — Multi-step orchestrator

```bash
npx @starsea/stepflow
```

Opens `http://localhost:3120`. Define tasks, break them into steps, review/edit prompts, then execute with real-time streaming.

### Agent Vis — Pipe any agent output to a web UI

```bash
claude --dangerously-skip-permissions -p --verbose --output-format stream-json "your prompt" \
  | npx @starsea/agent-vis claude
```

Opens `http://localhost:3130`. Works with any of the three CLIs:

```bash
# Codex
codex exec --json "your prompt" | npx @starsea/agent-vis codex

# OpenCode
opencode run --format json "your prompt" | npx @starsea/agent-vis opencode
```

## Prerequisites

You need **at least one** of these CLI tools installed:

| CLI | Install |
|-----|---------|
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex | `npm i -g @openai/codex` |
| OpenCode | `go install github.com/opencode-ai/opencode@latest` |

## StepFlow Workflow

### 1. Define your task

Give it a name, description, pick a CLI tool, and break it into ordered steps.

### 2. Generate

Click **Generate** — StepFlow creates prompt files on disk:

```
.stepflow/
├── shared-prompt.md          # shared context for all steps
├── step-01-setup/
│   └── prompt.md             # this step's specific prompt
├── step-02-implement/
│   └── prompt.md
└── step-03-test/
    └── prompt.md
```

### 3. Review & Edit Prompts

The UI switches to a **prompt editor** where you can fine-tune:
- **Shared prompt** — task-level context injected into every step
- **Per-step prompts** — each step's specific instructions

Edit as much as you need. These are plain markdown files — you can also edit them in your IDE.

### 4. Commit

Use the built-in **Git Panel** to commit your prompt files before execution.

### 5. Start Execution

Click **Start Execution** when ready. Each step:
- Reads its `prompt.md` + the shared prompt from disk
- Injects the previous step's `result.md` as context
- Runs the agent CLI in JSONL streaming mode
- Produces a `result.md` that feeds into the next step

## Agent Vis Features

- **Zero config** — just pipe and go
- **Real-time SSE streaming** — events appear as they arrive
- **Event categorization** — messages, tool calls, reasoning, file changes, errors
- **Collapsible details** — expand tool calls and reasoning blocks
- **Late join** — open the browser any time, all buffered events replay instantly
- **Auto-detection** — pass `codex`, `claude`, or `opencode` as the source argument

## Web UI Features

### Live Agent Output

Events from the agent CLI are parsed and categorized in real time:
- **Messages** — assistant text output
- **Tool calls** — commands, file edits, MCP tools (collapsible details)
- **Reasoning** — model thinking (collapsible)
- **File changes** — created/modified files
- **Errors** — highlighted in red

### Step Breadcrumbs

Horizontal step indicators: completed (green), active (blue, animated), pending (gray). Click any completed step to resume from there.

### Git Panel

Built-in git operations: view/switch branches, create branches, view status/diff, commit changes.

## JSONL Event Normalization

All three packages share a unified event schema via `@starsea/normalizer` (adapted from [blue-core](https://github.com/victor-develop/blue-core)):

```ts
interface NormalizedEvent {
  id: string;
  source: "codex" | "claude" | "opencode";
  family: "message" | "tool" | "reasoning" | "file" | "plan" | "error" | ...;
  phase: "started" | "updated" | "completed" | "failed";
  text?: string;
  toolName?: string;
  command?: string;
}
```

## Monorepo Structure

```
stepflow/
├── packages/
│   ├── normalizer/         @starsea/normalizer — shared JSONL normalizer
│   │   ├── src/index.ts
│   │   └── tests/
│   ├── stepflow/           @starsea/stepflow — orchestrator + web UI
│   │   ├── bin/stepflow.mjs
│   │   ├── src/            server, executor, script-gen, git-ops
│   │   └── web/            React + Tailwind frontend
│   └── agent-vis/          @starsea/agent-vis — pipe visualizer
│       ├── bin/agent-vis.mjs
│       ├── src/server.ts
│       └── web/            React + Tailwind frontend
├── docs/                   Screenshots
└── package.json            npm workspaces root
```

## API

### StepFlow API (port 3120)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate prompt files from task + steps |
| `/api/prompts` | GET | Read all prompt files |
| `/api/prompts` | PUT | Save edited prompts to disk |
| `/api/execute` | POST | Start execution |
| `/api/stop` | POST | Stop current execution |
| `/api/resume` | POST | Resume from a specific step |
| `/api/events` | GET | SSE stream of execution events |
| `/api/status` | GET | Current execution state |
| `/api/git/*` | GET/POST | Git operations |

### Agent Vis API (port 3130)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | SSE stream (replays buffered events) |
| `/api/state` | GET | Current state + all buffered events |

## Development

```bash
git clone https://github.com/victor-develop/stepflow.git
cd stepflow
npm install
npm run build --workspaces
npm test --workspaces
```

## License

MIT
