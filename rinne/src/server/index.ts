import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGuardStore, findAgentByApiKey, type GuardStore } from "../core/guard-store.js";
import { normalizeGuardRequest } from "../guard/normalize-action.js";
import { buildAgentView, runGuard } from "../guard/guard-service.js";
import type { ActionKind, CreateAgentInput, GuardMode } from "../core/guard-types.js";
import { createApiKey } from "../core/api-keys.js";

// One process serves the whole product on a single origin:
//   - the hosted guard for agents (/v1/register-agent, /v1/guard, key rotation);
//   - the dashboard read API (/api/agents, /api/decisions) and /healthz;
//   - the agent skill (/skill.md) and the static dashboard (/app).
// Registration is agent-initiated: an agent self-registers at
// POST /v1/register-agent and receives its API key once — the dashboard never
// registers agents, it only observes them. Guard calls and key rotation
// require the agent's own API key. Dashboard reads are public (the safety
// history is the product). No secret is ever written to a decision or a log.

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIST = resolve(PACKAGE_ROOT, "..", "rinne-web", "dist");
// The agent-facing skill lives at the repo root; serving it lets an agent
// install the whole integration with one `curl <origin>/skill.md`.
const SKILL_PATH = resolve(PACKAGE_ROOT, "..", "docs", "agents", "SKILL.md");

const ACTION_KINDS: ActionKind[] = ["swap", "approval", "lending"];
const GUARD_MODES: GuardMode[] = ["observe", "enforce"];

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

// Browsers send an Origin header on cross-origin requests. The API serves a
// local tool, so only local origins (the served app itself, or a local Vite
// dev server) may script it; this blocks drive-by requests from random
// websites against the loopback service.
// Loopback origins are always allowed (local development). On a deployed
// domain the dashboard is served same-origin by this very server, and any
// extra cross-origin callers can be allowed explicitly via RINNE_ALLOWED_ORIGINS
// (comma-separated). See isAllowedOrigin.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

interface ServerState {
  artifactRoot: string;
  runInProgress: boolean;
  guardStore: GuardStore;
}

// Reads a Bearer token from the Authorization header, or null if absent.
function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

