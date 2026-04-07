import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, ArrowUp, CheckCircle } from "lucide-react";
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
  raw: any;
}

export default function App() {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [finished, setFinished] = useState(false);
  const [source, setSource] = useState("claude");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
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

    es.onerror = () => {
      // EventSource reconnects automatically
    };

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

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <span className="font-semibold text-lg">Agent Vis</span>
        </div>
        <span className="text-zinc-500 text-sm">source: <span className="text-zinc-300">{source}</span></span>
        <span className="text-zinc-500 text-sm">{events.length} events</span>
        {!finished && (
          <span className="ml-auto flex items-center gap-1.5 text-sm text-amber-400">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Streaming
          </span>
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
        {[...events].reverse().map((event, idx) => (
          <EventCard key={event.id} event={event} index={events.length - 1 - idx} />
        ))}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToTop}
          className="fixed top-16 right-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full p-2 shadow-lg transition-colors"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}

      {/* Status bar */}
      <footer className="flex items-center gap-2 px-4 py-2 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0 text-sm">
        {finished ? (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle className="w-4 h-4" />
            Finished
          </span>
        ) : (
          <span className="text-zinc-500">Receiving events...</span>
        )}
      </footer>
    </div>
  );
}
