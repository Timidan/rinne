import type { Gate } from "../lib/guard-types";

// A gate is never colour alone: dot plus word, always. Mirrors the verdict-lamp
// rule from the scenario harness so the two surfaces feel like one product.
const GATE: Record<Gate, { dot: string; text: string; word: string }> = {
  proceed: { dot: "bg-blue", text: "text-blue", word: "PROCEED" },
  block: { dot: "bg-red", text: "text-red", word: "BLOCK" },
  review: { dot: "bg-amber", text: "text-amber", word: "REVIEW" },
};

// Inline-table sizes (sm in the decisions table, md elsewhere) plus a "hero"
// readout used at the top of a decision: a ringed, glowing signal lamp and a
// large word — the one moving needle the brand is built around.
export default function GatePill({ gate, size = "md" }: { gate: Gate; size?: "sm" | "md" | "lg" | "hero" }) {
  const g = GATE[gate];

  if (size === "hero") {
    return (
      <span className={`inline-flex items-center gap-4 ${g.text}`}>
        <span
          className={`size-5 shrink-0 rounded-full ring-2 ring-current ring-offset-4 ring-offset-bg ${g.dot}`}
          style={{ boxShadow: "0 0 22px 1px currentColor" }}
          aria-hidden
        />
        <span className="font-mono text-5xl font-bold tracking-tight sm:text-6xl">{g.word}</span>
      </span>
    );
  }

  const dotSize = size === "lg" ? "size-3.5" : size === "sm" ? "size-1.5" : "size-2.5";
  const textSize = size === "lg" ? "text-3xl" : size === "sm" ? "text-xs" : "text-sm";
  return (
    <span className={`inline-flex items-center gap-2 font-mono font-bold ${textSize} ${g.text}`}>
      <span className={`shrink-0 rounded-full bg-current ${dotSize}`} aria-hidden />
      {g.word}
    </span>
  );
}
