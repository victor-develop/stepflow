import { useState } from "react";
import { Play, Square, SkipForward, ChevronDown } from "lucide-react";

interface Props {
  mode: "input" | "running" | "completed" | "error";
  currentStep: number;
  totalSteps: number;
  onStart: () => void;
  onStop: () => void;
  onResume: (fromStep: number) => void;
}

export default function ControlBar({
  mode,
  currentStep,
  totalSteps,
  onStart,
  onStop,
  onResume,
}: Props) {
  const [resumeStep, setResumeStep] = useState(0);

  return (
    <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/80 px-4 py-3">
      {/* Step progress */}
      <div className="text-sm text-zinc-400">
        {mode === "running" && (
          <span>
            Step {currentStep + 1}/{totalSteps}
          </span>
        )}
        {mode === "completed" && (
          <span className="text-green-400">All steps completed</span>
        )}
        {mode === "error" && (
          <span className="text-red-400">
            Stopped at step {currentStep + 1}/{totalSteps}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Start — visible in completed mode */}
        {(mode === "completed" || mode === "error") && (
          <button
            onClick={onStart}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            <Play size={14} />
            Re-run
          </button>
        )}

        {/* Stop — visible in running mode */}
        {mode === "running" && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            <Square size={14} />
            Stop
          </button>
        )}

        {/* Resume — visible in completed/error mode */}
        {(mode === "completed" || mode === "error") && totalSteps > 1 && (
          <div className="flex items-center gap-1">
            <div className="relative">
              <select
                value={resumeStep}
                onChange={(e) => setResumeStep(Number(e.target.value))}
                className="appearance-none rounded-l-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-7 text-sm text-zinc-100 outline-none transition focus:border-blue-500"
              >
                {Array.from({ length: totalSteps }, (_, i) => (
                  <option key={i} value={i}>
                    Step {i + 1}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
              />
            </div>
            <button
              onClick={() => onResume(resumeStep)}
              className="flex items-center gap-1.5 rounded-r-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700"
            >
              <SkipForward size={14} />
              Resume
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