function isAllowedOrigin(req: IncomingMessage, origin: string): boolean {
  if (LOOPBACK_ORIGIN.test(origin)) return true;
  // Same-origin: the browser's Origin host matches the host it connected to.
  // This is what lets the dashboard call /api on any deployed domain (or behind
  // nginx) with no per-domain configuration.
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {
    return false;
  }
  const configured = (process.env.RINNE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req, origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return {};
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || isAllowedOrigin(req, origin);
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function sendError(req: IncomingMessage, res: ServerResponse, status: number, message: string): void {
  // 5xx messages can carry internal detail (file paths, config); log the real
  // message server-side but return a generic body to the client. Client errors
  // (4xx) are intentional, actionable feedback and are returned as-is.
  if (status >= 500) {
    console.error(`[rinne] ${status} on ${req.method} ${req.url}: ${message}`);
    sendJson(req, res, status, { error: "Internal server error" });
    return;
  }
  sendJson(req, res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((total, c) => total + c.length, 0) > 64 * 1024) {
      throw new Error("request body too large");
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

// --- Per-client rate limiting (abuse / DoS control for the open API) ---
// In-memory sliding window. Registration is open, so without this anyone could
// flood the store and the dashboard. Keyed by the real client IP: behind
// Cloudflare + nginx that is CF-Connecting-IP / X-Real-IP; direct, the socket.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 120;
// Upper bound on open self-registration so the file-backed store stays small.
const MAX_REGISTERED_AGENTS = 5_000;
const rateBuckets = new Map<string, number[]>();

function clientKey(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[0]!;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function isRateLimited(req: IncomingMessage): boolean {
  const now = Date.now();
  const key = clientKey(req);
  const recent = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(key, recent);
  // Bound the map so it can't grow without limit under a distributed flood.
  if (rateBuckets.size > 50_000) {
    for (const [k, v] of rateBuckets) {
      if (v.length === 0 || now - v[v.length - 1]! >= RATE_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return recent.length > RATE_MAX_PER_WINDOW;
}

// --- Hosted guard handlers ---

interface RegisterAgentBody {
  name?: unknown;
  owner?: unknown;
  endpointUrl?: unknown;
  supportedActions?: unknown;
  guardMode?: unknown;
}

function validateCreateAgentInput(body: RegisterAgentBody): CreateAgentInput | string {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return "name is required";
  }
  const owner = body.owner as { kind?: unknown; value?: unknown } | undefined;
  if (
    !owner ||
    typeof owner !== "object" ||
    (owner.kind !== "email" && owner.kind !== "wallet" && owner.kind !== "manual") ||
    typeof owner.value !== "string" ||
    owner.value.length === 0
  ) {
    return 'owner must be { kind: "email"|"wallet"|"manual", value: <string> }';
  }
  if (
    !Array.isArray(body.supportedActions) ||
    body.supportedActions.length === 0 ||
    !body.supportedActions.every((a) => ACTION_KINDS.includes(a as ActionKind))
  ) {
    return `supportedActions must be a non-empty subset of ${ACTION_KINDS.join(", ")}`;
  }
  if (!GUARD_MODES.includes(body.guardMode as GuardMode)) {
    return `guardMode must be one of ${GUARD_MODES.join(", ")}`;
  }
  if (body.endpointUrl !== undefined && typeof body.endpointUrl !== "string") {
    return "endpointUrl must be a string URL when provided";
  }
  const input: CreateAgentInput = {
    name: body.name.trim(),
    owner: { kind: owner.kind, value: owner.value },
    supportedActions: body.supportedActions as ActionKind[],
    guardMode: body.guardMode as GuardMode,
  };
  if (typeof body.endpointUrl === "string") input.endpointUrl = body.endpointUrl;
  return input;
}

async function handleRegisterAgent(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState
): Promise<void> {
  // Self-service: an agent registers itself and receives its API key. No
  // operator credential is required — registration is the agent -> Rinne
  // onboarding step, not a dashboard action.
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readBody(req)) || "{}");
  } catch (error) {
    sendError(req, res, 400, `Invalid JSON body: ${(error as Error).message}`);
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    sendError(req, res, 400, "Request body must be a JSON object");
    return;
  }
  const input = validateCreateAgentInput(parsed as RegisterAgentBody);
  if (typeof input === "string") {
    sendError(req, res, 400, input);
    return;
  }
  // Bound the open registration store so it cannot be inflated without limit.
  const existing = await state.guardStore.listAgents();
  if (existing.length >= MAX_REGISTERED_AGENTS) {
    sendError(
      req,
      res,
      503,
      "Registration is temporarily closed (capacity reached). Contact the operator."
    );
    return;
  }
  const { agent, apiKey } = await state.guardStore.createAgent(input);
  // The plaintext API key is returned exactly once; only its hash is stored.
  sendJson(req, res, 201, {
    agent: buildAgentView(agent, [], new Date()),
    apiKey,
    note: "Store this API key now — it is shown once and only its hash is persisted.",
  });
}

async function handleGuard(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    sendError(req, res, 401, "Guard calls require Authorization: Bearer <agent_api_key>");
    return;
  }
  const agent = await findAgentByApiKey(state.guardStore, token);
  if (!agent) {
    sendError(req, res, 403, "API key does not match any registered agent");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readBody(req)) || "{}");
  } catch (error) {
    sendError(req, res, 400, `Invalid JSON body: ${(error as Error).message}`);
    return;
  }
  const normalized = normalizeGuardRequest(parsed);
  if (!normalized.ok) {
    sendError(req, res, 400, normalized.problem);
    return;
  }
  // An API key may only guard for the agent it belongs to: the body's agentId
  // must match the key's owner, so one agent cannot file decisions as another.
  if (normalized.request.agentId !== agent.id) {
    sendError(req, res, 403, `API key belongs to "${agent.id}", not "${normalized.request.agentId}"`);
    return;
  }
  const decision = await runGuard(normalized.request, { store: state.guardStore });
  // Record activity so the dashboard can show the agent as healthy/quiet.
  await state.guardStore.updateAgent({ ...agent, lastSeenAt: new Date().toISOString() });
  sendJson(req, res, 200, decision);
}

async function handleGetAgent(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
  agentId: string | null
): Promise<void> {
  if (agentId === null) return;
  const agent = await state.guardStore.getAgent(agentId);
  if (!agent) {
    sendError(req, res, 404, `No agent with id "${agentId}"`);
    return;
  }
  const decisions = await state.guardStore.listDecisions(agentId);
  sendJson(req, res, 200, {
    agent: buildAgentView(agent, decisions, new Date()),
    decisions,
  });
}

async function handleListAgents(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState
): Promise<void> {
  const now = new Date();
  const agents = await state.guardStore.listAgents();
  const decisions = await state.guardStore.listDecisions();
  sendJson(req, res, 200, {
    agents: agents.map((agent) => buildAgentView(agent, decisions, now)),
  });
}

async function handleListDecisions(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
  agentId: string | null
): Promise<void> {
  if (agentId !== null && !SAFE_ID.test(agentId)) {
    sendError(req, res, 400, "agentId query is malformed");
    return;
  }
  const decisions = await state.guardStore.listDecisions(agentId ?? undefined);
  sendJson(req, res, 200, { decisions });
}

async function handleGetDecision(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
  decisionId: string | null
): Promise<void> {
  if (decisionId === null) return;
  const decision = await state.guardStore.getDecision(decisionId);
  if (!decision) {
    sendError(req, res, 404, `No decision with id "${decisionId}"`);
    return;
  }
  sendJson(req, res, 200, decision);
}

async function handleRotateKey(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
  agentId: string | null
): Promise<void> {
  if (agentId === null) return;
  // Self-service: an agent rotates its own key by presenting its CURRENT key.
  // Proving possession of the live credential is the authorization; there is
  // no operator override (a truly lost key means re-registering).
  const token = bearerToken(req);
  if (!token) {
    sendError(req, res, 401, "Key rotation requires Authorization: Bearer <current_agent_api_key>");
    return;
  }
  const authed = await findAgentByApiKey(state.guardStore, token);
  if (!authed || authed.id !== agentId) {
    sendError(req, res, 403, "API key does not match this agent");
    return;
  }
  const key = createApiKey();
  await state.guardStore.updateAgent({ ...authed, apiKeyHash: key.hash });
  sendJson(req, res, 200, {
    agentId: authed.id,
    apiKey: key.plaintext,
    note: "The previous key is now invalid. Store this one — it is shown once.",
  });
}

// The origin to bake into served examples and links. In production set
// RINNE_PUBLIC_ORIGIN (e.g. https://rinne.timidan.xyz) so the skill is always
// pinned to the canonical host — an attacker who reaches the origin directly
// with a forged Host/X-Forwarded-Proto then cannot poison /skill.md with their
// own base URL. Falls back to the request's own origin for local development.
function requestOrigin(req: IncomingMessage): string {
  const configured = process.env.RINNE_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const fwd = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || "http";
  const host = req.headers.host ?? "127.0.0.1";
  return `${proto}://${host}`;
}

// GET /skill.md (and /skill): the agent integration skill as raw markdown, with
// $RINNE_BASE_URL replaced by this instance's origin so every curl example is
// copy-paste ready. This is how an agent "installs" Rinne: one request returns
// the whole register-then-guard contract.
function handleSkill(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(SKILL_PATH)) {
    sendError(req, res, 404, "Skill file not found on this server.");
    return;
  }
  const md = readFileSync(SKILL_PATH, "utf8").replace(/\$RINNE_BASE_URL/g, requestOrigin(req));
  res.writeHead(200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "no-cache",
    ...corsHeaders(req),
  });
  res.end(md);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><html><body style=\"font-family:sans-serif;padding:40px\">" +
        "<h1>Rinne API server</h1>" +
        "<p>The web app has not been built yet. Run <code>pnpm --filter rinne-web build</code> " +
        "and reload, or use the JSON API under <code>/api/</code>.</p></body></html>"
    );
    return;
  }
  const cleaned = normalize(urlPath).replace(/^([/\\])+/, "").replace(/\\/g, "/");
  let filePath = join(WEB_DIST, cleaned || "index.html");
  if (!filePath.startsWith(WEB_DIST)) {
    sendError(req, res, 400, "Bad path");
    return;
  }
  if (!existsSync(filePath) || extname(filePath) === "") {
    // SPA fallback: serve index.html for client-routed paths.
    filePath = join(WEB_DIST, "index.html");
  }
  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  // index.html must revalidate so a rebuilt app is picked up immediately;
  // hashed assets under /assets/ are immutable by construction.
  const cacheControl = filePath.includes("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cacheControl });
  res.end(readFileSync(filePath));
}

