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
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface Props {
  event: any; // NormalizedEvent
  index: number;
  firstReceivedAt?: string;
}

const FAMILY_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  session:    { label: "session",    icon: Compass,       color: "text-blue-400",   bg: "bg-blue-500/10" },
  turn:       { label: "turn",       icon: RefreshCw,     color: "text-cyan-400",   bg: "bg-cyan-500/10" },
  message:    { label: "message",    icon: MessageSquare, color: "text-green-400",  bg: "bg-green-500/10" },
  reasoning:  { label: "reasoning",  icon: Brain,         color: "text-purple-400", bg: "bg-purple-500/10" },
  tool:       { label: "tool",       icon: Terminal,      color: "text-orange-400", bg: "bg-orange-500/10" },
  plan:       { label: "plan",       icon: Map,           color: "text-indigo-400", bg: "bg-indigo-500/10" },
  file:       { label: "file",       icon: FileText,      color: "text-teal-400",   bg: "bg-teal-500/10" },
  status:     { label: "status",     icon: Radio,         color: "text-sky-400",    bg: "bg-sky-500/10" },
  task:       { label: "task",       icon: Package,       color: "text-yellow-400", bg: "bg-yellow-500/10" },
  hook:       { label: "hook",       icon: Anchor,        color: "text-pink-400",   bg: "bg-pink-500/10" },
  rate_limit: { label: "rate_limit", icon: Clock,         color: "text-amber-400",  bg: "bg-amber-500/10" },
  error:      { label: "error",      icon: AlertTriangle, color: "text-red-400",    bg: "bg-red-500/10" },
  stream:     { label: "stream",     icon: Waves,         color: "text-sky-400",    bg: "bg-sky-500/10" },
  meta:       { label: "meta",       icon: Circle,        color: "text-zinc-500",   bg: "bg-zinc-500/10" },
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

function formatElapsed(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `+${m}m${s}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 2,
    hour12: false,
  } as any);
}

export default function EventCard({ event, index, firstReceivedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = FAMILY_CONFIG[event.family] ?? FAMILY_CONFIG.meta;
  const Icon = config.icon;
  const phaseClass = PHASE_COLORS[event.phase] ?? PHASE_COLORS.updated;
  const isError = event.family === "error";
  const isReasoning = event.family === "reasoning";
  const isTool = event.family === "tool";
  const isMessage = event.family === "message";

  // Elapsed time from first event
  let elapsed: string | null = null;
  let timestamp: string | null = null;
  if (event.receivedAt) {
    timestamp = formatTimestamp(event.receivedAt);
    if (firstReceivedAt) {
      const ms = new Date(event.receivedAt).getTime() - new Date(firstReceivedAt).getTime();
      elapsed = formatElapsed(ms);
    }
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        isError
          ? "border-red-800 bg-red-950/40"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-600 font-mono w-8 text-right shrink-0">
          {index + 1}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${config.color} ${config.bg}`}>
          <Icon className="w-3.5 h-3.5" />
          {config.label}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${phaseClass}`}>
          {event.phase}
        </span>
        {event.actor && (
          <span className="text-xs text-zinc-500">
            {event.actor}
          </span>
        )}
        {isTool && event.toolName && (
          <span className="text-xs text-orange-300 font-mono bg-orange-500/10 px-1.5 py-0.5 rounded">
            {event.toolName}
          </span>
        )}
        {isTool && event.command && (
          <code className="text-xs text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded truncate max-w-xs">
            {event.command}
          </code>
        )}

        {/* Right side: timestamp + rawType */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {elapsed && (
            <span className="text-xs text-zinc-500 font-mono">{elapsed}</span>
          )}
          {timestamp && (
            <span className="text-xs text-zinc-600 font-mono">{timestamp}</span>
          )}
          <span className="text-xs text-zinc-700 font-mono">
            {event.rawType}{event.rawSubType ? `:${event.rawSubType}` : ""}
          </span>
        </div>
      </div>

      {/* Message text */}
      {isMessage && event.text && (
        <div className="mt-1.5 ml-10 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
          {event.text}
        </div>
      )}

      {/* Reasoning (collapsed by default) */}
      {isReasoning && event.text && (
        <details className="mt-1.5 ml-10 group">
          <summary className="text-xs text-purple-400 cursor-pointer hover:text-purple-300 flex items-center gap-1 select-none">
            <ChevronRight className="w-3 h-3 group-open:hidden" />
            <ChevronDown className="w-3 h-3 hidden group-open:block" />
            Show reasoning ({event.text.length} chars)
          </summary>
          <div className="mt-1 text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed border-l-2 border-purple-500/20 pl-3">
            {event.text}
          </div>
        </details>
      )}

      {/* Tool output (expandable) */}
      {isTool && (event.output || event.input) && (
        <details
          className="mt-1.5 ml-10 group"
          open={expanded}
          onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
        >
          <summary className="text-xs text-orange-400 cursor-pointer hover:text-orange-300 flex items-center gap-1 select-none">
            <ChevronRight className="w-3 h-3 group-open:hidden" />
            <ChevronDown className="w-3 h-3 hidden group-open:block" />
            {expanded ? "Hide" : "Show"} details
          </summary>
          {event.input && (
            <div className="mt-1">
              <span className="text-xs text-zinc-500">Input:</span>
              <pre className="text-xs text-zinc-400 bg-zinc-800/60 rounded p-2 mt-0.5 overflow-x-auto max-h-48 border border-zinc-800">
                {formatOutput(event.input)}
              </pre>
            </div>
          )}
          {event.output && (
            <div className="mt-1">
              <span className="text-xs text-zinc-500">Output:</span>
              <pre className="text-xs text-zinc-400 bg-zinc-800/60 rounded p-2 mt-0.5 overflow-x-auto max-h-48 border border-zinc-800">
                {formatOutput(event.output)}
              </pre>
            </div>
          )}
        </details>
      )}

      {/* Error text */}
      {isError && event.error && (
        <div className="mt-1.5 ml-10 text-sm text-red-300 whitespace-pre-wrap bg-red-500/5 rounded p-2 border border-red-900/30">
          {event.error}
        </div>
      )}

      {/* File changes */}
      {event.family === "file" && event.fileChanges && (
        <div className="mt-1.5 ml-10 space-y-0.5">
          {event.fileChanges.map((fc: any, i: number) => (
            <div key={i} className="text-xs text-teal-300 font-mono flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-teal-500" />
              {fc.path ?? fc.file ?? JSON.stringify(fc)}
            </div>
          ))}
        </div>
      )}

      {/* Plan items */}
      {event.family === "plan" && event.plan && (
        <ul className="mt-1.5 ml-10 space-y-0.5">
          {event.plan.map((item: any, i: number) => (
            <li key={i} className="text-xs text-indigo-300 flex items-center gap-1.5">
              <span className="text-indigo-500">{i + 1}.</span>
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

      {/* Usage/cost inline (for turn/result events) */}
      {(event.family === "turn" || event.rawType === "result") && (event.usage || event.costUsd) && (
        <div className="mt-1.5 ml-10 flex items-center gap-3 text-xs text-zinc-500">
          {event.usage && (event.usage.input_tokens || event.usage.prompt_tokens) && (
            <span>
              {(event.usage.input_tokens || event.usage.prompt_tokens || 0).toLocaleString()} in
              {" / "}
              {(event.usage.output_tokens || event.usage.completion_tokens || 0).toLocaleString()} out
            </span>
          )}
          {event.costUsd != null && event.costUsd > 0 && (
            <span className="text-amber-400/70">${event.costUsd.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}
