import type { CSSProperties } from "react";
import type { GuardRuleResult } from "../lib/guard-types";
import { ruleTitle } from "../lib/guard-labels";

// Per-check evidence behind a gate. Each check leads with a plain-English title
// and a word+dot status (never colour alone); the engine's slug stays as a
// small tag for developers. Failing checks sort to the top AND sit on a tinted
// surface so the reason for the gate is the one thing the eye lands on, while
// the passing and skipped checks quietly recede.
const STATUS: Record<GuardRuleResult["status"], { dot: string; text: string; word: string }> = {
  pass: { dot: "bg-blue", text: "text-blue", word: "Passed" },
  fail: { dot: "bg-red", text: "text-red", word: "Failed" },
  "not-applicable": { dot: "bg-steel", text: "text-ink-dim", word: "Not checked" },
};

const ORDER: Record<GuardRuleResult["status"], number> = { fail: 0, pass: 1, "not-applicable": 2 };
const SEVERITY_ORDER: Record<GuardRuleResult["severity"], number> = { critical: 0, warning: 1, info: 2 };

function sortChecks(rules: GuardRuleResult[]): GuardRuleResult[] {
  return [...rules].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

// Tint the surface of a failing check toward its severity hue so it reads as
// the alarm; everything else stays the calm card.
function surface(rule: GuardRuleResult): { className: string; style?: CSSProperties } {
  if (rule.status === "fail") {
    const hue = rule.severity === "critical" ? "--color-red" : "--color-amber";
    return {
      className: "rounded-2xl border p-4",
      style: {
        backgroundColor: `color-mix(in srgb, var(${hue}) 9%, var(--color-card))`,
        borderColor: `color-mix(in srgb, var(${hue}) 38%, var(--color-line))`,
      },
    };
  }
  if (rule.status === "not-applicable") {
    return { className: "rounded-2xl border border-line bg-card p-4 opacity-70" };
  }
  return { className: "rounded-2xl border border-line bg-card p-4" };
}

export default function RuleResultList({ rules }: { rules: GuardRuleResult[] }) {
  if (rules.length === 0) {
    return <p className="text-sm text-ink-dim">No checks applied to this action.</p>;
  }
  return (
    <ul className="space-y-3">
      {sortChecks(rules).map((rule) => {
        const s = STATUS[rule.status];
        const surf = surface(rule);
        return (
          <li key={rule.id} className={surf.className} style={surf.style}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="font-display font-bold text-ink">{ruleTitle(rule.id)}</span>
                <code className="ml-2 font-mono text-xs text-ink-dim">{rule.id}</code>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-xs font-bold ${s.text}`}>
                <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
                {s.word}
                {rule.status === "fail" ? ` · ${rule.severity}` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{rule.explanation}</p>
          </li>
        );
      })}
    </ul>
  );
}
