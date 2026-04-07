import { useState } from "react";
import {
  Compass,
  RefreshCw,
  MessageSquare,
  Brain,
  Terminal,
  Map,
  FileText,
  Radio,
  Package,
  Anchor,
  Clock,
  AlertTriangle,
  Waves,
  Circle,
} from "lucide-react";

interface Props {
  event: any; // NormalizedEvent
  index: number;
}

const FAMILY_CONFIG: Record<string, { emoji: string; label: string; icon: any; color: string }> = {
  session:    { emoji: "\uD83E\uDDED", label: "session",    icon: Compass,         color: "text-blue-400" },
  turn:       { emoji: "\uD83D\uDD04", label: "turn",       icon: RefreshCw,       color: "text-cyan-400" },
  message:    { emoji: "\uD83D\uDCAC", label: "message",    icon: MessageSquare,   color: "text-green-400" },
  reasoning:  { emoji: "\uD83E\uDDE0", label: "reasoning",  icon: Brain,           color: "text-purple-400" },
  tool:       { emoji: "\uD83D\uDEE0", label: "tool",       icon: Terminal,        color: "text-orange-400" },
  plan:       { emoji: "\uD83D\uDDFA", label: "plan",       icon: Map,             color: "text-indigo-400" },
  file:       { emoji: "\uD83D\uDCC4", label: "file",       icon: FileText,        color: "text-teal-400" },
  status:     { emoji: "\uD83D\uDCE1", label: "status",     icon: Radio,           color: "text-sky-400" },
  task:       { emoji: "\uD83D\uDCE6", label: "task",       icon: Package,         color: "text-yellow-400" },
  hook:       { emoji: "\uD83E\uDE9D", label: "hook",       icon: Anchor,          color: "text-pink-400" },
  rate_limit: { emoji: "\u23F3",       label: "rate_limit", icon: Clock,           color: "text-amber-400" },
  error:      { emoji: "\u26A0\uFE0F", label: "error",      icon: AlertTriangle,   color: "text-red-400" },
  stream:     { emoji: "\uD83D\uDCE1", label: "stream",     icon: Waves,           color: "text-sky-400" },
  meta:       { emoji: "\u00B7",       label: "meta",       icon: Circle,          color: "text-zinc-500" },
};

const PHASE_COLORS: Record<string, string> = {
  started:   "bg-blue-500/20 text-blue-300",
  updated:   "bg-zinc-700/50 text-zinc-400",
  completed: "bg-emerald-500/20 text-emerald-300",
  failed:    "bg-red-500/20 text-red-300",
};

function formatOutput(val: any): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  return JSON.stringify(val, null, 2);
}

export default function EventCard({ event, index }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = FAMILY_CONFIG[event.family] ?? FAMILY_CONFIG.meta;
  const Icon = config.icon;
  const phaseClass = PHASE_COLORS[event.phase] ?? PHASE_COLORS.updated;
  const isError = event.family === "error";
  const isReasoning = event.family === "reasoning";
  const isTool = event.family === "tool";
  const isMessage = event.family === "message";

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        isError
          ? "border-red-800 bg-red-950/40"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-600 font-mono w-8 text-right shrink-0">
          {index + 1}
        </span>
        <Icon className={`w-4 h-4 shrink-0 ${config.color}`} />
        <span className={`font-medium ${config.color}`}>{config.label}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${phaseClass}`}>
          {event.phase}
        </span>
        {event.actor && (
          <span className="text-xs text-zinc-500">
            {event.actor}
          </span>
        )}
        {isTool && event.toolName && (
          <span className="text-xs text-orange-300 font-mono">
            {event.toolName}
          </span>
        )}
        {isTool && event.command && (
          <code className="text-xs text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded truncate max-w-xs">
            {event.command}
          </code>
        )}
        <span className="text-xs text-zinc-600 ml-auto font-mono">
          {event.rawType}{event.rawSubType ? `:${event.rawSubType}` : ""}
        </span>
      </div>

      {/* Message text */}
      {isMessage && event.text && (
        <div className="mt-1.5 ml-10 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
          {event.text}
        </div>
      )}

      {/* Reasoning (collapsed by default) */}
      {isReasoning && event.text && (
        <details className="mt-1.5 ml-10">
          <summary className="text-xs text-purple-400 cursor-pointer hover:text-purple-300">
            Show reasoning
          </summary>
          <div className="mt-1 text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {event.text}
          </div>
        </details>
      )}

      {/* Tool output (expandable) */}
      {isTool && (event.output || event.input) && (
        <details className="mt-1.5 ml-10" open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
          <summary className="text-xs text-orange-400 cursor-pointer hover:text-orange-300">
            {expanded ? "Hide" : "Show"} details
          </summary>
          {event.input && (
            <div className="mt-1">
              <span className="text-xs text-zinc-500">Input:</span>
              <pre className="text-xs text-zinc-400 bg-zinc-800/60 rounded p-2 mt-0.5 overflow-x-auto max-h-48">
                {formatOutput(event.input)}
              </pre>
            </div>
          )}
          {event.output && (
            <div className="mt-1">
              <span className="text-xs text-zinc-500">Output:</span>
              <pre className="text-xs text-zinc-400 bg-zinc-800/60 rounded p-2 mt-0.5 overflow-x-auto max-h-48">
                {formatOutput(event.output)}
              </pre>
            </div>
          )}
        </details>
      )}

      {/* Error text */}
      {isError && event.error && (
        <div className="mt-1.5 ml-10 text-sm text-red-300 whitespace-pre-wrap">
          {event.error}
        </div>
      )}

      {/* File changes */}
      {event.family === "file" && event.fileChanges && (
        <div className="mt-1.5 ml-10 space-y-0.5">
          {event.fileChanges.map((fc: any, i: number) => (
            <div key={i} className="text-xs text-teal-300 font-mono">
              {fc.path ?? fc.file ?? JSON.stringify(fc)}
            </div>
          ))}
        </div>
      )}

      {/* Plan items */}
      {event.family === "plan" && event.plan && (
        <ul className="mt-1.5 ml-10 space-y-0.5">
          {event.plan.map((item: any, i: number) => (
            <li key={i} className="text-xs text-indigo-300">
              {typeof item === "string" ? item : item.title ?? item.text ?? JSON.stringify(item)}
            </li>
          ))}
        </ul>
      )}

      {/* Status */}
      {event.family === "status" && event.status && (
        <div className="mt-1 ml-10 text-xs text-sky-300">
          {typeof event.status === "string" ? event.status : JSON.stringify(event.status)}
        </div>
      )}

      {/* Stream text */}
      {event.family === "stream" && event.text && (
        <div className="mt-1 ml-10 text-sm text-zinc-400">
          {event.text}
        </div>
      )}
    </div>
  );
}
