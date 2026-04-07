import { Save, Check } from "lucide-react";

interface StepPrompt {
  index: number;
  name: string;
  dirName: string;
  prompt: string;
}

interface Props {
  sharedPrompt: string;
  stepPrompts: StepPrompt[];
  onSharedPromptChange: (value: string) => void;
  onStepPromptChange: (index: number, value: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

export default function PromptEditor({
  sharedPrompt,
  stepPrompts,
  onSharedPromptChange,
  onStepPromptChange,
  onSave,
  saving,
  saved,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Shared Prompt */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">Shared Prompt</h3>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-zinc-600 disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check size={14} className="text-green-400" />
                <span className="text-green-400">Saved!</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>{saving ? "Saving..." : "Save"}</span>
              </>
            )}
          </button>
        </div>
        <textarea
          value={sharedPrompt}
          onChange={(e) => onSharedPromptChange(e.target.value)}
          className="min-h-[200px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Shared prompt content..."
        />
      </div>

      {/* Step Prompts */}
      {stepPrompts.map((step) => (
        <div key={step.index} className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">
            Step {step.index + 1}: {step.name}
          </h3>
          <textarea
            value={step.prompt}
            onChange={(e) => onStepPromptChange(step.index, e.target.value)}
            className="min-h-[120px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder={`Prompt for step ${step.index + 1}...`}
          />
        </div>
      ))}
    </div>
  );
}
