import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAgents } from "../lib/api";
import type { RegisteredAgentView } from "../lib/guard-types";
import DashboardShell from "../components/DashboardShell";
import AgentStatusPill from "../components/AgentStatusPill";

// Roster of agents registered against the hosted guard. Each row links to the
// agent's detail; counters give a glance at how much traffic the guard has
// judged and how often it stepped in. Read-only — registration lives on its
// own page.
export default function Agents() {
  const [agents, setAgents] = useState<RegisteredAgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAgents(null);
    setError(null);
    listAgents()
      .then((data) => {
        if (!cancelled) setAgents(data.agents);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Agents</h1>
          <p className="mt-2 max-w-[60ch] text-ink-dim">
            Every agent that registered itself with the hosted guard. Open one to
            see the decisions Rinne made on its behalf and the evidence behind each
            gate.
          </p>
        </div>
      </div>

      <div className="mt-8">
        {error && (
          <div className="rounded-2xl border border-red/60 bg-card p-8">
            <h2 className="font-display text-xl font-bold text-red">Could not load agents</h2>
            <p className="mt-3 font-mono text-sm text-ink-dim">{error}</p>
          </div>
        )}

        {!error && agents === null && (
          <p className="text-sm text-ink-dim">Loading agents…</p>
        )}

        {!error && agents && agents.length === 0 && (
          <div className="rounded-2xl border border-line bg-card p-8">
            <h2 className="font-display text-xl font-bold tracking-tight">No agents yet</h2>
            <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-dim">
              Agents register themselves with the guard skill. Once one does, it shows
              up here with a live status and a running tally of the decisions the guard
              has made for it.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex h-11 items-center rounded-full bg-blue px-5 font-display font-bold text-white transition-colors hover:bg-blue-press"
            >
              How agents get started
            </Link>
          </div>
        )}

        {!error && agents && agents.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/app/agents/${agent.id}`}
                  className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-blue-pale/40 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-display font-bold text-ink">{agent.name}</span>
                      <AgentStatusPill status={agent.status} />
                      <span className="rounded-full bg-blue-pale px-2.5 py-0.5 font-mono text-xs text-blue-deep">
                        {agent.guardMode}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {agent.supportedActions.map((action) => (
                        <span
                          key={action}
                          className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-dim"
                        >
                          {action}
                        </span>
                      ))}
                    </div>
                  </div>
                  <dl className="flex shrink-0 items-center gap-5 font-mono text-xs text-ink-dim tabular-nums">
                    <div>
                      <dt className="text-ink-dim">total</dt>
                      <dd className="mt-0.5 text-base font-bold text-ink">{agent.counters.total}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-dim">blocked</dt>
                      <dd className="mt-0.5 text-base font-bold text-red">{agent.counters.blocked}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-dim">review</dt>
                      <dd className="mt-0.5 text-base font-bold text-amber">{agent.counters.review}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
