import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "qa-state.mjs");
const LEASE_SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "qa-lease.mjs");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fqa-state-"));
  const dir = path.join(root, ".qoder", "qa", "demo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "design.md"), "# design\n");
  fs.writeFileSync(path.join(dir, "plan.md"), "# plan\n");
  fs.writeFileSync(
    path.join(dir, "issues.md"),
    "# issues\n\n| ID | 级别 | 问题 | 状态 |\n|---|---|---|---|\n| ISS-001 | P2 | demo | ✅ closed |\n",
  );
  fs.writeFileSync(
    path.join(dir, "workflow-state.md"),
    `---
watchdog_protocol: 2
feature: demo
slug: demo
stage: 3-dev
awaiting_user: none
artifacts:
  design: .qoder/qa/demo/design.md
  plan: .qoder/qa/demo/plan.md
issues: { total: 1, open: 0, closed: 1 }
active_lock: { session: "old" }
updated: 2026-10-21 10:00
---

# demo
`,
  );
  return { root, dir, state: path.join(dir, "workflow-state.md") };
}

function run(command, args) {
  const result = spawnSync(process.execPath, [SCRIPT, command, ...args], { encoding: "utf8" });
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    output = { stdout: result.stdout, stderr: result.stderr };
  }
  return { status: result.status, output };
}

function writeLease(root, session, runId) {
  const dir = path.join(root, ".qoder", "qa", ".active-lease");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "owner.json"),
    JSON.stringify({
      protocol: 2,
      slug: "demo",
      owner_kind: "manual",
      session_id: session,
      run_id: runId,
      heartbeat_at: new Date().toISOString(),
      ttl_seconds: 900,
    }),
  );
}

test("doctor flags legacy lock and missing executor/progress", () => {
  const project = makeProject();
  const result = run("doctor", ["--state", project.state]);
  assert.equal(result.status, 1);
  const codes = result.output.errors.map((item) => item.code);
  assert.ok(codes.includes("active_lock_legacy"));
  assert.ok(codes.includes("executor_missing"));
  assert.ok(codes.includes("progress_missing"));
});

test("migrate requires a lease", () => {
  const project = makeProject();
  const result = run("migrate", [
    "--state",
    project.state,
    "--session",
    "s1",
    "--run-id",
    "r1",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.output.reason, /租约/);
});

test("migrate upgrades v1 to v2 and doctor passes", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  const migrated = run("migrate", [
    "--state",
    project.state,
    "--session",
    "s1",
    "--run-id",
    "r1",
  ]);
  assert.equal(migrated.status, 0, JSON.stringify(migrated.output, null, 2));
  const text = fs.readFileSync(project.state, "utf8");
  assert.match(text, /feature_id: demo/);
  assert.match(text, /executor:\n {2}kind: manual\n {2}session_id: s1/);
  assert.match(text, /progress:\n {2}current_task: 0/);
  assert.match(text, /artifacts:\n {2}existing: \["?\.qoder\/qa\/demo\/design\.md/);
  assert.doesNotMatch(text, /active_lock/);

  const doctor = run("doctor", ["--state", project.state]);
  assert.equal(doctor.status, 0, JSON.stringify(doctor.output, null, 2));
});

test("migrate is idempotent and keeps revision increasing", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  const args = ["--state", project.state, "--session", "s1", "--run-id", "r1"];
  run("migrate", args);
  const first = fs.readFileSync(project.state, "utf8").match(/revision: (\d+)/)[1];
  const second = run("migrate", args);
  assert.equal(second.status, 0);
  const text = fs.readFileSync(project.state, "utf8");
  assert.equal(text.match(/executor:/g).length, 1);
  assert.equal(text.match(/progress:/g).length, 1);
  assert.equal(Number(text.match(/revision: (\d+)/)[1]), Number(first) + 1);
});

test("list derives sessions from state files", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  run("migrate", ["--state", project.state, "--session", "s1", "--run-id", "r1"]);
  const all = run("list", ["--root", project.root]);
  assert.equal(all.output.count, 1);
  assert.deepEqual(all.output.sessions, { s1: ["demo"] });
  const filtered = run("list", ["--root", project.root, "--session", "s1"]);
  assert.equal(filtered.output.count, 1);
  const other = run("list", ["--root", project.root, "--session", "s2"]);
  assert.equal(other.output.count, 0);
});

test("bind requires the lease owner and updates executor", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  run("migrate", ["--state", project.state, "--session", "s1", "--run-id", "r1"]);
  const denied = run("bind", [
    "--state",
    project.state,
    "--session",
    "s2",
    "--run-id",
    "r2",
  ]);
  assert.equal(denied.status, 2);

  const handoff = spawnSync(
    process.execPath,
    [
      LEASE_SCRIPT,
      "handoff",
      "--slug",
      "demo",
      "--from-session",
      "s1",
      "--from-run-id",
      "r1",
      "--to-session",
      "s2",
      "--to-run-id",
      "r2",
      "--root",
      project.root,
    ],
    { encoding: "utf8" },
  );
  assert.equal(handoff.status, 0, handoff.stdout);

  const bound = run("bind", [
    "--state",
    project.state,
    "--session",
    "s2",
    "--run-id",
    "r2",
    "--feature-id",
    "c-demo",
  ]);
  assert.equal(bound.status, 0, JSON.stringify(bound.output, null, 2));
  assert.equal(bound.output.previous_session, "s1");
  assert.match(fs.readFileSync(project.state, "utf8"), /feature_id: c-demo/);
  assert.equal(run("list", ["--root", project.root, "--session", "s2"]).output.count, 1);
});

