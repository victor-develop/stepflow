import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  ChevronDown,
  Plus,
  FileText,
} from "lucide-react";

interface Props {
  cwd: string;
}

interface GitState {
  branch: string;
  branches: string[];
  status: string;
  diff: string;
  loading: boolean;
}

export default function GitPanel({ cwd: _cwd }: Props) {
  const [state, setState] = useState<GitState>({
    branch: "",
    branches: [],
    status: "",
    diff: "",
    loading: false,
  });
  const [showDiff, setShowDiff] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const [statusRes, branchesRes, diffRes] = await Promise.all([
        fetch("/api/git/status"),
        fetch("/api/git/branches"),
        fetch("/api/git/diff"),
      ]);
      const statusData = await statusRes.json();
      const branchesData = await branchesRes.json();
      const diffData = await diffRes.json();

      setState({
        branch: statusData.branch ?? "",
        branches: branchesData.branches ?? [],
        status: statusData.status ?? "",
        diff: diffData.diff ?? "",
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCheckout = async (branch: string) => {
    try {
      await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, create: false }),
      });
      refresh();
    } catch {
      // ignore
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranch.trim()) return;
    try {
      await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: newBranch.trim(), create: true }),
      });
      setNewBranch("");
      setShowNewBranch(false);
      refresh();
    } catch {
      // ignore
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    try {
      await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commitMsg.trim(), files: [] }),
      });
      setCommitMsg("");
      refresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Git</h3>
        <button
          onClick={refresh}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          disabled={state.loading}
        >
          <RefreshCw
            size={14}
            className={state.loading ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Branch Selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-zinc-400" />
          <select
            value={state.branch}
            onChange={(e) => handleCheckout(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none transition focus:border-blue-500"
          >
            {state.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowNewBranch((v) => !v)}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Plus size={14} />
          </button>
        </div>

        {showNewBranch && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="new-branch-name"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500"
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
            />
            <button
              onClick={handleCreateBranch}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white transition hover:bg-blue-700"
            >
              Create
            </button>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-zinc-400" />
          <span className="text-xs font-medium text-zinc-400">Status</span>
        </div>
        <pre className="max-h-40 overflow-auto rounded-md bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
          {state.status || "Working tree clean"}
        </pre>
      </div>

      {/* Diff */}
      <div className="space-y-1.5">
        <button
          onClick={() => setShowDiff((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
        >
          <ChevronDown
            size={12}
            className={`transition ${showDiff ? "rotate-180" : ""}`}
          />
          Diff
        </button>
        {showDiff && (
          <pre className="max-h-64 overflow-auto rounded-md bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
            {state.diff || "No changes"}
          </pre>
        )}
      </div>

      {/* Commit */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <GitCommit size={14} className="text-zinc-400" />
          <span className="text-xs font-medium text-zinc-400">Commit</span>
        </div>
        <input
          type="text"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Commit message..."
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-blue-500"
          onKeyDown={(e) => e.key === "Enter" && handleCommit()}
        />
        <button
          onClick={handleCommit}
          disabled={!commitMsg.trim()}
          className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Commit All Changes
        </button>
      </div>
    </div>
  );
}
