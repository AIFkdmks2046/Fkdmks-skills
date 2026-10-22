#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PROTOCOL = 2;
const DEFAULT_TTL = 900;

function usage() {
  console.error(`Usage:
  qa-lease.mjs status  [--root <projectRoot>] [--now <iso>] [--json]
  qa-lease.mjs acquire --slug <slug> --kind manual|watchdog --session <id> --run-id <id> [--ttl 900] [--stage <stage>] [--task <n>] [--step <n>] [--root <root>]
  qa-lease.mjs renew   --slug <slug> --session <id> --run-id <id> [--ttl 900] [--stage <stage>] [--task <n>] [--step <n>] [--root <root>]
  qa-lease.mjs release --slug <slug> --session <id> --run-id <id> [--root <root>]
  qa-lease.mjs handoff --slug <slug> --from-session <id> --from-run-id <id> --to-session <id> --to-kind manual|watchdog [--to-run-id <id>] [--ttl 900] [--root <root>]`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

function fail(message, code = 1, extra = {}) {
  console.log(JSON.stringify({ ok: false, reason: message, ...extra }, null, 2));
  process.exit(code);
}

function ok(payload, code = 0) {
  console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
  process.exit(code);
}

function resolveRoot(flags) {
  return path.resolve(flags.root || process.cwd());
}

function leaseDir(root) {
  return path.join(root, ".qoder", "qa", ".active-lease");
}

function ownerPath(dir) {
  return path.join(dir, "owner.json");
}

function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(ownerPath(dir), "utf8"));
  } catch {
    return null;
  }
}

function heartbeatMs(owner) {
  const ms = Date.parse(owner?.heartbeat_at ?? "");
  return Number.isFinite(ms) ? ms : NaN;
}

function leaseAgeMs(owner, now) {
  const ms = heartbeatMs(owner);
  return Number.isFinite(ms) ? now - ms : Infinity;
}

function leaseValid(owner, now) {
  if (!owner) return false;
  const age = leaseAgeMs(owner, now);
  const ttl = Number(owner.ttl_seconds ?? DEFAULT_TTL);
  return Number.isFinite(age) && Number.isFinite(ttl) && age <= ttl * 1000;
}