test("close requires the lease and writes done/aborted", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  run("migrate", ["--state", project.state, "--session", "s1", "--run-id", "r1"]);

  const denied = run("close", [
    "--slug",
    "demo",
    "--root",
    project.root,
    "--session",
    "s2",
    "--run-id",
    "r2",
    "--stage",
    "done",
  ]);
  assert.equal(denied.status, 2);

  const badStage = run("close", [
    "--slug",
    "demo",
    "--root",
    project.root,
    "--session",
    "s1",
    "--run-id",
    "r1",
    "--stage",
    "7-fix",
  ]);
  assert.equal(badStage.status, 1);

  const closed = run("close", [
    "--slug",
    "demo",
    "--root",
    project.root,
    "--session",
    "s1",
    "--run-id",
    "r1",
    "--stage",
    "done",
    "--reason",
    "验收通过",
  ]);
  assert.equal(closed.status, 0, JSON.stringify(closed.output, null, 2));
  const text = fs.readFileSync(project.state, "utf8");
  assert.match(text, /stage: done/);
  assert.match(text, /awaiting_user: none/);
  assert.match(text, /closed_reason:/);
  assert.equal(closed.output.previous.stage, "3-dev");
});

test("archive skips live features, dry-runs by default, then moves done ones to history", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  run("migrate", ["--state", project.state, "--session", "s1", "--run-id", "r1"]);

  const live = run("archive", ["--root", project.root]);
  assert.equal(live.output.count, 0);
  assert.equal(live.output.results[0].action, "skip");

  run("close", [
    "--slug",
    "demo",
    "--root",
    project.root,
    "--session",
    "s1",
    "--run-id",
    "r1",
    "--stage",
    "done",
  ]);
  const pendingDir = path.join(project.root, ".qoder", "qa", "pending");
  fs.mkdirSync(pendingDir, { recursive: true });
  const pendingFile = path.join(pendingDir, "demo-01-todo.md");
  fs.writeFileSync(pendingFile, "# todo\n");
  const past = new Date(Date.now() - 60 * 86400000);
  fs.utimesSync(pendingFile, past, past);

  const dry = run("archive", ["--root", project.root]);
  assert.equal(dry.output.count, 1);
  assert.equal(dry.output.results[0].action, "would-archive");
  assert.equal(dry.output.results[0].pending, 1);
  assert.equal(fs.existsSync(project.dir), true);

  const applied = run("archive", [
    "--root",
    project.root,
    "--apply",
    "--session",
    "s1",
    "--run-id",
    "r1",
  ]);
  assert.equal(applied.status, 0, JSON.stringify(applied.output, null, 2));
  assert.equal(applied.output.results[0].action, "archived");
  assert.equal(fs.existsSync(project.dir), false);
  const history = fs.readdirSync(path.join(project.root, ".qoder", "qa", "history"));
  assert.equal(history.length, 1);
  assert.match(history[0], /^demo-\d{8}$/);
  assert.equal(fs.existsSync(path.join(pendingDir, "demo-01-todo.md")), false);
  assert.equal(
    fs.existsSync(path.join(project.root, ".qoder", "qa", "archive", "demo-01-todo.md")),
    true,
  );

  const listed = run("list", ["--root", project.root]);
  assert.equal(listed.output.count, 0);
  assert.equal(listed.output.history.count, 1);

  // 归档时会把移入 archive/ 的文件 mtime 重置为归档时刻：旧的 pending 不会下一次 gc 就被删
  const gcAfterArchive = run("gc", ["--root", project.root]);
  assert.equal(gcAfterArchive.output.count, 0);
});

test("gc only removes history and archive entries past the cutoff", () => {
  const project = makeProject();
  const qaDir = path.join(project.root, ".qoder", "qa");
  const historyDir = path.join(qaDir, "history");
  const archiveDir = path.join(qaDir, "archive");
  const oldDir = path.join(historyDir, "old-feature-20260101");
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
  const newDir = path.join(historyDir, `new-feature-${today}`);
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, "report.md"), "0123456789");
  fs.mkdirSync(newDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  const oldArchiveFile = path.join(archiveDir, "demo-watchdog-20260101-0300.md");
  fs.writeFileSync(oldArchiveFile, "# old\n");
  const oldTime = new Date(Date.now() - 60 * 86400000);
  fs.utimesSync(oldArchiveFile, oldTime, oldTime);

  const dry = run("gc", ["--root", project.root]);
  assert.equal(dry.output.count, 2);
  assert.equal(fs.existsSync(oldDir), true);
  assert.equal(dry.output.bytes, 16);

  const denied = run("gc", ["--root", project.root, "--apply"]);
  assert.equal(denied.status, 1);

  writeLease(project.root, "s1", "r1");
  const applied = run("gc", [
    "--root",
    project.root,
    "--apply",
    "--session",
    "s1",
    "--run-id",
    "r1",
  ]);
  assert.equal(applied.status, 0, JSON.stringify(applied.output, null, 2));
  assert.equal(fs.existsSync(oldDir), false);
  assert.equal(fs.existsSync(oldArchiveFile), false);
  assert.equal(fs.existsSync(newDir), true);
});

test("doctor reports issues count mismatch", () => {
  const project = makeProject();
  writeLease(project.root, "s1", "r1");
  run("migrate", ["--state", project.state, "--session", "s1", "--run-id", "r1"]);
  let text = fs.readFileSync(project.state, "utf8");
  text = text.replace("issues: { total: 1, open: 0, closed: 1 }", "issues: { total: 9, open: 0, closed: 1 }");
  fs.writeFileSync(project.state, text);
  const result = run("doctor", ["--state", project.state]);
  assert.equal(result.status, 1);
  assert.ok(result.output.errors.some((item) => item.code === "issues_count_mismatch"));
});
