import type {
  ApprovalAction,
  Chain,
  DefiAction,
  GuardContext,
  GuardRequest,
  LendingAction,
  QuoteContext,
  SwapAction,
  TokenRef,
} from "../core/guard-types.js";

// Normalizes an untrusted guard request body into a typed GuardRequest. This
// is the single trust boundary between agent-supplied JSON and the rule
// engine: everything downstream may assume the shapes in guard-types.ts
// without re-checking. The contract is "lenient in, strict out" — unknown
// extra fields are silently dropped (agents can over-send without breaking),
// but every field we keep is validated, and the normalized output contains
// only fields the schema defines.
//
// This function NEVER throws on bad input. A guard that crashes on a
// malformed request is itself a hazard, so every failure becomes an
// { ok: false } result whose problem string names the offending field and
// what was expected — agents fix their payloads from the message alone.

export type NormalizeGuardRequestResult =
  | { ok: true; request: GuardRequest }
  | { ok: false; problem: string; raw: unknown };

const SCHEMA_VERSION = "rinne.guard-request.v1";

// Plain decimal amounts only — no exponents, signs, or locale separators.
// Agents deal in token amounts where "1e18" or "-5" are almost always bugs,
// so we reject them loudly instead of guessing.
const DECIMAL_RE = /^\d+(\.\d+)?$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;

// Validation failures are signalled internally with this private error class
// and converted to { ok: false } at the single try/catch in
// normalizeGuardRequest, so deeply nested field checks stay flat and readable
// while the public contract remains throw-free.
class ValidationProblem extends Error {}

function fail(message: string): never {
  throw new ValidationProblem(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDecimalString(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) {
    fail(
      `"${field}" is not a plain decimal string (expected digits with an optional fraction, e.g. "1250.5")`
    );
  }
  return value;
}

function readOptionalDecimalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return readDecimalString(value, field);
}

function readAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    fail(`"${field}" is not a valid address (expected "0x" followed by exactly 40 hex characters)`);
  }
  return value;
}

// Spenders and lending protocols may be referenced by a well-known name
// (e.g. "lendle") during early integration, but anything that LOOKS like an
// on-chain address must be a complete, valid one — a truncated or mistyped
// 0x-string passing silently as a "name" would defeat the spender checks
// the rule engine runs later.
function readAddressOrName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`"${field}" is not a non-empty string (an 0x address or a well-known name)`);
  }
  if (/^0[xX]/.test(value)) {
    return readAddress(value, field);
  }
  return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    fail(`"${field}" is not a string`);
  }
  return value;
}

// Basis points are capped below 10000 because 10000 bps is 100% — a slippage
// or liquidation threshold of "the entire amount" is never an intentional
// guard input, so we treat it as a unit-confusion bug.
function readOptionalBps(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= 10000) {
    fail(`"${field}" is not an integer between 0 and 9999 (basis points)`);
  }
  return value;
}

function readTokenRef(value: unknown, field: string): TokenRef {
  if (!isPlainObject(value)) {
    fail(`"${field}" is not an object (expected { symbol, decimals, address? })`);
  }
  const symbol = value["symbol"];
  if (typeof symbol !== "string" || symbol.length === 0) {
    fail(`"${field}.symbol" is not a non-empty string`);
  }
  const decimals = value["decimals"];
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    fail(`"${field}.decimals" is not an integer between 0 and 36`);
  }
  const token: TokenRef = { symbol, decimals };
  if (value["address"] !== undefined) {
    token.address = readAddress(value["address"], `${field}.address`);
  }
  return token;
}

// Rinne evaluates Mantle mainnet and the Mantle Sepolia testnet; any other
// chain is refused, because recording a decision for a market the rules know
// nothing about is worse than refusing. The validated value is carried into
// the normalized action so the decision record states the real chain (mainnet
// vs testnet) rather than assuming one.
function readChain(value: unknown): Chain {
  if (value !== "mantle" && value !== "mantle-sepolia") {
    fail(`"action.chain" must be "mantle" (mainnet, chainId 5000) or "mantle-sepolia" (testnet, chainId 5003)`);
  }
  return value;
}

function readQuote(value: unknown, field: string): QuoteContext {
  if (!isPlainObject(value)) {
    fail(`"${field}" is not an object (expected { source?, quotedAt?, price? })`);
  }
  const quote: QuoteContext = {};
  const source = readOptionalString(value["source"], `${field}.source`);
  if (source !== undefined) quote.source = source;
  const quotedAt = readOptionalString(value["quotedAt"], `${field}.quotedAt`);
  if (quotedAt !== undefined) quote.quotedAt = quotedAt;
  const price = readOptionalString(value["price"], `${field}.price`);
  if (price !== undefined) quote.price = price;
  return quote;
}

function normalizeSwap(action: Record<string, unknown>): SwapAction {
  const swap: SwapAction = {
    kind: "swap",
    chain: readChain(action["chain"]),
    tokenIn: readTokenRef(action["tokenIn"], "action.tokenIn"),
    tokenOut: readTokenRef(action["tokenOut"], "action.tokenOut"),
    amountIn: readDecimalString(action["amountIn"], "action.amountIn"),
  };
  const expectedOut = readOptionalDecimalString(action["expectedOut"], "action.expectedOut");
  if (expectedOut !== undefined) swap.expectedOut = expectedOut;
  const minReceived = readOptionalDecimalString(action["minReceived"], "action.minReceived");
  if (minReceived !== undefined) swap.minReceived = minReceived;
  const maxSlippageBps = readOptionalBps(action["maxSlippageBps"], "action.maxSlippageBps");
  if (maxSlippageBps !== undefined) swap.maxSlippageBps = maxSlippageBps;
  if (action["quote"] !== undefined) {
    swap.quote = readQuote(action["quote"], "action.quote");
  }
  return swap;
}

