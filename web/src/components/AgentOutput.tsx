import { useEffect, useRef, useState } from "react";
import {
  Compass,
  RefreshCw,
  MessageSquare,
  Brain,
  Wrench,
  FileText,
  AlertTriangle,
  ChevronDown,
  Terminal,
} from "lucide-react";

interface Props {
  events: any[];
  stepName: string;
  isRunning: boolean;
}

function eventIcon(family: string) {
  switch (family) {
    case "session":
      return <Compass size={14} className="text-zinc-400" />;
    case "turn":
      return <RefreshCw size={14} className="text-zinc-400" />;
    case "message":
      return <MessageSquare size={14} className="text-blue-400" />;
    case "reasoning":
      return <Brain size={14} className="text-purple-400" />;
    case "tool":
      return <Wrench size={14} className="text-amber-400" />;
    case "plan":
      return <Terminal size={14} className="text-teal-400" />;
    case "file":
      return <FileText size={14} className="text-green-400" />;
    case "status":
      return <Compass size={14} className="text-cyan-400" />;
    case "error":
      return <AlertTriangle size={14} className="text-red-400" />;
    default:
      return <Compass size={14} className="text-zinc-600" />;
  }
}

function EventCard({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);
  const family: string = event.family ?? "meta";

  if (family === "meta") {
    return null;
  }

  if (family === "error") {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3">
        <div className="flex items-center gap-2">
          {eventIcon(family)}
          <span className="text-sm font-medium text-red-400">Error</span>
        </div>
        <p className="mt-1 text-sm text-red-300">
          {event.error ?? event.text ?? JSON.stringify(event)}
        </p>
      </div>
    );
  }

  if (family === "message") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-1 flex items-center gap-2">
          {eventIcon(family)}
          <span className="text-xs text-zinc-500">
            {event.role ?? "assistant"}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {event.text ?? event.content ?? ""}
        </p>
      </div>
    );
  }

  if (family === "reasoning") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          {eventIcon(family)}
          <span className="text-xs font-medium text-purple-400">Thinking</span>
          <ChevronDown
            size={12}
            className={`ml-auto text-zinc-500 transition ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {expanded && (
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
            {event.text ?? event.content ?? ""}
          </p>
        )}
      </div>
    );
  }

  if (family === "tool") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          {eventIcon(family)}
          <span className="text-xs font-medium text-amber-400">
            {event.toolName ?? event.name ?? "Tool"}
          </span>
          {event.command && (
            <code className="ml-1 truncate rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
              {event.command}
            </code>
          )}
          <ChevronDown
            size={12}
            className={`ml-auto shrink-0 text-zinc-500 transition ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {event.input && (
              <pre className="overflow-x-auto rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
                {typeof event.input === "string"
                  ? event.input
                  : JSON.stringify(event.input, null, 2)}
              </pre>
            )}
            {event.output && (
              <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
                {typeof event.output === "string"
                  ? event.output
                  : JSON.stringify(event.output, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  if (family === "plan") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-1 flex items-center gap-2">
          {eventIcon(family)}
          <span className="text-xs font-medium text-teal-400">Plan</span>
        </div>
        {Array.isArray(event.items) ? (
          <ul className="ml-5 list-disc space-y-0.5 text-sm text-zinc-300">
            {event.items.map((item: string, i: number) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-300">
            {event.text ?? JSON.stringify(event)}
          </p>
        )}
      </div>
    );
  }

  if (family === "file") {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center gap-2">
          {eventIcon(family)}
          <span className="font-mono text-xs text-green-400">
            {event.path ?? event.file ?? "file"}
          </span>
          {event.action && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
              {event.action}
            </span>
          )}
        </div>
      </div>
    );
  }

  // session, status, other
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      {eventIcon(family)}
      <span className="text-xs text-zinc-500">
        {event.text ?? event.status ?? family}
      </span>
    </div>
  );
}

export default function AgentOutput({ events, stepName, isRunning }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll on new events
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, autoScroll]);

  // Detect user scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAutoScroll(atBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">{stepName}</h2>
        {isRunning && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            Running
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative flex-1 space-y-2 overflow-y-auto"
      >
        {events.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-500">
            {isRunning ? "Waiting for events..." : "No events yet."}
          </div>
        )}

        {events.map((event, i) => (
          <EventCard key={i} event={event} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-8 rounded-full bg-zinc-800 p-2 text-zinc-400 shadow-lg transition hover:bg-zinc-700 hover:text-zinc-200"
        >
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