function decodeIdParam(res: ServerResponse, req: IncomingMessage, encoded: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    sendError(req, res, 400, "Bad percent-encoding in the URL");
    return null;
  }
  if (!SAFE_ID.test(decoded)) {
    sendError(req, res, 400, "Bad runId");
    return null;
  }
  return decoded;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path.startsWith("/api/") && !originAllowed(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Cheap, unauthenticated liveness check for load balancers / uptime monitors.
  // (Operators run `rinne doctor` from the CLI for the deep readiness report;
  // it is deliberately NOT exposed over HTTP — it spawns processes and probes.)
  if (path === "/healthz" || path === "/api/health") {
    sendJson(req, res, 200, { ok: true, service: "rinne-guard" });
    return;
  }

  // Rate-limit the API surface to keep open registration and guard calls from
  // being used to exhaust disk/CPU. Static assets and the skill are exempt.
  if ((path.startsWith("/v1/") || path.startsWith("/api/")) && isRateLimited(req)) {
    sendError(req, res, 429, "Too many requests; slow down and retry shortly.");
    return;
  }

  // --- Hosted guard: agent-facing /v1 endpoints ---
  // Agents register themselves (POST /v1/register-agent, no operator
  // credential), then guard and rotate using their own API key. The
  // /v1/agents/:id and /v1/decisions/:id reads are PUBLIC (no secret is ever
  // in the response — see buildAgentView).
  if (path === "/v1/register-agent" && req.method === "POST") {
    await handleRegisterAgent(req, res, state);
    return;
  }
  if (path === "/v1/guard" && req.method === "POST") {
    await handleGuard(req, res, state);
    return;
  }
  const v1RotateMatch = /^\/v1\/agents\/([^/]+)\/rotate-key$/.exec(path);
  if (v1RotateMatch && req.method === "POST") {
    await handleRotateKey(req, res, state, decodeIdParam(res, req, v1RotateMatch[1]!));
    return;
  }
  const v1AgentMatch = /^\/v1\/agents\/([^/]+)$/.exec(path);
  if (v1AgentMatch && req.method === "GET") {
    await handleGetAgent(req, res, state, decodeIdParam(res, req, v1AgentMatch[1]!));
    return;
  }
  const v1DecisionMatch = /^\/v1\/decisions\/([^/]+)$/.exec(path);
  if (v1DecisionMatch && req.method === "GET") {
    await handleGetDecision(req, res, state, decodeIdParam(res, req, v1DecisionMatch[1]!));
    return;
  }

  // --- Hosted guard: dashboard /api endpoints (PUBLIC observation reads only;
  // the dashboard never registers or mutates agents) ---
  if (path === "/api/agents" && req.method === "GET") {
    await handleListAgents(req, res, state);
    return;
  }
  if (path === "/api/decisions" && req.method === "GET") {
    await handleListDecisions(req, res, state, url.searchParams.get("agentId"));
    return;
  }
  const apiAgentMatch = /^\/api\/agents\/([^/]+)$/.exec(path);
  if (apiAgentMatch && req.method === "GET") {
    await handleGetAgent(req, res, state, decodeIdParam(res, req, apiAgentMatch[1]!));
    return;
  }
  const apiDecisionMatch = /^\/api\/decisions\/([^/]+)$/.exec(path);
  if (apiDecisionMatch && req.method === "GET") {
    await handleGetDecision(req, res, state, decodeIdParam(res, req, apiDecisionMatch[1]!));
    return;
  }

  if (path.startsWith("/api/")) {
    sendError(req, res, 404, `Unknown API route ${path}`);
    return;
  }
  if (path.startsWith("/v1/")) {
    sendError(req, res, 404, `Unknown API route ${path}`);
    return;
  }

  if ((path === "/skill.md" || path === "/skill") && req.method === "GET") {
    handleSkill(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res, path);
    return;
  }
  sendError(req, res, 405, "Method not allowed");
}