function normalizeApproval(action: Record<string, unknown>): ApprovalAction {
  const approval: ApprovalAction = {
    kind: "approval",
    chain: readChain(action["chain"]),
    token: readTokenRef(action["token"], "action.token"),
    spender: readAddressOrName(action["spender"], "action.spender"),
    amount: readDecimalString(action["amount"], "action.amount"),
  };
  const currentAllowance = readOptionalDecimalString(
    action["currentAllowance"],
    "action.currentAllowance"
  );
  if (currentAllowance !== undefined) approval.currentAllowance = currentAllowance;
  const reason = readOptionalString(action["reason"], "action.reason");
  if (reason !== undefined) approval.reason = reason;
  return approval;
}

const LENDING_OPERATIONS = ["supply", "withdraw", "borrow", "repay"] as const;
type LendingOperation = (typeof LENDING_OPERATIONS)[number];

function readLendingOperation(value: unknown): LendingOperation {
  const match = LENDING_OPERATIONS.find((operation) => operation === value);
  if (match === undefined) {
    fail(
      `"action.operation" ${JSON.stringify(value) ?? "undefined"} is not supported — accepted operations are ${LENDING_OPERATIONS.map((operation) => `"${operation}"`).join(", ")}`
    );
  }
  return match;
}

function normalizeLending(action: Record<string, unknown>): LendingAction {
  const lending: LendingAction = {
    kind: "lending",
    chain: readChain(action["chain"]),
    protocol: readAddressOrName(action["protocol"], "action.protocol"),
    operation: readLendingOperation(action["operation"]),
    asset: readTokenRef(action["asset"], "action.asset"),
    amount: readDecimalString(action["amount"], "action.amount"),
  };
  const healthFactorBefore = readOptionalDecimalString(
    action["healthFactorBefore"],
    "action.healthFactorBefore"
  );
  if (healthFactorBefore !== undefined) lending.healthFactorBefore = healthFactorBefore;
  const healthFactorAfter = readOptionalDecimalString(
    action["healthFactorAfter"],
    "action.healthFactorAfter"
  );
  if (healthFactorAfter !== undefined) lending.healthFactorAfter = healthFactorAfter;
  const liquidationThresholdBps = readOptionalBps(
    action["liquidationThresholdBps"],
    "action.liquidationThresholdBps"
  );
  if (liquidationThresholdBps !== undefined) {
    lending.liquidationThresholdBps = liquidationThresholdBps;
  }
  return lending;
}

function normalizeAction(value: unknown): DefiAction {
  if (!isPlainObject(value)) {
    fail(`"action" is not an object`);
  }
  const kind = value["kind"];
  if (kind !== "swap" && kind !== "approval" && kind !== "lending") {
    fail(
      `"action.kind" ${JSON.stringify(kind) ?? "undefined"} is not supported — accepted kinds are "swap", "approval", "lending"`
    );
  }
  // The chain is validated and carried per-action inside the normalize*
  // helpers (readChain), so the decision records the real chain.
  switch (kind) {
    case "swap":
      return normalizeSwap(value);
    case "approval":
      return normalizeApproval(value);
    case "lending":
      return normalizeLending(value);
  }
}

// Context is caller-supplied color recorded alongside the decision. We keep
// only the documented fields and type-check them so the audit trail stays
// queryable, but we do not require any of them.
function readContext(value: unknown): GuardContext {
  if (!isPlainObject(value)) {
    fail(`"context" is not an object`);
  }
  const context: GuardContext = {};
  const walletAddress = readOptionalString(value["walletAddress"], "context.walletAddress");
  if (walletAddress !== undefined) context.walletAddress = walletAddress;
  if (value["dryRun"] !== undefined) {
    if (typeof value["dryRun"] !== "boolean") {
      fail(`"context.dryRun" is not a boolean`);
    }
    context.dryRun = value["dryRun"];
  }
  const note = readOptionalString(value["note"], "context.note");
  if (note !== undefined) context.note = note;
  return context;
}

export function normalizeGuardRequest(raw: unknown): NormalizeGuardRequestResult {
  try {
    if (!isPlainObject(raw)) {
      fail("request body is not a JSON object");
    }
    if (raw["schemaVersion"] !== SCHEMA_VERSION) {
      fail(`"schemaVersion" must be "${SCHEMA_VERSION}"`);
    }
    const agentId = raw["agentId"];
    if (typeof agentId !== "string" || agentId.length === 0 || !AGENT_ID_RE.test(agentId)) {
      fail(
        `"agentId" is not a non-empty ID (allowed characters: letters, digits, ".", "_", "-")`
      );
    }
    const request: GuardRequest = {
      schemaVersion: SCHEMA_VERSION,
      agentId,
      action: normalizeAction(raw["action"]),
    };
    if (raw["context"] !== undefined) {
      request.context = readContext(raw["context"]);
    }
    const metadata = raw["metadata"];
    if (metadata !== undefined) {
      if (!isPlainObject(metadata)) {
        fail(`"metadata" is not an object`);
      }
      // Metadata is an open record by contract, so it passes through as-is
      // (shallow-copied so later mutation of the raw body cannot alter the
      // normalized request).
      request.metadata = { ...metadata };
    }
    return { ok: true, request };
  } catch (error) {
    if (error instanceof ValidationProblem) {
      return { ok: false, problem: error.message, raw };
    }
    // Nothing above should throw anything else, but a guard must never crash
    // its caller over a request body — surface the surprise as a problem.
    return { ok: false, problem: `unexpected normalization failure: ${String(error)}`, raw };
  }
}
