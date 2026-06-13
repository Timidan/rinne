import { Link } from "react-router-dom";
import type { GuardDecision } from "../lib/guard-types";
import GatePill from "./GatePill";

// Compact operational table of recent guard decisions. Each row links to the
// decision detail. Action kind and a short subject (token pair / spender /
// protocol) give the row meaning without opening it.
function subject(decision: GuardDecision): string {
  const a = decision.action;
  if (a.kind === "swap") return `${a.tokenIn.symbol} → ${a.tokenOut.symbol}`;
  if (a.kind === "approval") return `approve ${a.token.symbol} → ${shorten(a.spender)}`;
  return `${a.operation} ${a.asset.symbol} · ${shorten(a.protocol)}`;
}

function shorten(ref: string): string {
  return ref.startsWith("0x") && ref.length > 12 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
}

export default function DecisionTable({
  decisions,
  showAgent = false,
}: {
  decisions: GuardDecision[];
  showAgent?: boolean;
}) {
  if (decisions.length === 0) {
    return <p className="text-sm text-ink-dim">No guard decisions yet.</p>;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
      {decisions.map((decision) => (
        <li key={decision.decisionId}>
          <Link
            to={`/app/actions/${decision.decisionId}`}
            className="flex items-center justify-between gap-4 px-4 py-3 font-mono text-sm transition-colors hover:bg-blue-pale/40"
          >
            <span className="flex min-w-0 items-center gap-3">
              <GatePill gate={decision.gate} size="sm" />
              <span className="truncate text-ink">
                <span className="text-ink-dim">{decision.action.kind}</span> {subject(decision)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-ink-dim tabular-nums">
              {showAgent ? `${decision.agentId.slice(0, 10)}… · ` : ""}
              {new Date(decision.createdAt).toLocaleTimeString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