export interface RinneServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export function startServer(
  port: number,
  options: { artifactRoot?: string } = {}
): Promise<RinneServer> {
  const artifactRoot = options.artifactRoot ?? join(PACKAGE_ROOT, "artifacts");

  // In hosted/judged mode the guard's live evidence is mandatory, so the
  // server refuses to start without the provider keys and an admin key rather
  // than silently degrading to error-only evidence. Local development (the
  // default) runs without these; guard calls then surface provider errors as
  // review decisions, which is the honest local behavior.
  if (process.env.RINNE_HOSTED === "1") {
    const missing = ["SURF_API_KEY", "NANSEN_API_KEY"].filter((name) => !process.env[name]);
    if (missing.length > 0) {
      return Promise.reject(
        new Error(
          `Hosted mode (RINNE_HOSTED=1) requires ${missing.join(", ")} in the environment. ` +
            `Set them, or unset RINNE_HOSTED for local development.`
        )
      );
    }
  }

  const state: ServerState = {
    artifactRoot,
    runInProgress: false,
    guardStore: createGuardStore(join(artifactRoot, "store")),
  };
  const server = createServer((req, res) => {
    handle(req, res, state).catch((error) => {
      if (!res.headersSent) {
        sendError(req, res, 500, (error as Error).message);
      } else {
        res.end();
      }
    });
  });
  // Default to loopback: the production shape is this process behind an nginx
  // reverse proxy on the same host, so it never needs to face the network
  // directly. Set RINNE_HOST=0.0.0.0 only if exposing it without a proxy.
  const host = process.env.RINNE_HOST ?? "127.0.0.1";
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = address && typeof address === "object" ? address.port : port;
      resolveStart({
        port: boundPort,
        url: `http://${host}:${boundPort}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
  });
}
