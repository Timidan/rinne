import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDoctorFacts,
  formatDoctorReport,
  gatherDoctorFacts,
  summarizeDoctorChecks,
  type DoctorFacts,
} from "../src/cli/commands/doctor.js";
import { startStubSurf, useSurfUrl } from "./helpers.js";

function makeFacts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeVersion: "v22.10.0",
    pnpm: { name: "pnpm", found: true, version: "10.0.0" },
    surfApi: { url: "http://stub", reachable: true },
    artifactDirs: [{ label: "Guard store", path: "artifacts/store", writable: true }],
    ...overrides,
  };
}

test("doctor classifies a fully healthy machine as all pass", () => {
  const checks = classifyDoctorFacts(makeFacts());
  assert.ok(checks.every((check) => check.status === "pass"));
  const summary = summarizeDoctorChecks(checks);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.line, "All checks passed. Start the server with: rinne serve");
});

test("doctor fails on Node older than the floor", () => {
  const checks = classifyDoctorFacts(makeFacts({ nodeVersion: "v18.19.0" }));
  const nodeCheck = checks.find((check) => check.message.includes("Node.js"));
  assert.equal(nodeCheck?.status, "fail");
  assert.match(nodeCheck.message, /requires Node >= 20/);
  assert.equal(summarizeDoctorChecks(checks).exitCode, 1);
});

test("doctor Node floor is inclusive: v20.x passes, v19.x fails", () => {
  const atFloor = classifyDoctorFacts(makeFacts({ nodeVersion: "v20.11.0" }));
  const atFloorCheck = atFloor.find((check) => check.message.includes("Node.js"));
  assert.equal(atFloorCheck?.status, "pass");

  const belowFloor = classifyDoctorFacts(makeFacts({ nodeVersion: "v19.9.0" }));
  const belowFloorCheck = belowFloor.find((check) => check.message.includes("Node.js"));
  assert.equal(belowFloorCheck?.status, "fail");
});

test("doctor fails on an unrecognizable Node version", () => {
  const checks = classifyDoctorFacts(makeFacts({ nodeVersion: "weird" }));
  const nodeCheck = checks.find((check) => check.message.includes("Node.js"));
  assert.equal(nodeCheck?.status, "fail");
});

test("doctor fails when pnpm is missing", () => {
  const checks = classifyDoctorFacts(makeFacts({ pnpm: { name: "pnpm", found: false } }));
  const pnpmCheck = checks.find((check) => check.message.includes("pnpm"));
  assert.equal(pnpmCheck?.status, "fail");
  assert.equal(summarizeDoctorChecks(checks).exitCode, 1);
});

test("doctor distinguishes a broken pnpm from a missing one", () => {
  const checks = classifyDoctorFacts(
    makeFacts({ pnpm: { name: "pnpm", found: true, problem: "corepack download failed" } })
  );
  const pnpmCheck = checks.find((check) => check.message.includes("pnpm"));
  assert.equal(pnpmCheck?.status, "fail");
  assert.match(pnpmCheck.message, /present but not working: corepack download failed/);
  assert.doesNotMatch(pnpmCheck.message, /not found/);
});

test("doctor passes when the Surf Data API is reachable", () => {
  const checks = classifyDoctorFacts(
    makeFacts({ surfApi: { url: "http://127.0.0.1:8787", reachable: true } })
  );
  const surfCheck = checks.find((check) => check.message.includes("Surf Data API"));
  assert.equal(surfCheck?.status, "pass");
  assert.match(surfCheck.message, /Surf Data API reachable: http:\/\/127\.0\.0\.1:8787/);
});

test("doctor fails when the Surf Data API is unreachable", () => {
  const checks = classifyDoctorFacts(
    makeFacts({
      surfApi: { url: "https://api.surf.example", reachable: false, problem: "fetch failed" },
    })
  );
  const surfCheck = checks.find((check) => check.message.includes("Surf Data API"));
  assert.equal(surfCheck?.status, "fail");
  assert.match(surfCheck.message, /Surf Data API unreachable/);
  assert.match(surfCheck.message, /fetch failed/);
  assert.equal(summarizeDoctorChecks(checks).exitCode, 1);
});

test("doctor fails when the guard store directory is not writable", () => {
  const checks = classifyDoctorFacts(
    makeFacts({
      artifactDirs: [
        { label: "Guard store", path: "/no/permission/store", writable: false, problem: "EACCES" },
      ],
    })
  );
  const dirCheck = checks.find((check) => check.message.includes("Guard store"));
  assert.equal(dirCheck?.status, "fail");
  assert.match(dirCheck.message, /EACCES/);
  assert.equal(summarizeDoctorChecks(checks).exitCode, 1);
});

test("doctor report formatting labels every status clearly", () => {
  const report = formatDoctorReport([
    { status: "pass", message: "Node.js v22.10.0" },
    { status: "warn", message: "something minor" },
    { status: "fail", message: "pnpm not found" },
  ]);
  assert.match(report, / PASS {2}Node\.js v22\.10\.0/);
  assert.match(report, / WARN {2}something minor/);
  assert.match(report, / FAIL {2}pnpm not found/);
});

test("doctor fact gathering probes the real Surf API and store directory", async () => {
  // Point the live Surf probe at a local stub so this never depends on the
  // real gateway being reachable from the test machine.
  const surf = await startStubSurf();
  useSurfUrl(surf.url);
  try {
    const facts = await gatherDoctorFacts();
    assert.ok(facts.nodeVersion.length > 0);
    assert.equal(facts.surfApi.url, surf.url);
    assert.equal(facts.surfApi.reachable, true);
    assert.ok(facts.artifactDirs.length >= 1);
    assert.ok(facts.artifactDirs.some((dir) => dir.label === "Guard store"));
  } finally {
    await surf.close();
  }
});
