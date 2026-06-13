# Hosted guard dashboard

> Note: this ADR introduced the guard alongside an earlier offline testing
> tool. That tool has since been removed — Rinne is now solely the hosted guard
> described here.

Rinne is a hosted guard surface:
live DeFi agents register once, call `POST /v1/guard` with a planned action
(`swap`, `approval`, or `lending`) before executing, and receive a deterministic
`proceed` / `block` / `review` gate with a recorded, content-hashed decision
trail visible in a dashboard.

The guard's decision comes from deterministic rules (never an LLM): action math
gates the dangerous cases on its own (a swap with no `minReceived`, an unlimited
approval, a borrow landing below a 1.25 health factor), so the block path never
depends on a provider being reachable. Live evidence sharpens the decision —
**Surf** supplies the market signal behind swap checks, **Nansen** supplies
address risk labels behind approval/lending checks — and a provider that fails
is recorded as `status: "error"` and pushes the gate to `review`; it is never
silently downgraded to canned evidence. An operator-allowlisted spender or
protocol skips the provider round-trip entirely (the operator already verified
it), which is why an unknown-but-unflagged address proceeds while an unverifiable
one is reviewed — the "minimize reviews" posture.

This keeps the dependency boundary of [0001](0001-rinne-dependency-boundary.md):
Surf is market signal, Nansen is risk intelligence, neither stores agent
identity or anchors proofs. Persistence is plain JSON files under
`artifacts/store/` (no database for the MVP). Onchain anchoring
(`RinneAgentRegistry`, event-only) is optional proof, never required for the
dashboard to run, and never carries endpoint URLs, API keys, or raw action data.

Registration is **agent-initiated**: an agent self-registers at
`POST /v1/register-agent` (no operator credential) and receives its API key
once; it guards and rotates its key using that key. The dashboard is
**observe-only** — it lists agents and decisions and never registers or mutates
them. Open self-registration is the MVP posture; gating it (invite tokens, rate
limits) is a deployment concern, not a code change.

Rinne is honest about its limits: it guards only agents that voluntarily
integrate and obey `block`. It does not stop arbitrary third-party bots, does
not execute transactions, and does not claim full DeFi simulation.
