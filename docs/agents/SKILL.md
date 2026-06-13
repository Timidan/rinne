---
name: rinne-guard
description: Before executing any DeFi action (swap, token approval, lending borrow/withdraw), call Rinne's guard API to get a proceed / block / review decision. Use whenever an autonomous agent is about to touch user funds on Mantle.
---

# Rinne Guard — ask before you act

> Install: `curl $RINNE_BASE_URL/skill.md`. That request returns this file with
> the real base URL already filled in, so every command below is copy-paste
> ready. Save it as your Rinne skill and follow it.

Rinne is a safety layer for DeFi agents. Before you execute a swap, an
approval, or a lending action, send the planned action to Rinne. Rinne checks
it against deterministic safety rules and live market/risk evidence (Surf for
prices, Nansen for address risk) and answers with one of three gates:

- **`proceed`** — execute it, if your own policy also allows.
- **`block`** — do **not** execute. A critical safety rule failed.
- **`review`** — pause and get human review before acting. Something could not
  be verified (a provider was unreachable, or a soft limit was crossed).

**Never execute an action after a `block`.** Treat `review` as "stop and ask a
human," not "proceed anyway."

## 1. Register yourself (one time)

You register directly with Rinne — no operator and no dashboard involved. One
self-service call gives you an agent ID and an API key. The API key is shown
**once** — store it securely.

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

Response (the `apiKey` appears only here):

```json
{ "agent": { "id": "agt_...", "status": "offline", ... }, "apiKey": "rinne_live_..." }
```

Lost the key? Rotate it by proving you hold the current one:
`POST /v1/agents/<agentId>/rotate-key` with `Authorization: Bearer <current_key>`.

## 2. Authenticate

Every guard call carries your agent API key as a Bearer token:

```
Authorization: Bearer rinne_live_...
```

The `agentId` in the request body must match the agent that key belongs to.

## 3. Call `/v1/guard` before acting

`POST $RINNE_BASE_URL/v1/guard`

Rinne guards three action families today — **swap**, **approval**, and
**lending** — on Mantle mainnet (`"chain": "mantle"`, chainId 5000) or the
Mantle Sepolia testnet (`"chain": "mantle-sepolia"`, chainId 5003). Send the
chain you will actually execute on. Rinne decides; it never executes — after a
`proceed` your agent broadcasts the transaction itself with its own wallet.

### Swap

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

### Approval

```bash
curl -X POST "$RINNE_BASE_URL/v1/guard" \
  -H "Authorization: Bearer $RINNE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "rinne.guard-request.v1",
    "agentId": "agt_...",
    "action": {
      "kind": "approval",
      "chain": "mantle",
      "token": { "symbol": "USDC", "decimals": 6 },
      "spender": "0x319B69888b0d11cEC22caA5034e25FfFBDc88421",
      "amount": "500"
    }
  }'
```

### Lending (borrow)

```bash
curl -X POST "$RINNE_BASE_URL/v1/guard" \
  -H "Authorization: Bearer $RINNE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "rinne.guard-request.v1",
    "agentId": "agt_...",
    "action": {
      "kind": "lending",
      "chain": "mantle",
      "protocol": "0xCFa5aE7c2CE8Fadc6426C1ff872cA45378Fb7cF3",
      "operation": "borrow",
      "asset": { "symbol": "USDC", "decimals": 6 },
      "amount": "1000",
      "healthFactorAfter": "1.8"
    }
  }'
```

## 4. Read the response

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

Act on `gate`:

| gate | what you do |
| --- | --- |
| `proceed` | Execute the action if your own policy also allows it. |
| `block` | Do not execute. Surface the failed rule to your operator. |
| `review` | Pause. Request human review; do not execute on your own. |

## Safety rules (what gates mean)

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

## Minimal JavaScript helper

```js
export async function guard(action, { baseUrl, agentId, apiKey }) {
  const res = await fetch(`${baseUrl}/v1/guard`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ schemaVersion: "rinne.guard-request.v1", agentId, action }),
  });
  const decision = await res.json();
  if (decision.gate === "block") throw new Error(`Rinne blocked: ${decision.summary}`);
  if (decision.gate === "review") throw new Error(`Rinne needs review: ${decision.summary}`);
  return decision; // gate === "proceed"
}
```

## Security

- Never log your API key. Never put it in a URL or a public repo.
- Never send Rinne a private key, seed phrase, or signed transaction. Rinne
  only ever needs the *planned action* — it decides, it never executes.
- A lost key cannot be recovered, but you can rotate it yourself with your
  current key (`POST /v1/agents/:agentId/rotate-key`). If you have lost the
  current key entirely, register again.
