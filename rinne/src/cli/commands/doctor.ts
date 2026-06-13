import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { surfApiBase } from "../../adapters/surf.js";
import { UsageError } from "../errors.js";

export const DOCTOR_USAGE = `Usage: rinne doctor

Checks this machine's readiness to run the Rinne server:
  - Node.js version (>= 20 required)
  - pnpm availability
  - Surf Data API reachability (the guard fetches live market data)
  - guard store directory writability (registered agents and decisions)

Exit code is 0 when nothing fails (warnings are allowed), 1 otherwise.
`;

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  message: string;
}

export interface ToolProbe {
  name: string;
  found: boolean;
  version?: string;
  // Set when the tool exists but "--version" failed; distinguishes a broken
  // installation from a missing one so the advice can differ.
  problem?: string;
}

export interface WriteProbe {
  label: string;
  path: string;
  writable: boolean;
  problem?: string;
}

export interface SurfProbe {
  url: string;
  reachable: boolean;
  problem?: string;
}

export interface DoctorFacts {
  nodeVersion: string;
  pnpm: ToolProbe;
  surfApi: SurfProbe;
  artifactDirs: WriteProbe[];
}

const MIN_NODE_MAJOR = 20;

function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : null;
}

// Pure classification of gathered facts into pass/warn/fail checks, so tests
// can exercise every outcome without depending on the host machine.
export function classifyDoctorFacts(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const major = parseNodeMajor(facts.nodeVersion);
  if (major === null) {
    checks.push({
      status: "fail",
      message: `Node.js version "${facts.nodeVersion}" is not recognizable; Node >= ${MIN_NODE_MAJOR} is required`,
    });
  } else if (major >= MIN_NODE_MAJOR) {
    checks.push({ status: "pass", message: `Node.js ${facts.nodeVersion} (>= ${MIN_NODE_MAJOR} required)` });
  } else {
    checks.push({
      status: "fail",
      message: `Node.js ${facts.nodeVersion} is too old; Rinne requires Node >= ${MIN_NODE_MAJOR}`,
    });
  }

  if (!facts.pnpm.found) {
    checks.push({
      status: "fail",
      message: "pnpm not found; Rinne's build and scripts are driven by pnpm (install from https://pnpm.io)",
    });
  } else if (facts.pnpm.problem) {
    checks.push({
      status: "fail",
      message: `pnpm is present but not working: ${facts.pnpm.problem}`,
    });
  } else {
    checks.push({
      status: "pass",
      message: `pnpm ${facts.pnpm.version ?? "(version unknown)"}`,
    });
  }

  // The guard fetches live market data from Surf, so an unreachable Surf Data
  // API means the guard can only ever return "review" for swap evidence.
  if (facts.surfApi.reachable) {
    checks.push({ status: "pass", message: `Surf Data API reachable: ${facts.surfApi.url}` });
  } else {
    checks.push({
      status: "fail",
      message:
        `Surf Data API unreachable: ${facts.surfApi.url}` +
        `${facts.surfApi.problem ? ` (${facts.surfApi.problem})` : ""}; ` +
        `the guard fetches live market data, so swaps will fall back to review until this works`,
    });
  }

  for (const dir of facts.artifactDirs) {
    if (dir.writable) {
      checks.push({ status: "pass", message: `${dir.label} writable: ${dir.path}` });
    } else {
      checks.push({
        status: "fail",
        message: `${dir.label} not writable: ${dir.path}${dir.problem ? ` (${dir.problem})` : ""}`,
      });
    }
  }

  return checks;
}

export function summarizeDoctorChecks(checks: DoctorCheck[]): { exitCode: number; line: string } {
  const fails = checks.filter((check) => check.status === "fail").length;
  const warns = checks.filter((check) => check.status === "warn").length;
  if (fails > 0) {
    return {
      exitCode: 1,
      line: `${fails} check(s) failed. Fix the FAIL items above before running Rinne.`,
    };
  }
  if (warns > 0) {
    return {
      exitCode: 0,
      line: `Ready (${warns} warning(s)). Start the server with: rinne serve`,
    };
  }
  return { exitCode: 0, line: "All checks passed. Start the server with: rinne serve" };
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const labels: Record<DoctorStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  return checks.map((check) => ` ${labels[check.status]}  ${check.message}`).join("\n");
}

function probeTool(name: string): ToolProbe {
  const result = spawnSync(name, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { name, found: false };
    }
    return { name, found: true, problem: result.error.message };
  }
  if (result.status !== 0) {
    const stderrLine = (result.stderr || "").trim().split("\n")[0];
    return {
      name,
      found: true,
      problem: stderrLine || `"${name} --version" exited with status ${result.status}`,
    };
  }
  const version = (result.stdout || "").trim().split("\n")[0];
  return { name, found: true, version: version || undefined };
}

function probeWritableDir(label: string, dir: string): WriteProbe {
  // Remember the topmost directory the probe is about to create, so a
  // diagnostic command does not permanently litter directories behind it.
  let firstCreated: string | null = null;
  if (!existsSync(dir)) {
    let candidate = dir;
    let parent = dirname(candidate);
    while (!existsSync(parent) && parent !== candidate) {
      candidate = parent;
      parent = dirname(candidate);
    }
    firstCreated = candidate;
  }
  try {
    mkdirSync(dir, { recursive: true });
    const probePath = join(dir, `.rinne-doctor-${process.pid}`);
    writeFileSync(probePath, "rinne doctor write probe\n", "utf8");
    rmSync(probePath, { force: true });
    return { label, path: dir, writable: true };
  } catch (error) {
    return { label, path: dir, writable: false, problem: (error as Error).message };
  } finally {
    if (firstCreated) {
      rmSync(firstCreated, { recursive: true, force: true });
    }
  }
}

// Compiled location is dist/src/cli/commands/, so the package root is four
// levels up. The guard store the server writes lives under this package.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SURF_PROBE_TIMEOUT_MS = 8_000;

// One lightweight GET against the Surf Data API. Any HTTP answer (even an
// auth error) proves the gateway is reachable; only network-level failures
// and timeouts count as unreachable.
async function probeSurfApi(): Promise<SurfProbe> {
  const url = surfApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SURF_PROBE_TIMEOUT_MS);
  try {
    await fetch(`${url}/v1/market/price?symbol=MNT&time_range=1d`, {
      signal: controller.signal,
    });
    return { url, reachable: true };
  } catch (error) {
    const problem =
      (error as Error).name === "AbortError"
        ? `no response within ${SURF_PROBE_TIMEOUT_MS / 1000}s`
        : (error as Error).message;
    return { url, reachable: false, problem };
  } finally {
    clearTimeout(timer);
  }
}

export async function gatherDoctorFacts(): Promise<DoctorFacts> {
  return {
    nodeVersion: process.version,
    pnpm: probeTool("pnpm"),
    surfApi: await probeSurfApi(),
    artifactDirs: [
      probeWritableDir("Guard store", join(PACKAGE_ROOT, "artifacts", "store")),
    ],
  };
}

export async function doctorCommand(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(DOCTOR_USAGE);
    return 0;
  }
  if (argv.length > 0) {
    throw new UsageError(`Unexpected argument "${argv[0]}"\n\n${DOCTOR_USAGE}`);
  }
  const checks = classifyDoctorFacts(await gatherDoctorFacts());
  const summary = summarizeDoctorChecks(checks);
  console.log("Rinne doctor\n");
  console.log(formatDoctorReport(checks));
  console.log(`\n${summary.line}`);
  return summary.exitCode;
}
