import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "qa-lease.mjs");

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fqa-lease-"));
}

function run(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], {
    encoding: "utf8",
  });
  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    output = { stdout: result.stdout, stderr: result.stderr };
  }
  return { status: result.status, output };
}

function leaseDir(root) {
  return path.join(root, ".qoder", "qa", ".active-lease");
}

function writeOwner(root, owner) {
  const dir = leaseDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner));
}

const base = ["--slug", "demo"];
const ownerArgs = ["--session", "sess-1", "--run-id", "run-1"];

test("acquire creates a valid lease; second owner is rejected", () => {
  const root = makeRoot();
  const acquired = run(root, ["acquire", ...base, "--kind", "manual", ...ownerArgs, "--ttl", "900"]);
  assert.equal(acquired.status, 0, JSON.stringify(acquired.output));
  assert.equal(acquired.output.owner.session_id, "sess-1");
  assert.equal(acquired.output.owner.run_id, "run-1");

  const status = run(root, ["status"]);
  assert.equal(status.status, 0);
  assert.equal(status.output.valid, true);

  const conflict = run(root, [
    "acquire",
    ...base,
    "--kind",
    "watchdog",
    "--session",
    "sess-2",
    "--run-id",
    "run-2",
  ]);
  assert.equal(conflict.status, 2);
  assert.match(conflict.output.reason, /held by another owner/);
});

test("renew updates heartbeat and rejects a different owner", () => {
  const root = makeRoot();
  run(root, ["acquire", ...base, "--kind", "manual", ...ownerArgs]);
  const renewed = run(root, [
    "renew",
    ...base,
    ...ownerArgs,
    "--stage",
    "3-dev",
    "--task",
    "2",
    "--step",
    "1",
  ]);
  assert.equal(renewed.status, 0, JSON.stringify(renewed.output));
  assert.equal(renewed.output.owner.stage, "3-dev");
  assert.equal(renewed.output.owner.task, 2);
  assert.equal(renewed.output.owner.step, 1);

  const rejected = run(root, [
    "renew",
    ...base,
    "--session",
    "sess-2",
    "--run-id",
    "run-2",
  ]);
  assert.equal(rejected.status, 2);
});

test("handoff transfers ownership", () => {
  const root = makeRoot();
  run(root, ["acquire", ...base, "--kind", "watchdog", "--session", "watchdog-1", "--run-id", "wrun-1"]);
  const handed = run(root, [
    "handoff",
    ...base,
    "--from-session",
    "watchdog-1",
    "--from-run-id",
    "wrun-1",
    "--to-session",
    "sess-1",
    "--to-kind",
    "manual",
    "--to-run-id",
    "run-1",
    "--ttl",
    "900",
  ]);
  assert.equal(handed.status, 0, JSON.stringify(handed.output));
  assert.equal(handed.output.owner.session_id, "sess-1");
  assert.equal(handed.output.owner.owner_kind, "manual");

  const status = run(root, ["status"]);
  assert.equal(status.output.owner.session_id, "sess-1");
  assert.equal(status.output.owner.run_id, "run-1");
});

test("release refuses a non-owner and removes the owner lease", () => {
  const root = makeRoot();
  run(root, ["acquire", ...base, "--kind", "manual", ...ownerArgs]);

  const rejected = run(root, [
    "release",
    ...base,
    "--session",
    "sess-2",
    "--run-id",
    "run-2",
  ]);
  assert.equal(rejected.status, 2);
  assert.equal(run(root, ["status"]).output.valid, true);

  const released = run(root, ["release", ...base, ...ownerArgs]);
  assert.equal(released.status, 0, JSON.stringify(released.output));
  assert.equal(fs.existsSync(leaseDir(root)), false);
});

test("stale lease is claimable", () => {
  const root = makeRoot();
  writeOwner(root, {
    protocol: 2,
    slug: "demo",
    owner_kind: "manual",
    session_id: "dead-session",
    run_id: "dead-run",
    heartbeat_at: "2020-01-01T00:00:00Z",
    ttl_seconds: 900,
  });
  const acquired = run(root, [
    "acquire",
    ...base,
    "--kind",
    "watchdog",
    "--session",
    "watchdog-2",
    "--run-id",
    "wrun-2",
  ]);
  assert.equal(acquired.status, 0, JSON.stringify(acquired.output));
  assert.equal(acquired.output.owner.session_id, "watchdog-2");
});

test("status reports expired lease with --now", () => {
  const root = makeRoot();
  run(root, ["acquire", ...base, "--kind", "manual", ...ownerArgs, "--ttl", "60"]);
  const status = run(root, ["status", "--now", "2030-01-01T00:00:00Z"]);
  assert.equal(status.status, 0);
  assert.equal(status.output.valid, false);
  assert.match(status.output.reason, /expired/);
});