function writeOwner(dir, owner) {
  const tmp = path.join(dir, `owner.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, ownerPath(dir));
}

function requireFlag(flags, key) {
  const value = flags[key];
  if (!value || value === true) fail(`missing --${key}`);
  return String(value);
}

function optionalNumber(flags, key) {
  if (flags[key] === undefined) return null;
  const value = Number(flags[key]);
  if (!Number.isFinite(value)) fail(`--${key} must be a number`);
  return value;
}

function sameOwner(owner, session, runId) {
  return Boolean(owner && owner.session_id === session && owner.run_id === runId);
}

function makeOwner({ slug, kind, session, runId, ttl, stage, task, step }, nowIso) {
  return {
    protocol: PROTOCOL,
    slug,
    owner_kind: kind,
    session_id: session,
    run_id: runId,
    stage,
    task,
    step,
    acquired_at: nowIso,
    heartbeat_at: nowIso,
    ttl_seconds: ttl,
  };
}

function validateKind(kind) {
  if (kind !== "manual" && kind !== "watchdog") {
    fail("--kind must be manual or watchdog");
  }
}

const { command, flags } = parseArgs(process.argv.slice(2));
if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 1);
}

const now = flags.now ? Date.parse(String(flags.now)) : Date.now();
if (!Number.isFinite(now)) fail("--now must be a valid ISO timestamp");
const nowIso = new Date(now).toISOString();
const root = resolveRoot(flags);
const dir = leaseDir(root);

if (command === "status") {
  if (!fs.existsSync(dir)) {
    ok({ command, lease_dir: dir, valid: false, reason: "missing", owner: null });
  }
  const owner = readOwner(dir);
  if (!owner) {
    ok({ command, lease_dir: dir, valid: false, reason: "owner-unreadable", owner: null });
  }
  const valid = leaseValid(owner, now);
  ok({
    command,
    lease_dir: dir,
    valid,
    reason: valid ? "valid" : "expired",
    age_ms: leaseAgeMs(owner, now),
    owner,
  });
}

if (command === "acquire") {
  const slug = requireFlag(flags, "slug");
  const kind = String(flags.kind ?? "manual");
  validateKind(kind);
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  const ttl = optionalNumber(flags, "ttl") ?? DEFAULT_TTL;
  if (ttl <= 0) fail("--ttl must be > 0");

  fs.mkdirSync(path.dirname(dir), { recursive: true });

  let created = false;
  try {
    fs.mkdirSync(dir);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  if (!created) {
    const owner = readOwner(dir);
    if (sameOwner(owner, session, runId)) {
      owner.heartbeat_at = nowIso;
      owner.ttl_seconds = ttl;
      writeOwner(dir, owner);
      ok({ command, acquired: true, renewed: true, lease_dir: dir, owner });
    }
    if (leaseValid(owner, now)) {
      fail("lease held by another owner", 2, {
        lease_dir: dir,
        owner,
        age_ms: leaseAgeMs(owner, now),
      });
    }
    const staleDir = `${dir}.stale-${Date.now()}-${process.pid}`;
    try {
      fs.renameSync(dir, staleDir);
    } catch (error) {
      fail("lease is stale but could not be claimed (race)", 2, {
        lease_dir: dir,
        cause: error.message,
      });
    }
    fs.rmSync(staleDir, { recursive: true, force: true });
    try {
      fs.mkdirSync(dir);
    } catch (error) {
      fail("lease was claimed by another process", 2, {
        lease_dir: dir,
        cause: error.message,
      });
    }
  }

  const owner = makeOwner(
    {
      slug,
      kind,
      session,
      runId,
      ttl,
      stage: flags.stage ? String(flags.stage) : null,
      task: optionalNumber(flags, "task"),
      step: optionalNumber(flags, "step"),
    },
    nowIso,
  );
  writeOwner(dir, owner);
  ok({ command, acquired: true, renewed: false, lease_dir: dir, owner });
}

if (command === "renew") {
  const slug = requireFlag(flags, "slug");
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  const owner = readOwner(dir);
  if (!sameOwner(owner, session, runId)) {
    fail("lease is missing or owned by someone else", 2, { lease_dir: dir, owner });
  }
  owner.heartbeat_at = nowIso;
  if (flags.ttl !== undefined) {
    const ttl = optionalNumber(flags, "ttl");
    if (ttl <= 0) fail("--ttl must be > 0");
    owner.ttl_seconds = ttl;
  }
  if (flags.stage !== undefined) owner.stage = String(flags.stage);
  if (flags.task !== undefined) owner.task = optionalNumber(flags, "task");
  if (flags.step !== undefined) owner.step = optionalNumber(flags, "step");
  owner.slug = owner.slug || slug;
  writeOwner(dir, owner);
  ok({ command, renewed: true, lease_dir: dir, owner });
}

if (command === "release") {
  requireFlag(flags, "slug");
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  if (!fs.existsSync(dir)) {
    ok({ command, released: true, lease_dir: dir, reason: "already-missing" });
  }
  const owner = readOwner(dir);
  if (!sameOwner(owner, session, runId)) {
    fail("refusing to release a lease owned by someone else", 2, {
      lease_dir: dir,
      owner,
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  ok({ command, released: true, lease_dir: dir });
}

if (command === "handoff") {
  const slug = requireFlag(flags, "slug");
  const fromSession = requireFlag(flags, "from-session");
  const fromRunId = requireFlag(flags, "from-run-id");
  const toSession = requireFlag(flags, "to-session");
  const toKind = String(flags["to-kind"] ?? "manual");
  validateKind(toKind);
  const owner = readOwner(dir);
  if (!sameOwner(owner, fromSession, fromRunId)) {
    fail("handoff source does not own the lease", 2, { lease_dir: dir, owner });
  }
  const ttl = optionalNumber(flags, "ttl") ?? DEFAULT_TTL;
  if (ttl <= 0) fail("--ttl must be > 0");
  owner.owner_kind = toKind;
  owner.session_id = toSession;
  owner.run_id = flags["to-run-id"] ? String(flags["to-run-id"]) : `handoff-${Date.now()}`;
  owner.handoff_at = nowIso;
  owner.heartbeat_at = nowIso;
  owner.ttl_seconds = ttl;
  owner.slug = owner.slug || slug;
  writeOwner(dir, owner);
  ok({ command, handed_off: true, lease_dir: dir, owner });
}

usage();
process.exit(1);
