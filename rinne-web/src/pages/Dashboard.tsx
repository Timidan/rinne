import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import DashboardShell from "../components/DashboardShell";
import DecisionTable from "../components/DecisionTable";
import { listAgents, listDecisions } from "../lib/api";
import type { GuardDecision, RegisteredAgentView } from "../lib/guard-types";

const EASE = [0.22, 1, 0.36, 1] as const;

// The curl an agent runs to install the guard skill from this instance.
const skillUrl =
  typeof window !== "undefined" ? `${window.location.origin}/skill.md` : "/skill.md";

interface Overview {
  agents: RegisteredAgentView[];
  decisions: GuardDecision[];
}

// Tally failed rules across every decision, grouped by rule id, busiest first.
function failedRuleCounts(decisions: GuardDecision[]): Array<{ id: string; count: number }> {
  const tally = new Map<string, number>();
  for (const decision of decisions) {
    for (const rule of decision.ruleResults) {
      if (rule.status === "fail") tally.set(rule.id, (tally.get(rule.id) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className={`font-display text-3xl font-extrabold tracking-tight tabular-nums ${tone ?? "text-ink"}`}>
        {value}
      </div>
      <div className="mt-1 text-sm text-ink-dim">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const reduced = useReducedMotion();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    Promise.all([listAgents(), listDecisions()])
      .then(([agentsRes, decisionsRes]) => {
        if (!cancelled) setData({ agents: agentsRes.agents, decisions: decisionsRes.decisions });
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
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Guard activity</h1>
        <p className="mt-2 text-ink-dim">
          Live registered agents and the actions they cleared before touching funds.
        </p>
      </header>

      {error && (
        <div className="mt-8 rounded-2xl border border-red/60 bg-card p-8">
          <h2 className="font-display text-xl font-extrabold tracking-tight text-red">
            Could not load guard activity
          </h2>
          <p className="mt-3 font-mono text-sm text-ink-dim">{error}</p>
        </div>
      )}

      {!error && !data && (
        <p className="mt-8 text-sm text-ink-dim">Loading guard activity…</p>
      )}

      {data && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          {data.agents.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-line bg-card p-8">
              <h2 className="font-display text-2xl font-extrabold tracking-tight">No agents yet.</h2>
              <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-dim">
                Agents register themselves with the guard skill — there is nothing to do here. Point
                one at <code className="rounded-full bg-blue-pale px-2 py-0.5 font-mono text-xs text-blue-deep">curl {skillUrl}</code>{" "}
                and its decisions will land here with their evidence and rule results.
              </p>
              <Link
                to="/"
                className="mt-6 inline-flex h-12 items-center rounded-full bg-blue px-6 font-display font-bold text-white transition-colors hover:bg-blue-press"
              >
                How agents get started
              </Link>
            </div>
          ) : (
            <>
              {/* Stat strip */}
              <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Total agents" value={data.agents.length} />
                <Stat label="Guarded actions" value={data.decisions.length} />
                <Stat
                  label="Blocked"
                  value={data.decisions.filter((d) => d.gate === "block").length}
                  tone="text-red"
                />
                <Stat
                  label="Review"
                  value={data.decisions.filter((d) => d.gate === "review").length}
                  tone="text-amber"
                />
              </div>

              {/* Failed rules by frequency */}
              <section className="mt-12">
                <h2 className="font-display text-xl font-extrabold tracking-tight">
                  Failed rules by frequency
                </h2>
                <div className="mt-4 rounded-2xl border border-line bg-card p-5">
                  {(() => {
                    const counts = failedRuleCounts(data.decisions);
                    if (counts.length === 0) {
                      return <p className="text-sm text-ink-dim">No failed rules yet.</p>;
                    }
                    return (
                      <ul className="divide-y divide-line">
                        {counts.map((rule) => (
                          <li
                            key={rule.id}
                            className="flex items-center justify-between gap-4 py-2.5 font-mono text-sm first:pt-0 last:pb-0"
                          >
                            <span className="truncate text-ink">{rule.id}</span>
                            <span className="shrink-0 text-red tabular-nums">{rule.count}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
              </section>

              {/* Recent decisions */}
              <section className="mt-12">
                <h2 className="font-display text-xl font-extrabold tracking-tight">
                  Recent decisions
                </h2>
                <div className="mt-4">
                  <DecisionTable decisions={data.decisions.slice(0, 12)} showAgent />
                </div>
              </section>
            </>
          )}
        </motion.div>
      )}
    </DashboardShell>
  );
}
