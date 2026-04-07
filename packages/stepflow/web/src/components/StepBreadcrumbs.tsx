import { Check, Circle, Loader2 } from "lucide-react";

interface Props {
  steps: Array<{ name: string }>;
  currentStep: number;
  completedSteps: number[];
  onStepClick: (index: number) => void;
}

export default function StepBreadcrumbs({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: Props) {
  return (
    <div className="overflow-x-auto border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="flex items-center gap-1 whitespace-nowrap">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.includes(i);
          const isActive = i === currentStep;
          const isPending = !isCompleted && !isActive;

          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div
                  className={`mx-2 h-px w-6 ${
                    isCompleted || isActive ? "bg-blue-500/50" : "bg-zinc-700"
                  }`}
                />
              )}
              <button
                onClick={() => onStepClick(i)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "bg-blue-500/15 text-blue-400"
                    : isCompleted
                      ? "cursor-pointer text-green-400 hover:bg-zinc-800"
                      : "cursor-default text-zinc-500"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  {isCompleted ? (
                    <Check size={14} className="text-green-400" />
                  ) : isActive ? (
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                  ) : (
                    <Circle size={14} className="text-zinc-600" />
                  )}
                </span>
                <span className="max-w-32 truncate">{step.name}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
