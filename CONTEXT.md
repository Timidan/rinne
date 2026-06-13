# Rinne

Rinne is a hosted DeFi agent guard for Mantle. A DeFi agent describes a planned
action — a swap, an approval, or a lending operation — and Rinne returns a
deterministic decision about whether the action is safe to execute. Rinne never
executes transactions and never takes a private key: the agent broadcasts its
own transaction with its own wallet after Rinne approves.

This document is the contributor-facing overview: the architecture at a glance,
the guard flow, the engine modules that exist today, and the shared product
language used across the codebase and docs.

> Historical note: Rinne began as an offline testing tool; that system has been
> removed. Today it is purely a hosted, request-time guard — agents call it
> before acting — and the CLI is just `serve` and `doctor`.

## Architecture at a glance

One service, `rinne serve`, runs on a single origin and serves:

- the guard API (`/v1` for agents, `/api` for the dashboard),
- the agent skill (`/skill.md`), substituting the real base URL into
  `docs/agents/SKILL.md`, and
- the dashboard (`/app`).

In production it runs behind nginx + systemd; a live instance is deployed at
`https://rinne.timidan.xyz`. See `DEPLOY.md` for the droplet runbook.

State is a file-backed store at `rinne/artifacts/store/{agents,decisions}.json`.
API keys are stored only as hashes; secrets are never logged or returned.

`RINNE_HOSTED=1` makes the server require `SURF_API_KEY` and `NANSEN_API_KEY`
at startup.

## Guard flow

The integration path is agent → Rinne; no UI is required.

1. The agent installs the skill: `curl $RINNE_BASE_URL/skill.md` (served from
   `docs/agents/SKILL.md` with the real base URL substituted in).
2. The agent self-registers: `POST /v1/register-agent` (open, no auth). The
   response returns an agent id and an API key `rinne_live_...`, shown once.
3. Before acting, the agent calls `POST /v1/guard` with header
   `Authorization: Bearer <key>` and a planned action.
4. Rinne returns a Guard Decision with a Gate of `proceed`, `block`, or
   `review`.

### Gates

- **`proceed`** — act if your own policy agrees.
- **`block`** — a critical Safety Rule failed; do not execute.
- **`review`** — something could not be verified (a provider was unreachable) or
  a soft limit was crossed; pause for human review.

The posture is to minimize reviews. The Gate is computed deterministically:

- any critical rule fail → `block`;
- otherwise any warning fail, or any provider status `error` → `review`;
- otherwise `proceed`.

### Action families and chains

Three action families are supported today: **swap**, **approval**, and
**lending**. Chains are `mantle` (mainnet, chainId 5000) and `mantle-sepolia`
(testnet, chainId 5003).

### Provider evidence (live, never mocked)

Rinne fetches live evidence to inform a Gate and never substitutes canned data:

- **Surf** — market price: `GET api.asksurf.ai/gateway/v1/market/price`,
  `Authorization: Bearer`.
- **Nansen** — address risk labels:
  `POST api.nansen.ai/api/v1/profiler/address/labels`, header `apikey`.

If a provider fails, the affected decision is `review`.

### Safety Rules

| Rule | Severity | Behavior |
|---|---|---|
| `swap-min-received-required` | critical | min received must be present |
| `swap-slippage-limit` | critical | slippage > 300 bps is rejected |
| `swap-quote-freshness` | warning | quote older than 120s |
| `swap-market-evidence` | warning | Surf unavailable |
| `approval-no-unlimited` | critical | unlimited approvals rejected |
| `approval-amount-limit` | warning | approval amount over limit |
| `approval-spender-risk` | mixed | Nansen high-risk spender → block; unreachable → review; unknown → proceed |
| `lending-health-factor-present` | warning | resulting health factor must be present |
| `lending-health-factor-min` | critical | resulting health factor < 1.25 → block |
| `lending-protocol-risk` | mixed | same posture as spender risk |

