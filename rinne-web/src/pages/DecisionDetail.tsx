import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import DashboardShell from "../components/DashboardShell";
import { ApiError, getDecision } from "../lib/api";
import {
  actionSummary,
  formatAmount,
  formatPct,
  gateGuidance,
  gateHeadline,
  ruleTitle,
  shortenRef,
} from "../lib/guard-labels";
import type {
  ApprovalAction,
  DefiAction,
  Gate,
  GuardDecision,
  GuardRuleResult,
  LendingAction,
  ProviderEvidence,
  SwapAction,
} from "../lib/guard-types";

const EASE = [0.22, 1, 0.36, 1] as const;

// Each gate owns a hue; the readout tile, the trace break, and accents key off
// it. Word + dot always carry the meaning, colour only amplifies it.
const GATE: Record<Gate, { hue: string; text: string; dot: string }> = {
  proceed: { hue: "--color-blue", text: "text-blue", dot: "bg-blue" },
  block: { hue: "--color-red", text: "text-red", dot: "bg-red" },
  review: { hue: "--color-amber", text: "text-amber", dot: "bg-amber" },
};

const CHECK: Record<GuardRuleResult["status"], { dot: string; ring: string; text: string; word: string }> = {
  fail: { dot: "bg-red", ring: "ring-red", text: "text-red", word: "Failed" },
  pass: { dot: "bg-blue", ring: "ring-blue", text: "text-blue", word: "Passed" },
  "not-applicable": { dot: "bg-steel", ring: "ring-steel", text: "text-ink-dim", word: "Not checked" },
};

const STATUS_ORDER: Record<GuardRuleResult["status"], number> = { fail: 0, pass: 1, "not-applicable": 2 };
const SEV_ORDER: Record<GuardRuleResult["severity"], number> = { critical: 0, warning: 1, info: 2 };
const EVIDENCE_TITLES: Record<ProviderEvidence["purpose"], string> = {
  "market-signal": "Market data",
  "spender-risk": "Spender risk",
  "protocol-risk": "Protocol risk",
};
const PROVIDER: Record<ProviderEvidence["provider"], string> = { surf: "Surf", nansen: "Nansen" };

function sortChecks(rules: GuardRuleResult[]): GuardRuleResult[] {
  return [...rules].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function shortHash(h: string): string {
  const v = h.replace(/^sha256:/, "");
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v;
}

function decidingReason(d: GuardDecision): string | null {
  if (d.gate === "proceed") return null;
  const failed =
    d.ruleResults.find((r) => r.status === "fail" && r.severity === "critical") ??
    d.ruleResults.find((r) => r.status === "fail" && r.severity === "warning");
  if (failed) return ruleTitle(failed.id);
  const err = d.providerEvidence.find((e) => e.status === "error");
  return err ? `${EVIDENCE_TITLES[err.purpose]} unavailable` : null;
}

interface Row {
  label: string;
  value: string;
  muted?: boolean;
}
function actionRows(action: DefiAction): Row[] {
  if (action.kind === "swap") return swapRows(action);
  if (action.kind === "approval") return approvalRows(action);
  return lendingRows(action);
}
function swapRows(a: SwapAction): Row[] {
  return [
    { label: "Selling", value: `${formatAmount(a.amountIn)} ${a.tokenIn.symbol}` },
    { label: "For", value: a.tokenOut.symbol },
    a.minReceived
      ? { label: "Min received", value: `${formatAmount(a.minReceived)} ${a.tokenOut.symbol}` }
      : { label: "Min received", value: "Not set", muted: true },
    a.maxSlippageBps !== undefined
      ? { label: "Max slippage", value: formatPct(a.maxSlippageBps) }
      : { label: "Max slippage", value: "Not set", muted: true },
  ];
}
function approvalRows(a: ApprovalAction): Row[] {
  const rows: Row[] = [
    { label: "Token", value: a.token.symbol },
    { label: "Spender", value: shortenRef(a.spender) },
    { label: "Amount", value: `${formatAmount(a.amount)} ${a.token.symbol}` },
  ];
  if (a.currentAllowance !== undefined) rows.push({ label: "Allowance", value: formatAmount(a.currentAllowance) });
  return rows;
}
function lendingRows(a: LendingAction): Row[] {
  return [
    { label: "Protocol", value: shortenRef(a.protocol) },
    { label: "Operation", value: a.operation },
    { label: "Asset", value: `${formatAmount(a.amount)} ${a.asset.symbol}` },
    a.healthFactorAfter !== undefined
      ? { label: "Health factor", value: a.healthFactorAfter }
      : { label: "Health factor", value: "Not declared", muted: true },
  ];
}

export default function DecisionDetail() {
  const { decisionId } = useParams<{ decisionId: string }>();
  const reduced = useReducedMotion();
  const [decision, setDecision] = useState<GuardDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!decisionId) return;
    let cancelled = false;
    setDecision(null);
    setError(null);
    setNotFound(false);
    getDecision(decisionId)
      .then((data) => !cancelled && setDecision(data))
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 404) setNotFound(true);
        else setError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [decisionId]);

  return (
    <DashboardShell>
      {notFound && (
        <div className="rounded-2xl border border-line bg-card p-8">
          <h1 className="font-display text-xl font-extrabold tracking-tight">Decision not found</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            No decision matches <code className="break-all font-mono text-xs text-ink">{decisionId}</code>.
          </p>
          <Link to="/app/agents" className="mt-5 inline-flex h-11 items-center rounded-full border border-line bg-card px-5 font-medium text-ink-dim transition-colors hover:border-blue hover:text-blue">
            Back to agents
          </Link>
        </div>
      )}
      {error && !notFound && (
        <div className="rounded-2xl border border-red/60 bg-card p-8">
          <h1 className="font-display text-xl font-extrabold tracking-tight text-red">Could not load this decision</h1>
          <p className="mt-3 font-mono text-sm text-ink-dim">{error}</p>
        </div>
      )}
      {decision && <DecisionView decision={decision} reduced={Boolean(reduced)} />}
    </DashboardShell>
  );
}

