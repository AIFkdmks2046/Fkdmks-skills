import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "watchdog-preflight.mjs");
const NOW = "2026-10-21T23:00:00Z";
const NOW_MS = Date.parse(NOW);

const DEFAULT_STATE = {
  feature: "demo",
  slug: "demo",
  watchdog_protocol: 2,
  stage: "3-dev",
  awaiting_user: "none",
  executor: {
    kind: "manual",
    session_id: "sess-1",
    run_id: "run-1",
    heartbeat_at: "2026-10-21T22:55:00Z",
    ttl_seconds: 900,
  },
  progress: {
    current_task: 2,
    current_step: 1,
    completed_tasks: [1],
    last_commit: "abc123",
  },
  artifacts: {
    existing: ["config", "design", "plan"],
    planned: ["testcases", "issues", "reports", "review"],
  },
  watchdog_cron_id: "cron-1",
  updated: "2026-10-21 22:55",
};

function yamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (typeof item === "string" ? `"${item}"` : item)).join(", ")}]`;
  }
  return String(value);
}

function toYaml(object, indent = 0) {
  const pad = " ".repeat(indent);
  return Object.entries(object)
    .map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return `${pad}${key}:\n${toYaml(value, indent + 2)}`;
      }
      return `${pad}${key}: ${yamlValue(value)}`;
    })
    .join("\n");
}

function makeProject({ state = {}, artifacts = ["config.md", "design.md", "plan.md"], lease = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fqa-preflight-"));
  const slug = "demo";
  const stateDir = path.join(root, ".qoder", "qa", slug);
  fs.mkdirSync(stateDir, { recursive: true });
  for (const file of artifacts) {
    fs.writeFileSync(path.join(stateDir, file), `# ${file}\n`);
  }
  const merged = {
    ...DEFAULT_STATE,
    ...state,
    executor: { ...DEFAULT_STATE.executor, ...(state.executor ?? {}) },
    progress: { ...DEFAULT_STATE.progress, ...(state.progress ?? {}) },
  };
  if (state.executor && state.executor.session_id === null) delete merged.executor.session_id;
  if (state.progress && state.progress.empty) {
    merged.progress = {};
  }
  const statePath = path.join(stateDir, "workflow-state.md");
  fs.writeFileSync(statePath, `---\n${toYaml(merged)}\n---\n\n# demo\n`);
  if (lease) {
    const leaseDir = path.join(root, ".qoder", "qa", ".active-lease");
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(path.join(leaseDir, "owner.json"), JSON.stringify(lease));
  }
  return { root, slug, statePath };
}

function runPreflight(project, args = []) {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--state",
      project.statePath,
      "--slug",
      project.slug,
      "--now",
      NOW,
      ...args,
    ],
    { encoding: "utf8" },
  );
  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    output = { stdout: result.stdout, stderr: result.stderr };
  }
  return { status: result.status, output };
}

function assertDecision(result, action, exitCode) {
  assert.equal(result.output.action, action, JSON.stringify(result.output, null, 2));
  assert.equal(result.status, exitCode);
}

test("gate: awaiting_user=plan_review skips", () => {
  const project = makeProject({ state: { stage: "2-plan", awaiting_user: "plan_review" } });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "SKIP", 2);
  assert.match(result.output.reason, /plan_review/);
});

test("same-feature manual session running skips", () => {
  const project = makeProject();
  const result = runPreflight(project, ["--session-status", "running", "--any-running", "false"]);
  assertDecision(result, "SKIP", 2);
  assert.match(result.output.reason, /running/);
});

