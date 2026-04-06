import { useState, useEffect, useCallback } from "react";
import { GitBranch } from "lucide-react";
import TaskInput from "./components/TaskInput";
import StepBreadcrumbs from "./components/StepBreadcrumbs";
import AgentOutput from "./components/AgentOutput";
import GitPanel from "./components/GitPanel";
import ControlBar from "./components/ControlBar";

interface Step {
  name: string;
  description: string;
}

interface AppState {
  mode: "input" | "running" | "completed" | "error";
  taskName: string;
  taskDescription: string;
  cliTool: "codex" | "claude" | "opencode";
  steps: Step[];
  currentStep: number;
  events: any[][];
  gitStatus: string;
  gitBranch: string;
  gitBranches: string[];
}

const initialState: AppState = {
  mode: "input",
  taskName: "",
  taskDescription: "",
  cliTool: "claude",
  steps: [],
  currentStep: 0,
  events: [],
  gitStatus: "",
  gitBranch: "main",
  gitBranches: ["main"],
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  // Fetch git info on mount
  useEffect(() => {
    fetchGitInfo();
  }, []);

  const fetchGitInfo = async () => {
    try {
      const [statusRes, branchesRes] = await Promise.all([
        fetch("/api/git/status"),
        fetch("/api/git/branches"),
      ]);
      const statusData = await statusRes.json();
      const branchesData = await branchesRes.json();
      setState((s) => ({
        ...s,
        gitStatus: statusData.status ?? "",
        gitBranch: statusData.branch ?? s.gitBranch,
        gitBranches: branchesData.branches ?? s.gitBranches,
      }));
    } catch {
      // git info is optional
    }
  };

  // SSE connection for live events
  useEffect(() => {
    if (state.mode !== "running") return;

    const es = new EventSource("/api/events");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        switch (data.type) {
          case "step:start":
            setState((s) => ({
              ...s,
              currentStep: data.stepIndex ?? s.currentStep,
            }));
            break;

          case "step:event":
            setState((s) => {
              const stepIdx = data.stepIndex ?? s.currentStep;
              const newEvents = [...s.events];
              if (!newEvents[stepIdx]) newEvents[stepIdx] = [];
              newEvents[stepIdx] = [...newEvents[stepIdx], data.event];
              return { ...s, events: newEvents };
            });
            break;

          case "step:complete":
            setCompletedSteps((prev) => {
              const stepIdx = data.stepIndex ?? 0;
              return prev.includes(stepIdx) ? prev : [...prev, stepIdx];
            });
            break;

          case "step:error":
            setState((s) => ({ ...s, mode: "error" }));
            break;

          case "execution:complete":
            setState((s) => ({ ...s, mode: "completed" }));
            fetchGitInfo();
            break;

          case "execution:error":
            setState((s) => ({ ...s, mode: "error" }));
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [state.mode]);

  const handleStart = useCallback(
    async (config: {
      taskName: string;
      taskDescription: string;
      cliTool: "codex" | "claude" | "opencode";
      steps: Step[];
    }) => {
      setState((s) => ({
        ...s,
        ...config,
        mode: "running",
        currentStep: 0,
        events: config.steps.map(() => []),
      }));
      setCompletedSteps([]);

      try {
        await fetch("/api/execution/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
      } catch {
        setState((s) => ({ ...s, mode: "error" }));
      }
    },
    [],
  );

  const handleStop = useCallback(async () => {
    try {
      await fetch("/api/execution/stop", { method: "POST" });
    } catch {
      // best effort
    }
    setState((s) => ({ ...s, mode: "error" }));
  }, []);

  const handleResume = useCallback(
    async (fromStep: number) => {
      setState((s) => ({
        ...s,
        mode: "running",
        currentStep: fromStep,
      }));
      setCompletedSteps((prev) => prev.filter((i) => i < fromStep));

      try {
        await fetch("/api/execution/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromStep }),
        });
      } catch {
        setState((s) => ({ ...s, mode: "error" }));
      }
    },
    [],
  );

  const handleStepClick = useCallback(
    (index: number) => {
      if (state.mode === "running") {
        // Just view events for that step — don't navigate away from running
        return;
      }
      if (completedSteps.includes(index) || index <= state.currentStep) {
        handleResume(index);
      }
    },
    [state.mode, state.currentStep, completedSteps, handleResume],
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* TopBar */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">StepFlow</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchGitInfo();
              setGitPanelOpen((v) => !v);
            }}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-700"
          >
            <GitBranch size={14} />
            <span>{state.gitBranch}</span>
          </button>
        </div>
      </header>

      {/* Step Breadcrumbs — shown when we have steps */}
      {state.steps.length > 0 && state.mode !== "input" && (
        <StepBreadcrumbs
          steps={state.steps}
          currentStep={state.currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />
      )}

      {/* Main content */}
      <main className="relative flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          {state.mode === "input" && <TaskInput onSubmit={handleStart} />}

          {(state.mode === "running" ||
            state.mode === "completed" ||
            state.mode === "error") && (
            <AgentOutput
              events={state.events[state.currentStep] ?? []}
              stepName={
                state.steps[state.currentStep]?.name ??
                `Step ${state.currentStep + 1}`
              }
              isRunning={state.mode === "running"}
            />
          )}
        </div>

        {/* Git Panel Sidebar */}
        {gitPanelOpen && (
          <div className="w-96 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
            <GitPanel cwd="" />
          </div>
        )}
      </main>

      {/* Control Bar */}
      {state.mode !== "input" && (
        <ControlBar
          mode={state.mode}
          currentStep={state.currentStep}
          totalSteps={state.steps.length}
          onStart={() =>
            handleStart({
              taskName: state.taskName,
              taskDescription: state.taskDescription,
              cliTool: state.cliTool,
              steps: state.steps,
            })
          }
          onStop={handleStop}
          onResume={handleResume}
        />
      )}
    </div>
  );
}
