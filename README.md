# StepFlow

Step-based agent orchestrator with a live web UI. Break complex tasks into steps, then let [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex) or [OpenCode](https://github.com/opencode-ai/opencode) execute them one by one — with real-time streaming, step-level control, and git integration.

<p align="center">
  <img src="docs/screenshot-input.png" width="380" alt="Task input form" />
  <img src="docs/screenshot-filled.png" width="380" alt="Filled form with steps" />
</p>

## Quick Start

```bash
npx @starsea/stepflow
```

Opens `http://localhost:3120` in your browser. That's it.

### Custom port

```bash
npx @starsea/stepflow --port 8080
```

## Prerequisites

You need **at least one** of these CLI tools installed locally:

| CLI | Install |
|-----|---------|
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Codex | `npm i -g @openai/codex` |
| OpenCode | `go install github.com/opencode-ai/opencode@latest` |

## How It Works

1. **Define your task** — Give it a name, description, and break it into ordered steps
2. **Pick your CLI tool** — Claude Code, Codex, or OpenCode
3. **Hit Generate & Start** — StepFlow generates a bash orchestration script and begins execution
4. **Watch it work** — Each step runs the agent CLI in JSONL mode; the web UI parses and displays events in real time
5. **Step handoff** — Every step produces a `result.md` (up to 500 lines) that feeds into the next step's prompt as context

### Step isolation

Each step runs in its own directory under `.stepflow/`:

```
.stepflow/
├── step-01-setup/
│   ├── output.jsonl    # raw JSONL events
│   └── result.md       # step summary → fed to next step
├── step-02-implement/
│   ├── output.jsonl
│   └── result.md
└── step-03-test/
    ├── output.jsonl
    └── result.md
```

## Web UI Features

### Live Agent Output

Events from the agent CLI are parsed and categorized in real time:

- **Messages** — assistant text output
- **Tool calls** — commands, file edits, MCP tools (collapsible details)
- **Reasoning** — model thinking (collapsible)
- **File changes** — created/modified files
- **Plans** — todo lists and task breakdowns
- **Errors** — highlighted in red

### Step Breadcrumbs

Horizontal step indicators at the top:
- Completed steps (green)
- Active step (blue, animated)
- Pending steps (gray)
- Click any completed step to resume from there

### Execution Controls

- **Start** — begin execution from step 1
- **Stop** — terminate the current agent process
- **Resume from Step N** — re-run from any step (keeps previous results)

### Git Panel

Built-in git operations without leaving the UI:
- View current branch and switch branches
- Create new branches
- View git status and diff
- Commit changes with a message

## Architecture

```
bin/stepflow.mjs          CLI entry point (npx)
src/
├── server.ts             Express server — REST API + SSE
├── normalizer.ts         JSONL event parser (codex/claude/opencode)
├── executor.ts           Step-by-step CLI execution engine
├── script-gen.ts         Standalone bash script generator
└── git-ops.ts            Git operations
web/
├── App.tsx               Main React app
└── components/
    ├── TaskInput.tsx      Task & step input form
    ├── StepBreadcrumbs.tsx  Step progress indicators
    ├── AgentOutput.tsx    Live event stream display
    ├── GitPanel.tsx       Git operations sidebar
    └── ControlBar.tsx     Start/Stop/Resume controls
```

### JSONL Event Normalization

StepFlow normalizes the different JSONL output formats from each CLI into a unified event schema (adapted from [blue-core](https://github.com/victor-develop/blue-core)):

```ts
interface NormalizedEvent {
  id: string;
  source: "codex" | "claude" | "opencode";
  family: "message" | "tool" | "reasoning" | "file" | "plan" | "error" | ...;
  phase: "started" | "updated" | "completed" | "failed";
  text?: string;
  toolName?: string;
  command?: string;
  // ...
}
```

This abstraction means the UI works identically regardless of which CLI backend you choose.

## API

StepFlow exposes a REST API on the same port:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate bash script from task + steps |
| `/api/execute` | POST | Start execution |
| `/api/stop` | POST | Stop current execution |
| `/api/resume` | POST | Resume from a specific step |
| `/api/events` | GET | SSE stream of execution events |
| `/api/status` | GET | Current execution state |
| `/api/git/status` | GET | Git status |
| `/api/git/branches` | GET | List branches |
| `/api/git/commit` | POST | Create a commit |
| `/api/git/checkout` | POST | Switch/create branch |
| `/api/git/diff` | GET | Git diff |

## Development

```bash
git clone https://github.com/victor-develop/stepflow.git
cd stepflow
npm install
npm run build
npm test           # 73 tests
npm run dev        # start dev server
```

## License

MIT
