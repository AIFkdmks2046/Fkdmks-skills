#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  STAGE_RANK,
  parseFrontmatter,
  checkState,
  projectRootFor,
} from "./qa-state.mjs";

const PROTOCOL = 2;
const DEFAULT_TTL = 900;
const DAY_MS = 24 * 60 * 60 * 1000;

// 这些错误由 doctor 负责；看护不因它们停下（executor 缺失走 EXECUTE_FALLBACK）
const PREFLIGHT_IGNORE = new Set([
  "executor_missing",
  "issues_count_mismatch",
  "p01_open_at_acceptance",
]);

function usage() {
  console.error(`Usage:
  watchdog-preflight.mjs --state <workflow-state.md> [--slug <slug>] [--root <projectRoot>] [--lease-dir <dir>]
    [--pending-dir <dir>] [--session-status running|ready|idle|turn_completed|cold|interrupted|failed|needs_attention|missing|unknown]
    [--pending-interaction <n>] [--any-running true|false] [--now <iso>] [--json]

Exit codes: 0 = NUDGE / EXECUTE_FALLBACK, 2 = SKIP / LOG_ONLY, 3 = REMOVE, 4 = PENDING, 5 = DISABLE, 1 = usage error.`);
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function leaseAgeMs(owner, now) {
  const heartbeat = Date.parse(owner?.heartbeat_at ?? "");
  return Number.isFinite(heartbeat) ? now - heartbeat : Infinity;
}

function readLease(dir, now) {
  if (!fs.existsSync(dir)) {
    return { valid: false, reason: "missing", owner: null, age_ms: null, lease_dir: dir };
  }
  const owner = readJson(path.join(dir, "owner.json"));
  if (!owner) {
    return { valid: false, reason: "owner-unreadable", owner: null, age_ms: null, lease_dir: dir };
  }
  const age = leaseAgeMs(owner, now);
  const ttl = Number(owner.ttl_seconds ?? DEFAULT_TTL);
  const valid = Number.isFinite(age) && Number.isFinite(ttl) && age <= ttl * 1000;
  return { valid, reason: valid ? "valid" : "expired", owner, age_ms: age, lease_dir: dir };
}

function result(action, exitCode, reason, details) {
  return { action, exit_code: exitCode, reason, ...details };
}

function fingerprintOf(code, detail) {
  const hash = createHash("sha1").update(`${code}::${detail}`).digest("hex").slice(0, 10);
  const prefix = String(code).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  return `${prefix}-${hash}`;
}

function pendingHistory(dir, slug) {
  if (!fs.existsSync(dir)) return [];
  const prefix = `${slug}-watchdog-`;
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith(".md") &&
        !name.includes("-watchdog-disabled-"),
    )
    .map((name) => {
      const file = path.join(dir, name);
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8").slice(0, 8192);
      } catch {
        return null;
      }
      const fingerprint = text.match(/watchdog_reason:\s*([^\s<>*]+)/)?.[1] ?? null;
      const at = text.match(/watchdog_at:\s*([^\n<>*]+)/)?.[1]?.trim() ?? null;
      const parsed = Date.parse(at ?? "");
      const ms = Number.isFinite(parsed) ? parsed : fs.statSync(file).mtimeMs;
      return { file, fingerprint, at, ms };
    })
    .filter(Boolean)
    .sort((a, b) => b.ms - a.ms);
}

function pendingDecision(reason, fingerprint, details, now, pendingDir, slug) {
  const history = pendingHistory(pendingDir, slug);
  const recent = history.filter((item) => now - item.ms <= DAY_MS);
  const lastThree = recent.slice(0, 3);
  const sameReason = recent.filter((item) => item.fingerprint === fingerprint);
  const historyInfo = {
    dir: pendingDir,
    same_reason_24h: sameReason.length,
    consecutive_same_reason: lastThree.filter((item) => item.fingerprint === fingerprint).length,
    latest: recent[0]?.file ?? null,
  };
  if (
    lastThree.length >= 3 &&
    lastThree.every((item) => item.fingerprint === fingerprint)
  ) {
    return result("DISABLE", 5, `${reason}（同一原因 24h 内已连续 3 次）`, {
      ...details,
      fingerprint,
      pending_history: historyInfo,
    });
  }
  if (sameReason.length) {
    return result("LOG_ONLY", 2, `${reason}（24h 内已有同因待办，不重复写）`, {
      ...details,
      fingerprint,
      pending_history: historyInfo,
    });
  }
  return result("PENDING", 4, reason, {
    ...details,
    fingerprint,
    pending_history: historyInfo,
  });
}