function DecisionView({ decision, reduced }: { decision: GuardDecision; reduced: boolean }) {
  const g = GATE[decision.gate];
  const reason = decidingReason(decision);
  const checks = sortChecks(decision.ruleResults);
  const failed = checks.filter((r) => r.status === "fail").length;

  return (
    <motion.article
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <Link to={`/app/agents/${decision.agentId}`} className="font-mono text-xs text-ink-dim transition-colors hover:text-blue">
        ← Back to agent
      </Link>

      {/* ── Verdict readout: an instrument tile + the plain-English call ── */}
      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-stretch">
        <div
          className="flex shrink-0 flex-col justify-center rounded-2xl border px-6 py-5 sm:w-52"
          style={{
            backgroundColor: `color-mix(in srgb, var(${g.hue}) 9%, var(--color-card))`,
            borderColor: `color-mix(in srgb, var(${g.hue}) 36%, var(--color-line))`,
          }}
        >
          <span
            className={`size-3.5 rounded-full ring-2 ring-current ring-offset-4 ring-offset-bg ${g.dot} ${g.text}`}
            style={{ boxShadow: "0 0 22px 1px currentColor" }}
            aria-hidden
          />
          <span className={`mt-4 font-mono text-4xl font-bold leading-none tracking-tight ${g.text}`}>
            {decision.gate.toUpperCase()}
          </span>
          <span className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">
            {fmtTime(decision.createdAt)}
          </span>
        </div>

        <div className="min-w-0 flex-1 sm:pt-1">
          <h1 className="font-display text-3xl font-extrabold leading-[1.06] tracking-tight text-ink sm:text-[34px]">
            {gateHeadline(decision.gate, decision.action)}
          </h1>
          <p className="mt-2.5 max-w-[64ch] leading-relaxed text-ink-dim">{gateGuidance(decision.gate)}</p>
          <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-card/70 px-3 py-2 font-mono text-sm tabular-nums">
            <span className="text-ink-dim">action</span>
            <span className="text-ink">{actionSummary(decision.action)}</span>
          </div>
          {reason && (
            <div className="mt-2 font-mono text-sm">
              <span className="text-ink-dim">failed check&nbsp;&nbsp;</span>
              <span className="font-bold text-red">{reason}</span>
            </div>
          )}
        </div>
      </header>

      {/* ── The forensic trace: a hairline spine with one node per check ── */}
      <section className="mt-11">
        <div className="flex items-baseline justify-between border-b border-line pb-2">
          <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.14em] text-ink">Safety checks</h2>
          <span className="font-mono text-xs text-ink-dim tabular-nums">
            {decision.ruleResults.length} run · <span className={failed ? "text-red" : "text-ink-dim"}>{failed} failed</span>
          </span>
        </div>
        <ol className="relative mt-5">
          <span className="absolute bottom-3 left-[7px] top-2 w-px bg-line" aria-hidden />
          {checks.map((rule, i) => {
            const c = CHECK[rule.status];
            const isFail = rule.status === "fail";
            return (
              <motion.li
                key={rule.id}
                initial={reduced ? false : { opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: reduced ? 0 : 0.04 * i }}
                className={`relative flex gap-4 ${i === checks.length - 1 ? "" : "pb-5"}`}
              >
                <span
                  className={`relative z-10 mt-1 size-3.5 shrink-0 rounded-full ${c.dot} ${
                    isFail ? `ring-2 ring-offset-2 ring-offset-bg ${c.ring} ${c.text}` : ""
                  }`}
                  style={isFail ? { boxShadow: "0 0 14px 0 currentColor" } : undefined}
                  aria-hidden
                />
                <div className="-mt-0.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0">
                      <span className={`font-display font-bold ${rule.status === "not-applicable" ? "text-ink-dim" : "text-ink"}`}>
                        {ruleTitle(rule.id)}
                      </span>
                      <code className="ml-2 font-mono text-[11px] text-ink-dim">{rule.id}</code>
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-xs font-bold ${c.text}`}>
                      {c.word}
                      {isFail ? ` · ${rule.severity}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] leading-snug text-ink-dim">{rule.explanation}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </section>

      {/* ── Evidence + request, side by side ── */}
      <div className="mt-11 grid gap-x-10 gap-y-9 lg:grid-cols-2">
        <Panel title="Evidence" hint="Live data behind the checks, each fingerprinted.">
          {decision.providerEvidence.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-dim">
              None needed — the address was operator-allowlisted, so no outside risk read was made.
            </p>
          ) : (
            <ul className="space-y-4">
              {decision.providerEvidence.map((e, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display font-bold text-ink">
                      {EVIDENCE_TITLES[e.purpose]}{" "}
                      <span className="font-mono text-[11px] font-normal text-ink-dim">via {PROVIDER[e.provider]}</span>
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-xs ${e.status === "live" ? "text-blue" : "text-red"}`}>
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      {e.status === "live" ? "fetched live" : "unavailable"}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] leading-snug text-ink-dim">{e.summary}</p>
                  {e.error && <p className="mt-1 font-mono text-[11px] text-red">{e.error}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-dim tabular-nums">
                    <span>{fmtTime(e.fetchedAt)}</span>
                    {e.payloadHash && (
                      <span
                        className="rounded border border-line px-1.5 py-0.5"
                        title={e.payloadHash}
                      >
                        <span className="text-ink-dim/70">fp</span> {shortHash(e.payloadHash)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="What the agent sent" hint="The exact request Rinne judged.">
          <dl className="space-y-2 font-mono text-sm">
            {actionRows(decision.action).map((r) => (
              <div key={r.label} className="flex items-baseline gap-2">
                <dt className="shrink-0 text-ink-dim">{r.label}</dt>
                <span className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-line" aria-hidden />
                <dd className={`shrink-0 tabular-nums ${r.muted ? "italic text-ink-dim" : "text-ink"}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer font-mono text-[11px] text-ink-dim transition-colors hover:text-blue">
              Show the raw request
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-dim">
              {JSON.stringify(decision.action, null, 2)}
            </pre>
          </details>
        </Panel>
      </div>

      {/* ── Integrity: a thin sealed footer ── */}
      <footer className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 font-mono text-[11px] text-ink-dim tabular-nums">
        <span className="uppercase tracking-[0.18em]">Integrity</span>
        <span className="rounded border border-line px-1.5 py-0.5" title={decision.reportHash}>
          report {shortHash(decision.reportHash)}
        </span>
        {decision.onchain?.txHash && (
          <span className="rounded border border-line px-1.5 py-0.5" title={decision.onchain.txHash}>
            onchain {shortenRef(decision.onchain.txHash)}
          </span>
        )}
        <span className="text-ink-dim/70">recompute from the record to verify nothing changed</span>
      </footer>
    </motion.article>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <div className="border-b border-line pb-2">
        <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.14em] text-ink">{title}</h2>
        <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
