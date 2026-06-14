import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// An interactive "ask Rinne" card for the landing page. A visitor picks what
// their agent is about to do, and watches the guard answer proceed / block /
// review with the exact rule that fired. The outcomes mirror the real guard
// rules; it runs client-side so the landing never needs a key or a round-trip.

type Status = "pass" | "fail" | "warn";
type Gate = "proceed" | "block" | "review";

interface Decision {
  key: string;
  label: string;
  sub: string;
  request: string;
  gate: Gate;
  summary: string;
  rules: { id: string; status: Status; note?: string }[];
}

const ACTIONS: Decision[] = [
  {
    key: "swap",
    label: "Swap 100 MNT → USDC",
    sub: "a normal trade, with a floor",
    request: '{ "kind": "swap", "amountIn": "100", "minReceived": "52.5", "maxSlippageBps": 100 }',
    gate: "proceed",
    summary: "Every rule passed, and the price is backed by a live Surf quote. Safe to execute.",
    rules: [
      { id: "swap-min-received-required", status: "pass" },
      { id: "swap-slippage-limit", status: "pass" },
      { id: "swap-quote-freshness", status: "pass" },
      { id: "swap-market-evidence", status: "pass", note: "Surf: MNT $0.55, live" },
    ],
  },
  {
    key: "block",
    label: "Approve unlimited USDC",
    sub: "an infinite allowance",
    request: '{ "kind": "approval", "token": "USDC", "amount": "2^256 - 1" }',
    gate: "block",
    summary: "An unlimited approval lets a compromised spender drain the whole balance. Blocked.",
    rules: [
      { id: "approval-no-unlimited", status: "fail", note: "critical" },
      { id: "approval-amount-limit", status: "pass" },
      { id: "approval-spender-risk", status: "pass" },
    ],
  },
  {
    key: "review",
    label: "Approve a new, unknown spender",
    sub: "no track record yet",
    request: '{ "kind": "approval", "token": "USDC", "spender": "0x9aF3…2E20", "amount": "500" }',
    gate: "review",
    summary: "The spender is not allowlisted and carries no risk label either way. A human should look.",
    rules: [
      { id: "approval-no-unlimited", status: "pass" },
      { id: "approval-amount-limit", status: "pass" },
      { id: "approval-spender-risk", status: "warn", note: "unrecognized" },
    ],
  },
];

const GATE: Record<Gate, { word: string; color: string; tint: string }> = {
  proceed: {
    word: "Proceed",
    color: "var(--color-blue)",
    tint: "var(--color-blue-pale)",
  },
  block: {
    word: "Block",
    color: "var(--color-red)",
    tint: "color-mix(in srgb, var(--color-red) 12%, transparent)",
  },
  review: {
    word: "Review",
    color: "var(--color-amber)",
    tint: "color-mix(in srgb, var(--color-amber) 16%, transparent)",
  },
};

const STATUS_COLOR: Record<Status, string> = {
  pass: "var(--color-blue)",
  fail: "var(--color-red)",
  warn: "var(--color-amber)",
};

const WRAP = "mx-auto max-w-[1160px] px-7";

export default function LiveGuardDemo() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const action = ACTIONS[i]!;
  const gate = GATE[action.gate];

  const list = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.07, delayChildren: reduced ? 0 : 0.12 } },
  };
  const row = {
    hidden: reduced ? { opacity: 1 } : { opacity: 0, x: -8 },
    show: { opacity: 1, x: 0 },
  };

  return (
    <section className="pb-[96px]" aria-label="See Rinne decide">
      <div className={WRAP}>
        <h2 className="text-center text-[clamp(26px,3.2vw,38px)] font-extrabold leading-[1.08] tracking-[-0.02em]">
          See it decide
        </h2>
        <p className="mx-auto mt-3 max-w-[52ch] text-center text-[15px] leading-relaxed text-ink-dim">
          Pick what your agent is about to do. Watch Rinne answer, with the exact rule that fired.
        </p>

        <div className="mx-auto mt-10 max-w-[960px] rounded-[26px] border-2 border-ink bg-card p-5 shadow-[6px_6px_0_var(--color-ink)] sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            {/* Left: choose an action */}
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">
                Your agent wants to…
              </div>
              <div className="mt-3 flex flex-col gap-2.5" role="tablist" aria-label="Pick an action">
                {ACTIONS.map((act, idx) => {
                  const selected = idx === i;
                  return (
                    <button
                      key={act.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setI(idx)}
                      className={`rounded-2xl px-4 py-3 text-left transition-all ${
                        selected
                          ? "border-2 border-ink bg-bg shadow-[3px_3px_0_var(--color-ink)]"
                          : "border border-line bg-bg hover:border-ink"
                      }`}
                    >
                      <div className="text-[15px] font-bold tracking-[-0.01em]">{act.label}</div>
                      <div className="text-[12.5px] text-ink-dim">{act.sub}</div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 rounded-xl border border-line bg-bg p-3">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
                  POST /v1/guard
                </div>
                <code className="mt-1.5 block break-words font-mono text-[12px] leading-relaxed text-ink-dim">
                  {action.request}
                </code>
              </div>
            </div>

            {/* Right: the verdict, re-animated on every pick */}
            <div className="rounded-2xl border border-line bg-bg p-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={action.key}
                  initial={reduced ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduced ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                >
                  {/* Gate tile */}
                  <motion.div
                    initial={reduced ? false : { scale: 0.96, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 24 }}
                    className="flex items-center gap-3 rounded-xl px-4 py-3.5"
                    style={{ background: gate.tint }}
                  >
                    <motion.span
                      className="size-3.5 rounded-full"
                      style={{ background: gate.color, willChange: "transform, opacity" }}
                      animate={
                        reduced
                          ? undefined
                          : action.gate === "proceed"
                            ? { opacity: [1, 1] }
                            : { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }
                      }
                      transition={reduced ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <span
                      className="font-display text-[30px] font-extrabold leading-none tracking-[-0.02em]"
                      style={{ color: gate.color }}
                    >
                      {gate.word}
                    </span>
                    <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim">
                      gate
                    </span>
                  </motion.div>

                  {/* Rules */}
                  <motion.ul variants={list} initial="hidden" animate="show" className="mt-4 space-y-2">
                    {action.rules.map((r) => (
                      <motion.li
                        key={r.id}
                        variants={row}
                        className="flex items-center gap-2.5 text-[13px]"
                      >
                        <span
                          className="grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: STATUS_COLOR[r.status] }}
                          aria-hidden
                        >
                          {r.status === "pass" ? "✓" : r.status === "fail" ? "✕" : "!"}
                        </span>
                        <code
                          className={`font-mono ${
                            r.status === "pass" ? "text-ink-dim" : "font-semibold text-ink"
                          }`}
                        >
                          {r.id}
                        </code>
                        {r.note ? (
                          <span
                            className="ml-auto font-mono text-[11px]"
                            style={{ color: r.status === "pass" ? "var(--color-ink-dim)" : STATUS_COLOR[r.status] }}
                          >
                            {r.note}
                          </span>
                        ) : null}
                      </motion.li>
                    ))}
                  </motion.ul>

                  <motion.p
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: reduced ? 0 : 0.45 }}
                    className="mt-4 border-t border-line pt-3 text-[13.5px] leading-relaxed text-ink-dim"
                  >
                    {action.summary}
                  </motion.p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-4 text-center font-mono text-[11px] text-ink-dim">
          illustrative · the same rules run live at{" "}
          <span className="text-blue">/v1/guard</span>
        </p>
      </div>
    </section>
  );
}
