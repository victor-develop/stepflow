import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Activity, ArrowUp, CheckCircle, Filter, X } from "lucide-react";
import EventCard from "./components/EventCard";

interface NormalizedEvent {
  id: string;
  source: string;
  rawType: string;
  rawSubType: string | null;
  family: string;
  phase: string;
  actor?: string;
  text?: string;
  toolKind?: string;
  toolName?: string;
  command?: string;
  input?: any;
  output?: any;
  error?: string | null;
  status?: any;
  fileChanges?: any[];
  plan?: any[];
  exitCode?: number | null;
  usage?: any;
  costUsd?: number | null;
  receivedAt?: string;
  raw: any;
}

type FamilyFilter = string;

const FILTER_PILLS: { family: FamilyFilter; label: string; color: string }[] = [
  { family: "message",   label: "Messages",  color: "bg-green-500/20 text-green-300 border-green-500/40" },
  { family: "tool",      label: "Tools",     color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
  { family: "reasoning", label: "Reasoning", color: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
  { family: "error",     label: "Errors",    color: "bg-red-500/20 text-red-300 border-red-500/40" },
  { family: "file",      label: "Files",     color: "bg-teal-500/20 text-teal-300 border-teal-500/40" },
];

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m${s}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function App() {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [finished, setFinished] = useState(false);
  const [source, setSource] = useState("claude");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<FamilyFilter>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch initial state
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s) => {
        setSource(s.source);
        setFinished(s.finished);
      })
      .catch(() => {});
  }, []);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (msg) => {
      const event: NormalizedEvent = JSON.parse(msg.data);
      setEvents((prev) => [...prev, event]);
    };

    es.addEventListener("finish", () => {
      setFinished(true);
    });

    es.onerror = () => {};

    return () => es.close();
  }, []);

  // Auto-scroll to top (newest first)
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  // Detect scroll position
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop } = listRef.current;
    const atTop = scrollTop < 80;
    setAutoScroll(atTop);
    setShowScrollBtn(!atTop);
  }, []);

  const scrollToTop = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      setAutoScroll(true);
      setShowScrollBtn(false);
    }
  }, []);

  const toggleFilter = useCallback((family: FamilyFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  // Derived data
  const firstReceivedAt = events.length > 0 ? events[0].receivedAt : null;

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter((e) => activeFilters.has(e.family));
  }, [events, activeFilters]);

  const familyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.family] = (counts[e.family] || 0) + 1;
    }
    return counts;
  }, [events]);

  const totalDurationMs = useMemo(() => {
    if (events.length < 2) return 0;
    const first = events[0].receivedAt;
    const last = events[events.length - 1].receivedAt;
    if (!first || !last) return 0;
    return new Date(last).getTime() - new Date(first).getTime();
  }, [events]);

  const totalCost = useMemo(() => {
    let cost = 0;
    for (const e of events) {
      if (e.costUsd) cost += e.costUsd;
    }
    return cost;
  }, [events]);

  const totalTokens = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const e of events) {
      if (e.usage) {
        input += e.usage.input_tokens || e.usage.prompt_tokens || 0;
        output += e.usage.output_tokens || e.usage.completion_tokens || 0;
      }
    }
    return { input, output, total: input + output };
  }, [events]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-lg">Agent Vis</span>
          </div>
          <span className="text-zinc-500 text-sm">
            source: <span className="text-zinc-300">{source}</span>
          </span>
          <span className="text-zinc-500 text-sm">{events.length} events</span>
          {totalDurationMs > 0 && (
            <span className="text-zinc-500 text-sm">{formatElapsed(totalDurationMs)}</span>
          )}

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
              activeFilters.size > 0
                ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-600"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter{activeFilters.size > 0 ? ` (${activeFilters.size})` : ""}
          </button>

          {activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Streaming indicator */}
          <div className="ml-auto flex items-center gap-3">
            {!finished && (
              <span className="flex items-center gap-1.5 text-sm text-amber-400">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Streaming
              </span>
            )}
          </div>
        </div>

        {/* Filter pills */}
        {showFilters && (
          <div className="flex items-center gap-2 px-4 pb-3">
            {FILTER_PILLS.map(({ family, label, color }) => {
              const count = familyCounts[family] || 0;
              const active = activeFilters.has(family);
              return (
                <button
                  key={family}
                  onClick={() => toggleFilter(family)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    active ? color : "border-zinc-700 text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  {label} {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Event list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2 relative"
      >
        {events.length === 0 && !finished && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Waiting for events...
          </div>
        )}
        {[...filteredEvents].reverse().map((event, idx) => (
          <EventCard
            key={event.id}
            event={event}
            index={events.indexOf(event)}
            firstReceivedAt={firstReceivedAt ?? undefined}
          />
        ))}
        {activeFilters.size > 0 && filteredEvents.length === 0 && events.length > 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">
            No events match the current filter.
          </div>
        )}
      </div>

      {/* Scroll to top button */}
      {showScrollBtn && (
        <button
          onClick={scrollToTop}
          className="fixed top-16 right-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full p-2 shadow-lg transition-colors z-10"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}

      {/* Status bar */}
      <footer className="flex items-center gap-4 px-4 py-2 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0 text-sm">
        {finished ? (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle className="w-4 h-4" />
            Finished
          </span>
        ) : (
          <span className="text-zinc-500">Receiving events...</span>
        )}

        {/* Usage stats */}
        <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
          {totalTokens.total > 0 && (
            <span>
              {totalTokens.input.toLocaleString()} in / {totalTokens.output.toLocaleString()} out tokens
            </span>
          )}
          {totalCost > 0 && (
            <span className="text-amber-400/80">${totalCost.toFixed(4)}</span>
          )}
          {firstReceivedAt && (
            <span>started {formatTime(firstReceivedAt)}</span>
          )}
        </div>
      </footer>
    </div>
  );
}
