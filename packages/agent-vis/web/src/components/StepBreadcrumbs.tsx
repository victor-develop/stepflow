import { Check, Circle, Loader2, AlertTriangle, List } from "lucide-react";

interface StepDef { name: string; description?: string; }

interface Props {
  steps: StepDef[];
  currentStep: number;
  completedSteps: number[];
  erroredSteps: Map<number, string>;
  viewedStep: number | null;
  eventCounts: Record<number, number>;
  onStepClick: (index: number) => void;
  onShowAll: () => void;
}

export default function StepBreadcrumbs({
  steps,
  currentStep,
  completedSteps,
  erroredSteps,
  viewedStep,
  eventCounts,
  onStepClick,
  onShowAll,
}: Props) {
  return (
    <div className="overflow-x-auto border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 shrink-0">
      <div className="flex items-center gap-1 whitespace-nowrap">
        {/* "All" button */}
        <button
          onClick={onShowAll}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition border ${
            viewedStep === null
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
          }`}
        >
          <List className="w-3.5 h-3.5" />
          All
        </button>

        <div className="mx-2 h-px w-4 bg-zinc-700" />

        {steps.map((step, i) => {
          const isCompleted = completedSteps.includes(i);
          const isErrored = erroredSteps.has(i);
          const isActive = i === currentStep && !isCompleted && !isErrored;
          const isViewed = viewedStep === i;
          const count = eventCounts[i] || 0;

          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div
                  className={`mx-1.5 h-px w-5 ${
                    isCompleted ? "bg-emerald-500/40" : isErrored ? "bg-red-500/40" : isActive ? "bg-blue-500/40" : "bg-zinc-700"
                  }`}
                />
              )}
              <button
                onClick={() => onStepClick(i)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition border ${
                  isViewed
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                    : isErrored
                      ? "border-red-800/50 text-red-400 hover:bg-red-500/10"
                      : isCompleted
                        ? "border-zinc-700 text-emerald-400 hover:bg-zinc-800"
                        : isActive
                          ? "border-blue-800/50 text-blue-400"
                          : "border-zinc-800 text-zinc-500"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {isErrored ? (
                    <AlertTriangle size={12} className="text-red-400" />
                  ) : isCompleted ? (
                    <Check size={12} className="text-emerald-400" />
                  ) : isActive ? (
                    <Loader2 size={12} className="animate-spin text-blue-400" />
                  ) : (
                    <Circle size={12} className="text-zinc-600" />
                  )}
                </span>
                <span className="max-w-28 truncate">{step.name}</span>
                {count > 0 && (
                  <span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
