import { useState } from "react";
import { Plus, X, Wand2 } from "lucide-react";

interface Step {
  name: string;
  description: string;
}

interface TaskConfig {
  taskName: string;
  taskDescription: string;
  cliTool: "codex" | "claude" | "opencode";
  steps: Step[];
}

interface Props {
  onGenerate: (config: TaskConfig) => void;
}

export default function TaskInput({ onGenerate }: Props) {
  const [taskName, setTaskName] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [cliTool, setCliTool] = useState<"codex" | "claude" | "opencode">(
    "claude",
  );
  const [steps, setSteps] = useState<Step[]>([
    { name: "", description: "" },
  ]);

  const addStep = () => {
    setSteps((prev) => [...prev, { name: "", description: "" }]);
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStep = (
    index: number,
    field: "name" | "description",
    value: string,
  ) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim() || steps.some((s) => !s.name.trim())) return;
    onGenerate({ taskName, taskDescription, cliTool, steps });
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-zinc-100">
          New Task
        </h2>
      </div>

      {/* Task Name */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-zinc-400">
          Task Name
        </label>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="e.g. Add authentication system"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Task Description */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-zinc-400">
          Description
        </label>
        <textarea
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
          placeholder="Describe what you want to accomplish..."
          rows={3}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* CLI Tool Selector */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-zinc-400">
          CLI Tool
        </label>
        <select
          value={cliTool}
          onChange={(e) =>
            setCliTool(e.target.value as "codex" | "claude" | "opencode")
          }
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-zinc-400">
            Steps
          </label>
          <button
            type="button"
            onClick={addStep}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-sm text-zinc-300 transition hover:bg-zinc-700"
          >
            <Plus size={14} />
            Add Step
          </button>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-400">
                  {i + 1}
                </span>
                <input
                  type="text"
                  value={step.name}
                  onChange={(e) => updateStep(i, "name", e.target.value)}
                  placeholder="Step name"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <textarea
                value={step.description}
                onChange={(e) => updateStep(i, "description", e.target.value)}
                placeholder="What should this step accomplish?"
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        disabled={!taskName.trim() || steps.some((s) => !s.name.trim())}
      >
        <Wand2 size={16} />
        Generate
      </button>
    </form>
  );
}