test("valid lease blocks even when target is idle", () => {
  const project = makeProject({
    lease: {
      owner_kind: "manual",
      session_id: "sess-1",
      run_id: "run-1",
      heartbeat_at: "2026-10-21T22:55:00Z",
      ttl_seconds: 900,
    },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "SKIP", 2);
  assert.match(result.output.reason, /valid lease/);
});

test("expired lease + idle target -> NUDGE", () => {
  const project = makeProject({
    lease: {
      owner_kind: "manual",
      session_id: "sess-1",
      run_id: "run-1",
      heartbeat_at: "2026-10-21T21:00:00Z",
      ttl_seconds: 900,
    },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "NUDGE", 0);
  assert.equal(result.output.target_session, "sess-1");
  assert.deepEqual(result.output.progress.completed_tasks, [1]);
  assert.equal(result.output.progress.last_commit, "abc123");
});

test("missing plan.md at stage 3-dev -> PENDING (not restart)", () => {
  const project = makeProject({ artifacts: ["config.md", "design.md"] });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /plan/);
});

test("future artifacts are not treated as required", () => {
  const project = makeProject({
    state: { artifacts: { existing: ["config", "design", "plan"], planned: [] } },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "NUDGE", 0);
});

test("stage 8-acceptance + final_acceptance -> REMOVE", () => {
  const project = makeProject({
    state: { stage: "8-acceptance", awaiting_user: "final_acceptance" },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "REMOVE", 3);
});

test("stage 8-acceptance + acceptance_blocked -> PENDING", () => {
  const project = makeProject({
    state: { stage: "8-acceptance", awaiting_user: "acceptance_blocked" },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
});

test("protocol mismatch -> PENDING", () => {
  const project = makeProject({ state: { watchdog_protocol: 1 } });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /watchdog_protocol/);
});

test("unknown target + another running session -> SKIP", () => {
  const project = makeProject({
    state: { executor: { kind: "manual", session_id: null } },
  });
  const result = runPreflight(project, ["--session-status", "missing", "--any-running", "true"]);
  assertDecision(result, "SKIP", 2);
});

test("unknown target + no running session + progress -> EXECUTE_FALLBACK", () => {
  const project = makeProject({
    state: { executor: { kind: "manual", session_id: null } },
  });
  const result = runPreflight(project, ["--session-status", "missing", "--any-running", "false"]);
  assertDecision(result, "EXECUTE_FALLBACK", 0);
});

test("unknown target + no running session + no progress -> PENDING", () => {
  const project = makeProject({
    state: {
      executor: { kind: "manual", session_id: null },
      progress: { empty: true },
    },
  });
  const result = runPreflight(project, ["--session-status", "missing", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /no progress/);
});

test("session status not supplied -> PENDING", () => {
  const project = makeProject();
  const result = runPreflight(project, ["--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /session status/);
});

test("cold target -> NUDGE", () => {
  const project = makeProject();
  const result = runPreflight(project, ["--session-status", "cold", "--any-running", "false"]);
  assertDecision(result, "NUDGE", 0);
});

test("ready target -> NUDGE", () => {
  const project = makeProject();
  const result = runPreflight(project, ["--session-status", "ready", "--any-running", "false"]);
  assertDecision(result, "NUDGE", 0);
});

test("pending interaction -> SKIP", () => {
  const project = makeProject();
  const result = runPreflight(project, [
    "--session-status",
    "idle",
    "--pending-interaction",
    "1",
    "--any-running",
    "false",
  ]);
  assertDecision(result, "SKIP", 2);
  assert.match(result.output.reason, /human attention/);
});

test("target without progress ledger -> PENDING", () => {
  const project = makeProject({ state: { progress: { empty: true } } });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /progress/);
});

test("target without executor.run_id -> PENDING (bind first)", () => {
  const project = makeProject({ state: { executor: { run_id: null } } });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /run_id/);
});

test("legacy active_lock -> PENDING (migrate first)", () => {
  const project = makeProject({ state: { active_lock: { session: "old" } } });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /active_lock/);
});

test("acceptance_blocked before stage 8 -> PENDING", () => {
  const project = makeProject({
    state: { stage: "7.5-final-review", awaiting_user: "acceptance_blocked" },
  });
  const result = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(result, "PENDING", 4);
  assert.match(result.output.reason, /blocked/);
});

function writePending(root, fingerprint, index) {
  const dir = path.join(root, ".qoder", "qa", "pending");
  fs.mkdirSync(dir, { recursive: true });
  const name = `demo-watchdog-20261021-22000${index}.md`;
  fs.writeFileSync(
    path.join(dir, name),
    `<!-- watchdog_reason: ${fingerprint} -->\n<!-- watchdog_at: 2026-10-21T22:00:00Z -->\n`,
  );
}

test("same reason within 24h -> LOG_ONLY (no duplicate pending)", () => {
  const project = makeProject({ state: { active_lock: { session: "old" } } });
  const first = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  writePending(project.root, first.output.fingerprint, 1);
  const second = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(second, "LOG_ONLY", 2);
  assert.equal(second.output.pending_history.same_reason_24h, 1);
});

test("same reason 3x within 24h -> DISABLE (exit 5)", () => {
  const project = makeProject({ state: { active_lock: { session: "old" } } });
  const first = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  for (const index of [1, 2, 3]) writePending(project.root, first.output.fingerprint, index);
  const second = runPreflight(project, ["--session-status", "idle", "--any-running", "false"]);
  assertDecision(second, "DISABLE", 5);
});
