# Integrate your agent with the Rinne guard

Rinne is a hosted DeFi agent guard for Mantle. Before your agent executes a
swap, a token approval, or a lending action, it sends the *planned action* to
Rinne. Rinne checks the action against deterministic safety rules and live
market and risk evidence, then returns one of three gates: `proceed`, `block`,
or `review`. Your agent acts on that answer with its own wallet — Rinne never
executes a transaction and never takes a private key.

This is the human-readable orientation. The **machine-readable skill is the
source of truth** for exact request/response shapes and is meant to be loaded
directly by your agent:

```sh
curl $RINNE_BASE_URL/skill.md
```

That request returns the skill (from `docs/agents/SKILL.md`) with the real base
URL already substituted in, so every command in it is copy-paste ready. A live
instance is deployed at `https://rinne.timidan.xyz`. When this guide and the
skill disagree, the skill wins — read it.

## The integration in four moves

Everything happens agent → Rinne. There is no operator step and no UI step; the
dashboard at `/app` is observe-only and never registers agents.

1. **Install the skill.** `curl $RINNE_BASE_URL/skill.md` and save it as your
   agent's Rinne skill.
2. **Self-register** with one open call → get an agent ID and an API key.
3. **Guard before acting**: `POST /v1/guard` with your planned action and a
   Bearer token.
4. **Read the gate and act** — or don't.

### 1. Self-register (one time)

Registration is agent-initiated. One open call (no auth) returns your agent ID
and an API key. The key is shown **once** — store it securely.

```bash
curl -X POST "$RINNE_BASE_URL/v1/register-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Mantle Agent",
    "owner": { "kind": "manual", "value": "team@example.com" },
    "endpointUrl": "https://my-agent.example.com/decide",
    "supportedActions": ["swap", "approval", "lending"],
    "guardMode": "enforce"
  }'
```

The response carries `agent.id` (`agt_...`) and `apiKey` (`rinne_live_...`).
The key appears only in this response. Rinne stores only a hash of it and never
returns or logs the secret again. Lost it? Rotate by proving you hold the
current one: `POST /v1/agents/<agentId>/rotate-key` with
`Authorization: Bearer <current_key>`. If the current key is gone entirely,
register again.

### 2. Call the guard before acting

`POST $RINNE_BASE_URL/v1/guard`, with your API key as a Bearer token and the
planned action in the body. The `agentId` must match the agent the key belongs
to.

```bash
curl -X POST "$RINNE_BASE_URL/v1/guard" \
  -H "Authorization: Bearer $RINNE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "rinne.guard-request.v1",
    "agentId": "agt_...",
    "action": {
      "kind": "swap",
      "chain": "mantle-sepolia",
      "tokenIn":  { "symbol": "MNT",  "decimals": 18 },
      "tokenOut": { "symbol": "USDC", "decimals": 6 },
      "amountIn": "100",
      "minReceived": "52.4",
      "maxSlippageBps": 100,
      "quote": { "source": "agni", "quotedAt": "2026-06-13T12:00:00Z", "price": "0.53" }
    }
  }'
```

Rinne guards three action families today — **swap**, **approval**, and
**lending** — on Mantle mainnet (`"chain": "mantle"`, chainId 5000) or the
Mantle Sepolia testnet (`"chain": "mantle-sepolia"`, chainId 5003). Send the
chain you will actually execute on. See `/skill.md` for the approval and
lending request bodies.

### 3. Read the gate

```json
{
  "decisionId": "dec_...",
  "gate": "block",
  "summary": "Blocked approval: failed approval-no-unlimited.",
  "ruleResults": [ { "id": "approval-no-unlimited", "status": "fail", "severity": "critical", "explanation": "..." } ],
  "providerEvidence": [ { "provider": "nansen", "status": "live", "summary": "..." } ],
  "reportHash": "sha256:..."
}
```

| gate | what it means | what you do |
| --- | --- | --- |
| `proceed` | No critical rule failed and all evidence resolved. | Execute the action **if your own policy also allows it**, broadcasting the transaction with your own wallet. |
| `block` | A critical safety rule failed. | Do **not** execute. Surface the failed rule to your operator. |
| `review` | Something could not be verified (a provider was unreachable) or a soft limit was crossed. | Pause and request human review. Do not execute on your own. |

How the gate is computed: any critical rule failure → `block`; otherwise any
warning failure or any provider that returned `error` → `review`; otherwise
`proceed`. The posture is to minimize reviews — they exist for the cases Rinne
genuinely could not stand behind, not as a default.

### 4. Act on it

Treat `review` as "stop and ask a human," not "proceed anyway." **Never execute
an action after a `block`.** After a `proceed` that your own policy also
accepts, your agent broadcasts the transaction itself.

## What the rules check

Rinne's evidence is always live — never mocked. Prices come from Surf, address
and protocol risk labels come from Nansen. If a provider cannot be reached, the
affected rule resolves to `review`; Rinne never substitutes canned data.

- **swap-min-received-required** (critical): a swap must declare a `minReceived` floor.
- **swap-slippage-limit** (critical): `maxSlippageBps` above 300 is rejected.
- **swap-quote-freshness** (warning): a quote older than 120s needs review.
- **swap-market-evidence** (warning): if Surf market data can't be fetched, review.
- **approval-no-unlimited** (critical): infinite / absurd allowances are blocked.
- **approval-amount-limit** (warning): allowances over the operator threshold need review.
- **approval-spender-risk**: a Nansen high-risk spender is blocked; an unreachable Nansen needs review; an unknown spender proceeds.
- **lending-health-factor-present** (warning): borrow/withdraw must declare `healthFactorAfter`.
- **lending-health-factor-min** (critical): a resulting health factor below 1.25 is blocked.
- **lending-protocol-risk**: same posture as spender risk, for the protocol.

## Security

- Never log your API key, put it in a URL, or commit it to a public repo.
- **Never send Rinne a private key, seed phrase, or signed transaction.** Rinne
  only ever needs the *planned action*. It decides; it never executes.
- A lost key cannot be recovered, but you can rotate it with your current key
  (`POST /v1/agents/<agentId>/rotate-key`). If the current key is lost too,
  register again.

For the full, always-current request/response contract — including the approval
and lending bodies and a minimal JavaScript helper — read the skill:
`curl $RINNE_BASE_URL/skill.md`.
