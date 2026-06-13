import type { AgentStatus } from "../lib/guard-types";

// Status is recency of activity, not a live ping: healthy = seen within an
// hour, quiet = within a day, offline = older or never, error = an explicit
// fault. Word + dot, never color alone.
const STATUS: Record<AgentStatus, { dot: string; text: string; word: string }> = {
  healthy: { dot: "bg-blue", text: "text-blue", word: "healthy" },
  quiet: { dot: "bg-steel", text: "text-steel", word: "quiet" },
  offline: { dot: "bg-steel", text: "text-ink-dim", word: "offline" },
  error: { dot: "bg-red", text: "text-red", word: "error" },
};

export default function AgentStatusPill({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.word}
    </span>
  );
}
