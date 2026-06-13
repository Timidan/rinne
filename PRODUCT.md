# Product

Rinne is a hosted pre-trade guard for autonomous DeFi agents on Mantle.

## The Problem

Autonomous DeFi agents act without a human in the loop. A single bad plan — a
swap with no minimum received, a slippage tolerance wide enough to be sandwiched,
an unlimited approval to a drainer contract, a borrow that pushes the position
under water — executes in one transaction and is irreversible. The agent's own
reasoning is exactly what failed; it cannot be trusted to catch its own mistake.

## The Solution

Rinne is a guard the agent calls *before* it acts. The agent describes its
planned action; Rinne judges it against deterministic safety rules backed by
live evidence and returns a decision. The agent broadcasts its own transaction,
with its own wallet, only after the guard approves.

Rinne **never executes transactions and never takes a private key.** It is an
advisor the agent voluntarily consults and obeys, not a custodian, a relayer, or
a kill switch over arbitrary bots.

## Integration

No UI is required. The whole loop is agent-to-Rinne over HTTP:

1. **Install the skill.** `curl $RINNE_BASE_URL/skill.md` returns the integration
   guide with the live base URL substituted in.
2. **Self-register.** `POST /v1/register-agent` (open, no auth) returns an agent
   id and an API key `rinne_live_...`, shown exactly once.
3. **Guard each action.** Before acting, the agent calls `POST /v1/guard` with
   `Authorization: Bearer <key>` and a planned action. Rinne returns a
   `GuardDecision` carrying the gate, the rule results, and the evidence behind
   them.

A live instance is deployed at <https://rinne.timidan.xyz>.

## The Three Gates

Rinne answers every guarded action with one of three gates:

- **`proceed`** — no critical rule failed and all evidence was verifiable. Act,
  if your own policy also agrees.
- **`block`** — a critical rule failed. Do not execute.
- **`review`** — something could not be verified (a provider was unreachable) or
  a soft limit was crossed. Pause for human review.

Gate logic is deterministic, never an LLM: any critical rule failure produces
`block`; otherwise any warning failure or any provider in an `error` state
produces `review`; otherwise `proceed`. The posture is to minimize reviews —
`review` means *genuinely unverifiable*, not *uncertain by default*.

## Supported Actions and Chains

Three action families today:

- **Swap**
- **Approval**
- **Lending**

On two chains: **`mantle`** (mainnet, chainId 5000) and **`mantle-sepolia`**
(testnet, chainId 5003).

### Safety Rules

| Action | Rule | Severity | Trigger |
|---|---|---|---|
| Swap | `swap-min-received-required` | critical | no minimum received specified |
| Swap | `swap-slippage-limit` | critical | slippage above 300 bps |
| Swap | `swap-quote-freshness` | warning | quote older than 120s |
| Swap | `swap-market-evidence` | warning | Surf market price unavailable |
| Approval | `approval-no-unlimited` | critical | unlimited approval amount |
| Approval | `approval-amount-limit` | warning | approval amount above soft limit |
| Approval | `approval-spender-risk` | risk-based | high-risk spender → block; unreachable → review; unknown → proceed |
| Lending | `lending-health-factor-present` | warning | resulting health factor not provided |
| Lending | `lending-health-factor-min` | critical | resulting health factor below 1.25 |
| Lending | `lending-protocol-risk` | risk-based | same posture as spender risk |

## Evidence

Every gate traces back to live evidence — never mocks, never canned data:

- **Surf** — market price (`GET api.asksurf.ai/gateway/v1/market/price`,
  `Authorization: Bearer`) for swap quote sanity.
- **Nansen** — address risk labels
  (`POST api.nansen.ai/api/v1/profiler/address/labels`, `apikey` header) for
  spender and protocol risk.

If a provider fails, the decision is `review`. Rinne never substitutes
fabricated data to manufacture a `proceed`.

## Dashboard

A React/Vite/Tailwind dashboard lives at `/app`. It is **observe-only**: it
lists registered agents and the decisions they received. Registration is always
agent-initiated through the API — never through the UI.

## Honest Limits

- **Provider-unavailable → review.** When Surf or Nansen cannot be reached,
  Rinne refuses to guess and returns `review` for a human to resolve.
- **Rinne never executes.** It takes no key, signs nothing, and broadcasts
  nothing. The agent acts on its own behalf after approval.
- **On-chain anchoring is not yet wired.** A type-level hook
  (`GuardDecision.onchain`) and a Foundry/Solidity contract project
  (`rinne-contracts/`) exist, but decisions are **not** currently anchored
  on-chain. Do not claim they are.

## Operations

One service: `rinne serve` exposes the guard API (`/v1`, `/api`), the agent
skill (`/skill.md`), and the dashboard (`/app`) on a single origin. The CLI has
exactly two commands, `serve` and `doctor`. In production it runs behind nginx
and systemd; see `DEPLOY.md` for the droplet runbook.

State is file-backed at `rinne/artifacts/store/{agents,decisions}.json`. API
keys are stored only as hashes; secrets are never logged or returned. Setting
`RINNE_HOSTED=1` makes the server require `SURF_API_KEY` and `NANSEN_API_KEY` at
startup.

The engine is TypeScript (Node built-ins, strict mode, ESM with `.js` import
suffixes).

## Brand Personality

Deliberate, forensic, calm. Rinne is a measuring instrument, not a trading bot:
it should feel like a seismograph in a quiet lab, where one red needle moving is
the drama. The name Rinne (the cycle of rebirth) is the core motif — every
action is judged afresh against live conditions before it is allowed to act.

## Anti-references

- Matrix/hacker terminal green-on-black, scanlines, "l33t" monospace walls.
- Generic SaaS landing: gradient hero text, identical three-card feature grids,
  big-number metric sections, purple-on-dark glassmorphism.
- Editorial-magazine affectation (italic display serifs, drop caps): Rinne is an
  instrument, not a publication.
- Trading-dashboard maximalism: candlesticks, tickers, neon profit green.

## Design Principles

1. The gate is the hero. Every screen builds toward one unambiguous
   traffic-light outcome a stranger can read across a room.
2. Evidence over narration. Numbers, rules, and provider hashes are shown, not
   summarized; technical depth folds away instead of disappearing.
3. Plain language first. Wording follows CONTEXT.md product terms; jargon (RPC,
   slippage, health factor) appears only inside expandable evidence.
4. Honest labels. Live vs unavailable evidence, critical vs warning rule: the UI
   never upgrades the claim the engine recorded.

## Accessibility & Inclusion

- WCAG AA contrast (≥4.5:1 body, ≥3:1 large text) on all surfaces.
- Gates never rely on color alone: every lamp pairs with its word.
- All motion gated behind `prefers-reduced-motion`; reduced mode crossfades.
- Keyboard reachable: agent list and decision panels.
