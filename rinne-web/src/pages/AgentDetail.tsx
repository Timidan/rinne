import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getAgent } from "../lib/api";
import type { GuardDecision, RegisteredAgentView } from "../lib/guard-types";
import DashboardShell from "../components/DashboardShell";
import AgentStatusPill from "../components/AgentStatusPill";
import DecisionTable from "../components/DecisionTable";

interface AgentDetailData {
  agent: RegisteredAgentView;
  decisions: GuardDecision[];
}

// Readable absolute time; ids and hashes stay mono, but timestamps face people.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

const MODE_LABEL: Record<RegisteredAgentView["guardMode"], string> = {
  observe: "observe",
  enforce: "enforce",
};

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    // Reset every state so switching agents in the same mounted component
    // never shows a stale agent above a fresh error (or vice versa).
    setData(null);
    setError(null);
    setNotFound(false);
    getAgent(agentId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true);
        } else {
          setError((cause as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <DashboardShell>
      <Link
        to="/app/agents"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-dim transition-colors hover:text-blue"
      >
        ← All agents
      </Link>

      {notFound && (
        <div className="mt-6 rounded-2xl border border-line bg-card p-8">
          <h1 className="font-display text-xl font-extrabold tracking-tight">No agent with id</h1>
          <p className="mt-3 font-mono text-sm text-ink-dim break-all">{agentId}</p>
          <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-ink-dim">
            It may have been removed, or the id is mistyped. Pick one from the agents list.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-red/60 bg-card p-8">
          <h1 className="font-display text-xl font-extrabold tracking-tight text-red">
            Could not load this agent
          </h1>
          <p className="mt-3 font-mono text-sm text-ink-dim">{error}</p>
        </div>
      )}

      {!data && !error && !notFound && (
        <p className="mt-8 text-sm text-ink-dim">Loading agent…</p>
      )}

      {data && <AgentView agent={data.agent} decisions={data.decisions} />}
    </DashboardShell>
  );
}

function AgentView({
  agent,
  decisions,
}: {
  agent: RegisteredAgentView;
  decisions: GuardDecision[];
}) {
  const stats: { label: string; value: number }[] = [
    { label: "total", value: agent.counters.total },
    { label: "proceeded", value: agent.counters.proceeded },
    { label: "blocked", value: agent.counters.blocked },
    { label: "review", value: agent.counters.review },
  ];

  return (
    <article className="mt-6">
      <header>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{agent.name}</h1>
          <AgentStatusPill status={agent.status} />
          <span className="rounded-full bg-blue-pale px-2.5 py-1 font-mono text-xs text-blue-deep">
            {MODE_LABEL[agent.guardMode]}
          </span>
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-ink-dim tabular-nums">
          <div className="min-w-0 max-w-full">
            <dt className="inline">owner: </dt>
            <dd className="inline break-all text-ink">
              {agent.owner.kind}:{agent.owner.value}
            </dd>
          </div>
          {agent.endpointUrl && (
            <div className="min-w-0 max-w-full">
              <dt className="inline">endpoint: </dt>
              <dd className="inline truncate align-bottom text-ink">{agent.endpointUrl}</dd>
            </div>
          )}
          <div>
            <dt className="inline">registered: </dt>
            <dd className="inline">{formatTime(agent.createdAt)}</dd>
          </div>
          <div>
            <dt className="inline">last seen: </dt>
            <dd className="inline">{agent.lastSeenAt ? formatTime(agent.lastSeenAt) : "never"}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-line bg-card p-5">
              <div className="font-display text-3xl font-extrabold tracking-tight tabular-nums">
                {stat.value}
              </div>
              <div className="mt-1 font-mono text-xs text-ink-dim">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-extrabold tracking-tight">Supported actions</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {agent.supportedActions.length === 0 ? (
            <span className="text-sm text-ink-dim">None declared.</span>
          ) : (
            agent.supportedActions.map((action) => (
              <span
                key={action}
                className="rounded-full border border-line bg-card px-3 py-1 font-mono text-xs text-ink-dim"
              >
                {action}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-extrabold tracking-tight">Recent decisions</h2>
        <div className="mt-4">
          <DecisionTable decisions={decisions} />
        </div>
      </section>
    </article>
  );
}