## Engine modules

TypeScript throughout — Node built-ins, ESM with `.js` import suffixes, strict.

- `guard/` — `normalize-action`, `guard-service`, and `rules/` (per-family
  swap / approval / lending rules).
- `providers/` — `surf-live`, `nansen-live`, `risk-signal`, `provider-evidence`.
- `core/` — `guard-types`, `guard-store`, `api-keys`, `decimal`, `ids`, `types`,
  plus supporting `canonical-json` and `hashing`.
- `server/` — the single-origin HTTP service.
- `cli/` — `serve` and `doctor`.
- `adapters/surf` — `normalizeMarketPayload` and `surfApiBase` only.

`rinne-contracts/` (Foundry / Solidity) exists, but on-chain anchoring is a
type-level hook only: `GuardDecision.onchain` is defined but **not** currently
wired. Do not claim decisions are anchored on-chain.

## Dashboard

`rinne-web` (React / Vite / Tailwind), served at `/app`, is **observe-only**: it
lists registered agents and their decisions. Registration is always
agent-initiated; it never happens via the UI.

## Product language

Use these terms consistently in code, comments, and docs.

**Agent**
A DeFi agent that registers with Rinne and calls the guard before acting. Every
Agent is external — yours; Rinne ships none of its own.
_Avoid_: Bot, assistant, model.

**Registered Agent**
An external DeFi Agent that registered with Rinne (name, owner, supported
actions, API key hash) and calls the guard before acting.
_Avoid_: Account, user, bot.

**Action**
A planned DeFi operation a registered Agent sends to Rinne before executing — a
swap, approval, or lending operation. Rinne judges it and returns a Gate.
_Avoid_: Transaction, trade, call.

**Gate**
Rinne's machine answer to a guarded Action: `proceed`, `block`, or `review`.
Computed deterministically from Safety Rule severities and provider evidence
health.
_Avoid_: Verdict, score, rating.

**Guard Decision**
The saved, content-hashed record of one guarded Action: the Action, the Provider
Evidence, the Safety Rule results, and the Gate.
_Avoid_: Log, result.

**Provider Evidence**
A live observation Rinne fetched to inform a Gate — a Surf market signal or a
Nansen risk label — recorded with its payload hash and a `live`/`error` status.
Never mocked, never canned.
_Avoid_: Data, lookup, enrichment.

**Payload**
A raw provider response before Rinne normalizes it.
_Avoid_: Data blob, raw signal, API output.

**Signal**
Normalized external data derived from a Payload.
_Avoid_: Intelligence, normalized payload, market data.

**Safety Rule**
A deterministic rule that judges a guarded Action and contributes its severity to
the Gate.
_Avoid_: Invariant, check, assertion.

## Relationships

- A Registered Agent submits many Actions.
- An Action produces exactly one Guard Decision.
- A Guard Decision records one Gate, its Safety Rule results, and the Provider
  Evidence gathered for it.
- A Payload can produce one or more Signals.
- An Action is evaluated against one or more Safety Rules.

## Example dialogue

> **Dev:** "Does Rinne execute the swap once it returns `proceed`?"
> **Domain expert:** "No. Rinne never broadcasts and never holds a key. A
> `proceed` Gate means the Agent may execute the Action with its own wallet if
> its own policy agrees."

> **Dev:** "Surf timed out — do we fall back to a cached price?"
> **Domain expert:** "No. If a provider is unreachable the Provider Evidence
> status is `error` and the Gate becomes `review`. Rinne never substitutes
> canned data."

> **Dev:** "Is the Surf response itself the Signal?"
> **Domain expert:** "No. The raw Surf response is the Payload. Rinne normalizes
> it into a Signal before it informs the Gate."

> **Dev:** "Can the dashboard register an agent for me?"
> **Domain expert:** "No. The dashboard is observe-only. Registration is always
> agent-initiated via `POST /v1/register-agent`."