function decide(flags) {
  if (!flags.state || flags.state === true) {
    console.error("missing --state");
    process.exit(1);
  }

  const statePath = path.resolve(String(flags.state));
  const stateDir = path.dirname(statePath);
  const slug = flags.slug ? String(flags.slug) : path.basename(stateDir);
  const projectRoot = flags.root ? path.resolve(String(flags.root)) : projectRootFor(statePath);
  const leaseDir = flags["lease-dir"]
    ? path.resolve(String(flags["lease-dir"]))
    : path.resolve(projectRoot, ".qoder", "qa", ".active-lease");
  const pendingDir = flags["pending-dir"]
    ? path.resolve(String(flags["pending-dir"]))
    : path.resolve(projectRoot, ".qoder", "qa", "pending");
  const now = flags.now ? Date.parse(String(flags.now)) : Date.now();
  if (!Number.isFinite(now)) {
    console.error("--now must be a valid ISO timestamp");
    process.exit(1);
  }

  const sessionStatus = String(flags["session-status"] ?? "unknown").toLowerCase();
  const pendingInteraction = Number(flags["pending-interaction"] ?? 0);
  const anyRunningSupplied = flags["any-running"] !== undefined;
  const anyRunning = String(flags["any-running"]) === "true";

  const base = {
    slug,
    state: statePath,
    project_root: projectRoot,
    lease_dir: leaseDir,
    session_status: sessionStatus,
    any_running: anyRunning,
    any_running_supplied: anyRunningSupplied,
    protocol: null,
    stage: null,
    awaiting_user: null,
    target_session: null,
    progress: null,
    pending_interaction: Number.isFinite(pendingInteraction) ? pendingInteraction : 0,
    lease: null,
    errors: [],
    warnings: [],
  };

  let text;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    return pendingDecision(
      `state file unreadable: ${error.message}`,
      fingerprintOf("state-unreadable", error.message),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  const state = parseFrontmatter(text);
  if (!state) {
    return pendingDecision(
      "state frontmatter is missing or unreadable",
      fingerprintOf("frontmatter-missing", slug),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  const stage = String(state.stage ?? "").trim();
  const awaiting = String(state.awaiting_user ?? "none").trim() || "none";
  const protocol = Number(state.watchdog_protocol ?? NaN);
  const executor = state.executor && typeof state.executor === "object" ? state.executor : {};
  const progress = state.progress && typeof state.progress === "object" ? state.progress : {};
  const target = executor.session_id ? String(executor.session_id) : "";
  const completedTasks = Array.isArray(progress.completed_tasks) ? progress.completed_tasks : [];
  const hasProgress = Boolean(
    progress.current_task ||
      progress.current_step ||
      completedTasks.length ||
      progress.last_commit,
  );

  Object.assign(base, {
    protocol: Number.isFinite(protocol) ? protocol : null,
    stage,
    awaiting_user: awaiting,
    target_session: target || null,
    progress: {
      current_task: progress.current_task ?? null,
      current_step: progress.current_step ?? null,
      completed_tasks: completedTasks,
      last_commit: progress.last_commit ?? null,
      has_progress: hasProgress,
    },
    run_id: executor.run_id ?? null,
    requires_run_id: !executor.run_id,
  });

  if (stage === "done" || stage === "aborted") {
    return result("REMOVE", 3, `stage=${stage}`, base);
  }

  if (!STAGE_RANK.has(stage)) {
    return pendingDecision(
      `invalid stage: ${stage || "(empty)"}`,
      fingerprintOf("invalid-stage", stage || "(empty)"),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (protocol !== PROTOCOL) {
    return pendingDecision(
      `watchdog_protocol mismatch: expected ${PROTOCOL}, got ${Number.isFinite(protocol) ? protocol : "missing"}`,
      fingerprintOf("protocol-mismatch", String(protocol)),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (awaiting === "review_blocked") {
    return pendingDecision(
      `use-case review is blocked at ${stage}; human arbitration required`,
      fingerprintOf("review-blocked", stage),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (stage === "8-acceptance" || stage === "8") {
    if (awaiting === "final_acceptance") {
      return result("REMOVE", 3, "final acceptance reached; remove watchdog and notify user", base);
    }
    if (awaiting === "acceptance_blocked") {
      return pendingDecision(
        "acceptance is blocked; human intervention required",
        fingerprintOf("acceptance-blocked", "8-acceptance"),
        base,
        now,
        pendingDir,
        slug,
      );
    }
    if (awaiting !== "none") {
      return result("SKIP", 2, `waiting at gate: awaiting_user=${awaiting}`, base);
    }
    return pendingDecision(
      "stage 8-acceptance without awaiting_user=final_acceptance",
      fingerprintOf("acceptance-state-missing", stage),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (awaiting === "acceptance_blocked") {
    return pendingDecision(
      `acceptance is blocked at ${stage}; human intervention required`,
      fingerprintOf("acceptance-blocked", stage),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (awaiting !== "none") {
    return result("SKIP", 2, `awaiting_user=${awaiting}`, base);
  }

  const lease = readLease(leaseDir, now);
  base.lease = lease;
  if (lease.valid) {
    return result(
      "SKIP",
      2,
      `valid lease held by ${lease.owner.owner_kind}:${lease.owner.session_id}`,
      base,
    );
  }

  if (sessionStatus === "running") {
    return result("SKIP", 2, "target session is running", base);
  }
  if (sessionStatus === "needs_attention" || pendingInteraction > 0) {
    return result("SKIP", 2, "target session needs human attention", base);
  }

  if (target && !hasProgress) {
    return pendingDecision(
      `target session ${target} has no progress ledger; refusing to nudge from scratch`,
      fingerprintOf("progress-missing", target),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (target && !executor.run_id) {
    return pendingDecision(
      `target session ${target} has no executor.run_id; run qa-state bind before resuming`,
      fingerprintOf("run-id-missing", target),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  const check = checkState(statePath, { projectRoot, skipRepoChecks: true });
  base.errors = check.errors;
  base.warnings = check.warnings;
  const blockingErrors = check.errors.filter(
    (item) => item.blocking && !PREFLIGHT_IGNORE.has(item.code),
  );
  if (blockingErrors.length) {
    return pendingDecision(
      `state integrity errors: ${blockingErrors.map((item) => item.code).join(", ")}`,
      fingerprintOf(
        blockingErrors[0].code,
        blockingErrors.map((item) => item.code).join("|"),
      ),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (!target) {
    if (!anyRunningSupplied) {
      return pendingDecision(
        "target session is unknown and --any-running was not supplied",
        fingerprintOf("target-unknown", "any-running-missing"),
        base,
        now,
        pendingDir,
        slug,
      );
    }
    if (anyRunning) {
      return result(
        "SKIP",
        2,
        "target session unknown; another session is running in this workspace",
        base,
      );
    }
    if (hasProgress) {
      return result(
        "EXECUTE_FALLBACK",
        0,
        "target session unknown and no session is running; progress ledger exists",
        base,
      );
    }
    return pendingDecision(
      "target session unknown and no progress ledger; refusing to start fresh",
      fingerprintOf("target-unknown-no-progress", slug),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (
    sessionStatus === "idle" ||
    sessionStatus === "ready" ||
    sessionStatus === "turn_completed" ||
    sessionStatus === "cold" ||
    sessionStatus === "interrupted" ||
    sessionStatus === "failed"
  ) {
    return result("NUDGE", 0, `target session is ${sessionStatus}; resume it`, base);
  }

  if (sessionStatus === "missing") {
    if (!anyRunningSupplied) {
      return pendingDecision(
        "target session is missing and --any-running was not supplied",
        fingerprintOf("target-missing", "any-running-missing"),
        base,
        now,
        pendingDir,
        slug,
      );
    }
    if (anyRunning) {
      return result(
        "SKIP",
        2,
        "target session is missing; another session is running in this workspace",
        base,
      );
    }
    if (hasProgress) {
      return result("EXECUTE_FALLBACK", 0, "target session is missing; progress ledger exists", base);
    }
    return pendingDecision(
      "target session is missing and no progress ledger; refusing to start fresh",
      fingerprintOf("target-missing-no-progress", slug),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  if (sessionStatus === "unknown") {
    return pendingDecision(
      "session status was not supplied by the supervisor",
      fingerprintOf("session-status-unknown", slug),
      base,
      now,
      pendingDir,
      slug,
    );
  }

  return pendingDecision(
    `unhandled session status: ${sessionStatus}`,
    fingerprintOf("session-status-invalid", sessionStatus),
    base,
    now,
    pendingDir,
    slug,
  );
}

const flags = parseArgs(process.argv.slice(2));
if (flags.help || flags.h) {
  usage();
  process.exit(0);
}
const decision = decide(flags);
console.log(JSON.stringify(decision, null, 2));
process.exit(decision.exit_code);
