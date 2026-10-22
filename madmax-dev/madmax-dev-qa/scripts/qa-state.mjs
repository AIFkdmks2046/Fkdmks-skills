#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const PROTOCOL = 2;
const DEFAULT_TTL = 900;

export const STAGE_RANK = new Map(
  [
    "0-prd",
    "1-design",
    "2-plan",
    "3-dev",
    "3.5-code-review",
    "4-testcase",
    "5-testcase-review",
    "6-e2e",
    "7-fix",
    "7.5-final-review",
    "8-acceptance",
    "8.5-wrapup",
    "done",
    "aborted",
  ].map((stage, index) => [stage, index]),
);

const STAGE_REQUIREMENTS = [
  ["1-design", ["design.md"]],
  ["2-plan", ["plan.md"]],
  ["3.5-code-review", ["code-review.md"]],
  ["4-testcase", ["test-cases.md"]],
  ["5-testcase-review", ["test-review-r*.md"]],
  ["6-e2e", ["test-report-r*.md", "issues.md"]],
  ["7.5-final-review", ["final-review.md"]],
  ["8-acceptance", ["acceptance-summary.md"]],
];

const ARTIFACT_ALIASES = {
  config: ["config.md"],
  design: ["design.md"],
  plan: ["plan.md"],
  testcases: ["test-cases.md", "testcases.md"],
  issues: ["issues.md"],
  reports: ["test-report-r*.md"],
  review: ["code-review.md", "final-review.md"],
  final_review: ["final-review.md"],
  acceptance: ["acceptance-summary.md"],
  flaky: ["flaky.md"],
};

const DENY_STAGED = [
  /^\.qoder\/qa\/\.active-lease\//,
  /^\.qoder\/qa\/[^/]+\/watchdog-log\.md$/,
  /^\.qoder\/qa\/[^/]+\/evidence\//,
  /^\.qoder\/qa\/history\//,
];

export function requirementsFor(stage) {
  const rank = STAGE_RANK.get(stage);
  if (rank === undefined || stage === "done" || stage === "aborted") return [];
  const required = [];
  for (const [atStage, files] of STAGE_REQUIREMENTS) {
    if (STAGE_RANK.get(atStage) <= rank) required.push(...files);
  }
  return required;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseValue(raw) {
  const value = String(raw).trim();
  if (value === "") return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitTopLevel(inner, ",").map((item) => parseValue(item)) : [];
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const inner = value.slice(1, -1).trim();
    const object = {};
    if (!inner) return object;
    for (const entry of splitTopLevel(inner, ",")) {
      const separator = entry.indexOf(":");
      if (separator === -1) continue;
      object[entry.slice(0, separator).trim()] = parseValue(entry.slice(separator + 1));
    }
    return object;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  let current = null;
  for (const raw of match[1].split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ")) continue;
    const indent = raw.match(/^(\s*)/)[1].length;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rest = trimmed.slice(separator + 1).trim();
    if (indent === 0) {
      if (rest === "") {
        data[key] = {};
        current = key;
      } else {
        data[key] = parseValue(rest);
        current = null;
      }
    } else if (current && indent >= 2 && data[current] && typeof data[current] === "object") {
      data[current][key] = rest === "" ? {} : parseValue(rest);
    }
  }
  return data;
}

export function splitFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  return { head: match[1], body: String(text).slice(match[0].length) };
}

export function projectRootFor(statePath) {
  return path.resolve(path.dirname(statePath), "..", "..", "..");
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function globMatch(name, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

function findInDir(dir, pattern) {
  return listDir(dir)
    .filter((name) => globMatch(name, pattern))
    .map((name) => path.join(dir, name));
}

function artifactFiles(entry, stateDir, projectRoot) {
  const raw = String(entry).trim();
  if (!raw) return [];
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? [raw] : [];
  if (raw.includes("/") || raw.startsWith(".") || raw.endsWith(".md")) {
    const base = raw.startsWith(".qoder/") || raw.includes("/") ? projectRoot : stateDir;
    const abs = path.resolve(base, raw);
    return fs.existsSync(abs) ? [abs] : [];
  }
  const patterns = ARTIFACT_ALIASES[raw] ?? [`${raw}.md`];
  const dirs = raw === "config" ? [stateDir, path.join(projectRoot, ".qoder", "qa")] : [stateDir];
  const found = [];
  for (const dir of dirs) {
    for (const pattern of patterns) found.push(...findInDir(dir, pattern));
  }
  return found;
}

function hasStageArtifact(pattern, stateDir) {
  return findInDir(stateDir, pattern).length > 0;
}

function latestByRound(dir, prefix) {
  const files = listDir(dir)
    .map((name) => {
      const match = name.match(new RegExp(`^${prefix}-r(\\d+)\\.md$`));
      return match ? { name, round: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.round - a.round);
  return files.length ? path.join(dir, files[0].name) : null;
}

function normalizeStatus(raw) {
  const text = String(raw).toLowerCase();
  if (/closed|verified|已关闭|已修复/.test(text)) return "closed";
  if (/skipped|跳过/.test(text)) return "skipped";
  if (/open|fixing|待裁决|待办|未修|待修/.test(text)) return "open";
  return "unknown";
}

export function parseIssues(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const idIndex = cells.findIndex((cell) => /^ISS-\d+/i.test(cell));
    if (idIndex === -1) continue;
    const id = cells[idIndex].match(/^ISS-\d+/i)[0].toUpperCase();
    let level = null;
    for (const cell of cells.slice(idIndex + 1)) {
      const match = cell.match(/\b(P0|P1|P2)\b/);
      if (match) {
        level = match[1];
        break;
      }
    }
    if (!level) continue;
    const status = normalizeStatus(cells[cells.length - 1]);
    rows.push({ id, level, status });
  }
  const counts = { total: rows.length, open: 0, closed: 0, skipped: 0 };
  for (const row of rows) {
    if (row.status === "closed") counts.closed += 1;
    else if (row.status === "skipped") counts.skipped += 1;
    else counts.open += 1;
  }
  return { rows, counts };
}

function readVerdict(file) {
  const head = fs.readFileSync(file, "utf8").slice(0, 4000);
  const explicit = head.match(/(?:^|\n)\s*(?:结论|verdict|result)\s*[:：]?\s*(PASS|FAIL|通过|不通过)/i);
  if (explicit) return /FAIL|不通过/i.test(explicit[1]) ? "fail" : "pass";
  const bold = head.match(/\*\*(FAIL|PASS)\*\*/i);
  if (bold) return bold[1].toUpperCase() === "FAIL" ? "fail" : "pass";
  return "unknown";
}

function failedCaseIds(reportFile) {
  const ids = new Set();
  for (const line of fs.readFileSync(reportFile, "utf8").split(/\r?\n/)) {
    if (!/❌|FAIL|失败|转红/.test(line)) continue;
    for (const id of line.match(/\b(?:TC-[A-Z]+-\d+[a-z]?|S\d+)\b/g) ?? []) ids.add(id);
  }
  return [...ids];
}

function add(list, code, message, blocking) {
  list.push({ code, message, blocking });
}

export function checkState(statePath, options = {}) {
  const projectRoot = options.projectRoot ?? projectRootFor(statePath);
  const stateDir = path.dirname(statePath);
  const errors = [];
  const warnings = [];

  let text;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    add(errors, "state_unreadable", error.message, true);
    return { ok: false, stage: null, errors, warnings, issues: null };
  }
  const state = parseFrontmatter(text);
  if (!state) {
    add(errors, "frontmatter_missing", "状态文件缺少可解析的 frontmatter", true);
    return { ok: false, stage: null, errors, warnings, issues: null };
  }

  const stage = String(state.stage ?? "").trim();
  const rank = STAGE_RANK.get(stage);
  if (rank === undefined) add(errors, "stage_invalid", `非法 stage：${stage || "(空)"}`, true);
  if (Number(state.watchdog_protocol) !== PROTOCOL) {
    add(errors, "protocol_mismatch", `watchdog_protocol 应为 ${PROTOCOL}`, true);
  }
  if ("active_lock" in state) {
    add(errors, "active_lock_legacy", "残留旧协议 active_lock；先跑 qa-state migrate", true);
  }
  if (!state.feature_id) {
    add(warnings, "feature_id_missing", "缺少稳定 feature_id；建议 migrate/bind 补齐", false);
  }

  const executor = state.executor && typeof state.executor === "object" ? state.executor : {};
  if (!executor.session_id) {
    add(errors, "executor_missing", "缺少 executor.session_id（看护无法定位原会话）", true);
  } else if (!executor.run_id) {
    add(errors, "executor_run_missing", "executor.run_id 为空", true);
  }

  const progress = state.progress && typeof state.progress === "object" ? state.progress : {};
  const hasProgress = Boolean(
    progress.current_task ||
      progress.current_step ||
      (Array.isArray(progress.completed_tasks) && progress.completed_tasks.length) ||
      progress.last_commit,
  );
  if (!("progress" in state)) {
    const blocking = rank !== undefined && rank >= STAGE_RANK.get("3-dev");
    add(errors, "progress_missing", "缺少 progress 进度账本", blocking);
  } else if (!hasProgress) {
    add(warnings, "progress_empty", "progress 为空；接续将只能从头开始，EXECUTE_FALLBACK 不可用", false);
  }
  if (!state.revision) add(warnings, "revision_missing", "缺少 revision", false);
  if (!state.updated) add(warnings, "updated_missing", "缺少 updated", false);

  const artifacts = state.artifacts && typeof state.artifacts === "object" ? state.artifacts : {};
  let existing = [];
  if (Array.isArray(artifacts.existing)) {
    existing = artifacts.existing;
  } else {
    existing = Object.entries(artifacts)
      .filter(([key]) => key !== "existing" && key !== "planned")
      .map(([, value]) => value);
  }
  for (const entry of existing) {
    if (!artifactFiles(entry, stateDir, projectRoot).length) {
      add(errors, `artifact_missing:${entry}`, `artifacts.existing 登记但文件不存在：${entry}`, true);
    }
  }

  const required = requirementsFor(stage);
  const missingRequired = required.filter((pattern) => !hasStageArtifact(pattern, stateDir));
  if (missingRequired.length) {
    add(errors, "stage_artifact_missing", `当前阶段缺少产物：${missingRequired.join(", ")}`, true);
  }

  if (rank !== undefined && rank > STAGE_RANK.get("5-testcase-review")) {
    const reviewFile = latestByRound(stateDir, "test-review");
    if (reviewFile) {
      const verdict = readVerdict(reviewFile);
      if (verdict === "fail") {
        add(errors, "test_review_failed", `最新用例审查判 FAIL：${path.basename(reviewFile)}`, true);
      } else if (verdict === "unknown") {
        add(warnings, "test_review_unknown", `无法判定用例审查结论：${path.basename(reviewFile)}`, false);
      }
    }
  }

  const issuesFile = path.join(stateDir, "issues.md");
  let issues = null;
  if (fs.existsSync(issuesFile)) {
    issues = parseIssues(issuesFile);
    const declared = state.issues && typeof state.issues === "object" ? state.issues : {};
    for (const key of ["total", "open", "closed"]) {
      if (declared[key] === undefined) continue;
      if (Number(declared[key]) !== issues.counts[key]) {
        add(
          errors,
          "issues_count_mismatch",
          `frontmatter issues.${key}=${declared[key]}，issues.md 实算 ${issues.counts[key]}`,
          false,
        );
      }
    }
    if (rank !== undefined && rank >= STAGE_RANK.get("8-acceptance")) {
      const openBlocking = issues.rows.filter(
        (row) => row.status !== "closed" && row.status !== "skipped" && (row.level === "P0" || row.level === "P1"),
      );
      if (openBlocking.length) {
        add(
          errors,
          "p01_open_at_acceptance",
          `验收阶段仍有未关闭的 P0/P1：${openBlocking.map((row) => row.id).join(", ")}`,
          true,
        );
      }
    }
  }

  const reportFile = latestByRound(stateDir, "test-report");
  if (reportFile && issues) {
    const issuesText = fs.readFileSync(issuesFile, "utf8");
    const flakyFile = path.join(stateDir, "flaky.md");
    const flakyText = fs.existsSync(flakyFile) ? fs.readFileSync(flakyFile, "utf8") : "";
    const known = (id) =>
      new RegExp(`\\b${escapeRe(id)}\\b`).test(issuesText) ||
      new RegExp(`\\b${escapeRe(id)}\\b`).test(flakyText);
    const unmapped = failedCaseIds(reportFile).filter((id) => !known(id));
    if (unmapped.length) {
      add(
        warnings,
        "failed_case_unmapped",
        `最新报告中的失败用例未进 issues.md / flaky.md：${unmapped.join(", ")}`,
        false,
      );
    }
  }

  if (!options.skipRepoChecks) {
    const gitignore = path.join(projectRoot, ".gitignore");
    if (fs.existsSync(gitignore)) {
      const lines = fs
        .readFileSync(gitignore, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const missing = [
        ["lease", [".qoder/qa/.active-lease/", ".qoder/qa/.active-lease", ".active-lease/"]],
        ["evidence", [".qoder/qa/*/evidence/", ".qoder/qa/*/evidence", "evidence/"]],
        ["watchdog-log", [".qoder/qa/*/watchdog-log.md", "watchdog-log.md"]],
        ["history", [".qoder/qa/history/", ".qoder/qa/history", "history/"]],
      ].filter(([, patterns]) => !patterns.some((pattern) => lines.includes(pattern)));
      if (missing.length) {
        add(
          warnings,
          "gitignore_missing",
          `.gitignore 缺少规则：${missing.map(([name]) => name).join(", ")}`,
          false,
        );
      }
    } else {
      add(warnings, "gitignore_missing", "项目根缺少 .gitignore", false);
    }

    const staged = spawnSync("git", ["-C", projectRoot, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    if (staged.status === 0) {
      const denied = staged.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((file) => DENY_STAGED.some((pattern) => pattern.test(file)));
      if (denied.length) {
        add(warnings, "staged_denied_path", `暂存区含不应入库的路径：${denied.join(", ")}`, false);
      }
    }
  }

  return {
    ok: errors.length === 0,
    state: statePath,
    slug: state.slug ?? path.basename(stateDir),
    feature_id: state.feature_id ?? null,
    stage: stage || null,
    awaiting_user: state.awaiting_user ?? "none",
    errors,
    warnings,
    issues: issues ? issues.counts : null,
  };
}

function fail(message, code = 1, extra = {}) {
  console.log(JSON.stringify({ ok: false, reason: message, ...extra }, null, 2));
  process.exit(code);
}

function ok(payload, code = 0) {
  console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
  process.exit(code);
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

function requireFlag(flags, key) {
  const value = flags[key];
  if (!value || value === true) fail(`missing --${key}`, 1);
  return String(value);
}

function nowLocal() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return parts.replace("T", " ");
}

function defaultFeatureId(slug) {
  const text = String(slug);
  if (/^[A-Za-z0-9._-]+$/.test(text)) return text;
  return `feature-${createHash("sha1").update(text).digest("hex").slice(0, 8)}`;
}

function yamlStr(value) {
  const text = String(value);
  return /^[A-Za-z0-9._/-]+$/.test(text) ? text : JSON.stringify(text);
}

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTopKey(lines, key) {
  return lines.findIndex((line) => new RegExp(`^${escapeRe(key)}\\s*:`).test(line));
}

function removeTopBlock(lines, key) {
  const index = findTopKey(lines, key);
  if (index === -1) return lines;
  let end = index + 1;
  while (end < lines.length && lines[end].trim() !== "" && indentOf(lines[end]) > 0) end += 1;
  return [...lines.slice(0, index), ...lines.slice(end)];
}

function insertAtAfter(lines, afterKey) {
  if (!afterKey) return lines.length;
  const index = findTopKey(lines, afterKey);
  if (index === -1) return lines.length;
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor].trim() !== "" && indentOf(lines[cursor]) > 0) cursor += 1;
  return cursor;
}

function setScalar(lines, key, value, afterKey = null) {
  const rendered = `${key}: ${value}`;
  const index = findTopKey(lines, key);
  if (index !== -1) {
    lines[index] = rendered;
    return false;
  }
  if (key === "watchdog_protocol") {
    lines.unshift(rendered);
    return true;
  }
  lines.splice(afterKey ? insertAtAfter(lines, afterKey) : lines.length, 0, rendered);
  return true;
}

function setBlock(lines, key, blockLines, afterKey) {
  const removed = removeTopBlock(lines, key);
  const existed = removed.length !== lines.length;
  const rendered = [`${key}:`, ...blockLines.map((line) => `  ${line}`)];
  removed.splice(insertAtAfter(removed, afterKey), 0, ...rendered);
  return { lines: removed, existed };
}

function requireLeaseAt(root, session, runId) {
  const ownerPath = path.join(root, ".qoder", "qa", ".active-lease", "owner.json");
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    owner = null;
  }
  if (!owner) {
    fail("写操作需要先 qa-lease acquire（当前无有效租约）", 2, { lease: ownerPath, root });
  }
  const age = Date.now() - Date.parse(owner.heartbeat_at ?? "");
  const ttl = Number(owner.ttl_seconds ?? DEFAULT_TTL);
  if (!(Number.isFinite(age) && age <= ttl * 1000)) {
    fail("租约已过期；先 qa-lease renew 或 acquire", 2, { lease: ownerPath, owner });
  }
  if (owner.session_id !== session || owner.run_id !== runId) {
    fail("租约不属于 --session/--run-id", 2, { lease: ownerPath, owner });
  }
}

function requireLease(statePath, session, runId) {
  requireLeaseAt(projectRootFor(statePath), session, runId);
}

function writeState(statePath, headLines, body) {
  const tmp = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `---\n${headLines.join("\n")}\n---\n${body}`, "utf8");
  fs.renameSync(tmp, statePath);
}

function readStateText(statePath) {
  try {
    return fs.readFileSync(statePath, "utf8");
  } catch (error) {
    fail(`状态文件不可读：${error.message}`, 1, { state: statePath });
    return "";
  }
}

function migrateCommand(flags) {
  const statePath = path.resolve(requireFlag(flags, "state"));
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  const dryRun = Boolean(flags["dry-run"]);
  if (!dryRun) requireLease(statePath, session, runId);

  const text = readStateText(statePath);
  const split = splitFrontmatter(text);
  const parsed = parseFrontmatter(text);
  if (!split || !parsed) fail("frontmatter 缺失或不可解析", 1, { state: statePath });

  const currentExecutor =
    parsed.executor && typeof parsed.executor === "object" ? parsed.executor : {};
  if (
    currentExecutor.session_id &&
    currentExecutor.session_id !== session &&
    !flags.force
  ) {
    fail(
      `state.executor 属于另一个会话 ${currentExecutor.session_id}；确认接管请加 --force`,
      2,
      { state: statePath },
    );
  }

  const changes = [];
  let lines = split.head.split(/\r?\n/);

  if (Number(parsed.watchdog_protocol) !== PROTOCOL) {
    setScalar(lines, "watchdog_protocol", String(PROTOCOL));
    changes.push(`watchdog_protocol -> ${PROTOCOL}`);
  }

  const slug = parsed.slug ?? path.basename(path.dirname(statePath));
  if (!parsed.feature_id) {
    const featureId = flags["feature-id"] ? String(flags["feature-id"]) : defaultFeatureId(slug);
    if (!/^[A-Za-z0-9._-]+$/.test(featureId)) {
      fail("feature_id 只能包含字母、数字、点、下划线、连字符；请用 --feature-id 指定", 1);
    }
    setScalar(lines, "feature_id", yamlStr(featureId), "slug");
    changes.push(`feature_id = ${featureId}`);
  }

  const executorBlock = [
    `kind: ${currentExecutor.kind ?? "manual"}`,
    `session_id: ${yamlStr(session)}`,
    `run_id: ${yamlStr(runId)}`,
    `heartbeat_at: ${yamlStr(new Date().toISOString())}`,
    `ttl_seconds: ${Number(currentExecutor.ttl_seconds ?? DEFAULT_TTL)}`,
  ];
  const executorSet = setBlock(lines, "executor", executorBlock, "awaiting_user");
  lines = executorSet.lines;
  changes.push(executorSet.existed ? "executor 已更新" : "executor 已补齐");

  const progress =
    parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {};
  const completed = Array.isArray(progress.completed_tasks) ? progress.completed_tasks : [];
  const progressBlock = [
    `current_task: ${Number(progress.current_task ?? 0)}`,
    `current_step: ${Number(progress.current_step ?? 0)}`,
    `completed_tasks: [${completed.map((item) => yamlStr(item)).join(", ")}]`,
    `last_commit: ${yamlStr(progress.last_commit ?? "")}`,
  ];
  const progressSet = setBlock(lines, "progress", progressBlock, "executor");
  lines = progressSet.lines;
  changes.push(progressSet.existed ? "progress 已保留/补齐" : "progress 已补齐（空账本，需人工核对）");

  const artifacts =
    parsed.artifacts && typeof parsed.artifacts === "object" ? parsed.artifacts : {};
  let existing = [];
  let planned = [];
  if (Array.isArray(artifacts.existing)) {
    existing = artifacts.existing;
    planned = Array.isArray(artifacts.planned) ? artifacts.planned : [];
  } else {
    existing = Object.entries(artifacts)
      .filter(([key]) => key !== "existing" && key !== "planned")
      .map(([, value]) => String(value));
  }
  const artifactsSet = setBlock(
    lines,
    "artifacts",
    [
      `existing: [${existing.map((item) => yamlStr(item)).join(", ")}]`,
      `planned: [${planned.map((item) => yamlStr(item)).join(", ")}]`,
    ],
    "progress",
  );
  lines = artifactsSet.lines;
  changes.push(Array.isArray(artifacts.existing) ? "artifacts 已是 v2" : "artifacts map -> existing/planned");

  if ("active_lock" in parsed) {
    lines = removeTopBlock(lines, "active_lock");
    changes.push("已删除 active_lock");
  }

  setScalar(lines, "revision", String(Number(parsed.revision ?? 0) + 1));
  setScalar(lines, "updated_by", yamlStr(`migrate:${session}`));
  setScalar(lines, "updated", yamlStr(nowLocal()));
  changes.push("revision + 1");

  if (!dryRun) writeState(statePath, lines, split.body);

  ok({
    command: "migrate",
    state: statePath,
    dry_run: dryRun,
    changes,
    warnings: progressSet.existed ? [] : ["progress 为空账本：请按 plan / git log 补齐 current_task/step/completed_tasks/last_commit"],
  });
}

function bindCommand(flags) {
  const statePath = path.resolve(requireFlag(flags, "state"));
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  requireLease(statePath, session, runId);

  const text = readStateText(statePath);
  const split = splitFrontmatter(text);
  const parsed = parseFrontmatter(text);
  if (!split || !parsed) fail("frontmatter 缺失或不可解析", 1, { state: statePath });

  const featureId = flags["feature-id"]
    ? String(flags["feature-id"])
    : String(parsed.feature_id ?? defaultFeatureId(parsed.slug ?? path.basename(path.dirname(statePath))));
  if (!/^[A-Za-z0-9._-]+$/.test(featureId)) {
    fail("feature_id 只能包含字母、数字、点、下划线、连字符", 1);
  }

  let lines = split.head.split(/\r?\n/);
  if (Number(parsed.watchdog_protocol) !== PROTOCOL) {
    setScalar(lines, "watchdog_protocol", String(PROTOCOL));
  }
  if (!parsed.feature_id || flags["feature-id"]) {
    setScalar(lines, "feature_id", yamlStr(featureId), "slug");
  }
  const currentExecutor =
    parsed.executor && typeof parsed.executor === "object" ? parsed.executor : {};
  const executor = {
    kind: flags.kind ? String(flags.kind) : (currentExecutor.kind ?? "manual"),
    session_id: session,
    run_id: runId,
    heartbeat_at: new Date().toISOString(),
    ttl_seconds: Number(flags.ttl ?? currentExecutor.ttl_seconds ?? DEFAULT_TTL),
  };
  const executorSet = setBlock(
    lines,
    "executor",
    [
      `kind: ${executor.kind}`,
      `session_id: ${yamlStr(executor.session_id)}`,
      `run_id: ${yamlStr(executor.run_id)}`,
      `heartbeat_at: ${yamlStr(executor.heartbeat_at)}`,
      `ttl_seconds: ${executor.ttl_seconds}`,
    ],
    "awaiting_user",
  );
  lines = executorSet.lines;
  setScalar(lines, "revision", String(Number(parsed.revision ?? 0) + 1));
  setScalar(lines, "updated_by", yamlStr(`bind:${session}`));
  setScalar(lines, "updated", yamlStr(nowLocal()));
  writeState(statePath, lines, split.body);

  ok({
    command: "bind",
    state: statePath,
    feature_id: featureId,
    previous_session: currentExecutor.session_id ?? null,
    executor,
  });
}

function qaPaths(root) {
  const qaDir = path.join(root, ".qoder", "qa");
  return {
    qaDir,
    pendingDir: path.join(qaDir, "pending"),
    archiveDir: path.join(qaDir, "archive"),
    historyDir: path.join(qaDir, "history"),
  };
}

function findStateBySlug(root, slug) {
  const statePath = path.join(qaPaths(root).qaDir, slug, "workflow-state.md");
  if (!fs.existsSync(statePath)) fail(`找不到功能状态文件：${statePath}`, 1, { root, slug });
  return statePath;
}

function stampDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(ms))
    .replace(/-/g, "");
}

function parseStamp(text, endOfDay) {
  for (const match of String(text).matchAll(/(\d{8})(?:-(\d{4}))?/g)) {
    const [, day, clock] = match;
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(4, 6));
    const date = Number(day.slice(6, 8));
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || date < 1 || date > 31) continue;
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const time = clock
      ? `${clock.slice(0, 2)}:${clock.slice(2, 4)}:00`
      : endOfDay
        ? "23:59:59"
        : "00:00:00";
    const ms = Date.parse(`${iso}T${time}+08:00`);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function entryTime(target, endOfDay) {
  const stamp = parseStamp(path.basename(target), endOfDay);
  if (stamp !== null) return stamp;
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return Date.now();
  }
}

function sizeOf(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return 0;
  }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return listDir(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

function ageDays(ms) {
  return Math.floor((Date.now() - ms) / 86400000);
}

function uniquePath(dir, base, isDir) {
  const ext = isDir ? "" : path.extname(base);
  const stem = isDir ? base : base.slice(0, base.length - ext.length);
  let candidate = path.join(dir, base);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function featureDirs(root) {
  const { qaDir } = qaPaths(root);
  const reserved = new Set(["pending", "archive", "history", "config.md", ".active-lease"]);
  const items = [];
  for (const name of listDir(qaDir)) {
    if (reserved.has(name) || name.startsWith(".")) continue;
    const dir = path.join(qaDir, name);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const statePath = path.join(dir, "workflow-state.md");
    if (!fs.existsSync(statePath)) continue;
    const parsed = parseFrontmatter(fs.readFileSync(statePath, "utf8")) ?? {};
    items.push({
      slug: String(parsed.slug ?? name),
      dir,
      statePath,
      stage: parsed.stage ? String(parsed.stage) : null,
      awaiting_user: parsed.awaiting_user ? String(parsed.awaiting_user) : "none",
      watchdog_cron_id: parsed.watchdog_cron_id ? String(parsed.watchdog_cron_id) : null,
    });
  }
  return items;
}

function closeCommand(flags) {
  const root = path.resolve(flags.root ? String(flags.root) : process.cwd());
  const slug = requireFlag(flags, "slug");
  const stage = String(flags.stage ?? "aborted");
  if (stage !== "done" && stage !== "aborted") fail("--stage 只能是 done 或 aborted", 1);
  const session = requireFlag(flags, "session");
  const runId = requireFlag(flags, "run-id");
  const statePath = findStateBySlug(root, slug);
  requireLeaseAt(root, session, runId);

  const text = readStateText(statePath);
  const split = splitFrontmatter(text);
  const parsed = parseFrontmatter(text);
  if (!split || !parsed) fail("frontmatter 缺失或不可解析", 1, { state: statePath });

  const previous = {
    stage: parsed.stage ?? null,
    awaiting_user: parsed.awaiting_user ?? "none",
  };
  const lines = split.head.split(/\r?\n/);
  setScalar(lines, "stage", stage);
  setScalar(lines, "awaiting_user", "none");
  setScalar(lines, "closed_at", yamlStr(nowLocal()));
  if (flags.reason) setScalar(lines, "closed_reason", yamlStr(String(flags.reason)));
  setScalar(lines, "revision", String(Number(parsed.revision ?? 0) + 1));
  setScalar(lines, "updated_by", yamlStr(`close:${session}`));
  setScalar(lines, "updated", yamlStr(nowLocal()));
  writeState(statePath, lines, split.body);

  ok({
    command: "close",
    state: statePath,
    slug: parsed.slug ?? slug,
    previous,
    stage,
    awaiting_user: "none",
    reason: flags.reason ? String(flags.reason) : null,
    watchdog_cron_id: parsed.watchdog_cron_id ?? null,
    next: "有 watchdog_cron_id 时先 qoder_cron remove；随后 qa-state archive",
  });
}

function archiveCommand(flags) {
  const root = path.resolve(flags.root ? String(flags.root) : process.cwd());
  const apply = Boolean(flags.apply);
  const slugFilter = flags.slug ? String(flags.slug) : null;
  const candidates = featureDirs(root).filter(
    (item) => !slugFilter || item.slug === slugFilter || path.basename(item.dir) === slugFilter,
  );
  if (slugFilter && !candidates.length) fail(`找不到功能：${slugFilter}`, 1, { root });

  if (apply && !flags.force) {
    requireLeaseAt(root, requireFlag(flags, "session"), requireFlag(flags, "run-id"));
  }

  const { historyDir, pendingDir, archiveDir } = qaPaths(root);
  const date = stampDate();
  const results = [];
  for (const item of candidates) {
    if (item.stage !== "done" && item.stage !== "aborted") {
      results.push({ slug: item.slug, action: "skip", reason: `stage=${item.stage}（只归档 done/aborted）` });
      continue;
    }
    const dest = uniquePath(historyDir, `${path.basename(item.dir)}-${date}`, true);
    const prefixes = new Set([path.basename(item.dir), item.slug]);
    const pending = listDir(pendingDir).filter(
      (name) => name.endsWith(".md") && [...prefixes].some((prefix) => name.startsWith(`${prefix}-`)),
    );
    if (!apply) {
      results.push({
        slug: item.slug,
        action: "would-archive",
        from: item.dir,
        to: dest,
        pending: pending.length,
        watchdog_cron_id: item.watchdog_cron_id,
      });
      continue;
    }
    fs.mkdirSync(historyDir, { recursive: true });
    fs.renameSync(item.dir, dest);
    const movedPending = [];
    for (const name of pending) {
      fs.mkdirSync(archiveDir, { recursive: true });
      const target = uniquePath(archiveDir, name, false);
      fs.renameSync(path.join(pendingDir, name), target);
      const archivedAt = new Date();
      fs.utimesSync(target, archivedAt, archivedAt);
      movedPending.push(path.basename(target));
    }
    results.push({
      slug: item.slug,
      action: "archived",
      from: item.dir,
      to: dest,
      pending_moved: movedPending,
      watchdog_cron_id: item.watchdog_cron_id,
    });
  }

  ok({
    command: "archive",
    apply,
    dry_run: !apply,
    history: historyDir,
    count: results.filter((item) => item.action === "archived" || item.action === "would-archive").length,
    results,
  });
}

function gcCommand(flags) {
  const root = path.resolve(flags.root ? String(flags.root) : process.cwd());
  const olderThan = Number(flags["older-than"] ?? 30);
  if (!Number.isFinite(olderThan) || olderThan < 0) fail("--older-than 需要非负天数", 1);
  const apply = Boolean(flags.apply);
  if (apply && !flags.force) {
    requireLeaseAt(root, requireFlag(flags, "session"), requireFlag(flags, "run-id"));
  }

  const { historyDir, archiveDir } = qaPaths(root);
  const cutoff = Date.now() - olderThan * 86400000;
  const targets = [];
  for (const [kind, dir] of [
    ["history", historyDir],
    ["archive", archiveDir],
  ]) {
    for (const name of listDir(dir)) {
      const target = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(target);
      } catch {
        continue;
      }
      // history 用目录名里的归档日；archive 用文件时间（archive 会把移入文件 mtime 重置为归档时刻）
      const time = kind === "history" ? entryTime(target, true) : stat.mtimeMs;
      if (time < cutoff) {
        targets.push({ kind, path: target, is_dir: stat.isDirectory(), time, size: sizeOf(target) });
      }
    }
  }

  const deleted = new Set();
  for (const item of targets) {
    const parent = path.resolve(path.dirname(item.path));
    const expected = path.resolve(item.kind === "history" ? historyDir : archiveDir);
    if (parent !== expected) fail(`拒绝删除非历史路径：${item.path}`, 1);
    if (!apply) continue;
    fs.rmSync(item.path, { recursive: true, force: false });
    deleted.add(item.path);
  }

  ok({
    command: "gc",
    apply,
    dry_run: !apply,
    older_than_days: olderThan,
    cutoff: new Date(cutoff).toISOString(),
    count: targets.length,
    bytes: targets.reduce((sum, item) => sum + item.size, 0),
    targets: targets.map((item) => ({
      kind: item.kind,
      path: item.path,
      age_days: ageDays(item.time),
      size: item.size,
      deleted: deleted.has(item.path),
    })),
  });
}

function listCommand(flags) {
  const root = path.resolve(flags.root ? String(flags.root) : process.cwd());
  const qaDir = path.join(root, ".qoder", "qa");
  const features = [];
  for (const name of listDir(qaDir)) {
    const statePath = path.join(qaDir, name, "workflow-state.md");
    if (!fs.existsSync(statePath)) continue;
    const parsed = parseFrontmatter(fs.readFileSync(statePath, "utf8")) ?? {};
    const check = checkState(statePath, { projectRoot: root });
    const executor = parsed.executor && typeof parsed.executor === "object" ? parsed.executor : {};
    features.push({
      slug: check.slug,
      feature_id: check.feature_id,
      stage: check.stage,
      awaiting_user: check.awaiting_user,
      session_id: executor.session_id ?? null,
      run_id: executor.run_id ?? null,
      watchdog_cron_id: parsed.watchdog_cron_id ?? null,
      updated: parsed.updated ?? null,
      state: statePath,
      errors: check.errors.map((item) => item.code),
      warnings: check.warnings.map((item) => item.code),
    });
  }
  const sessionFilter = flags.session ? String(flags.session) : null;
  const visible = sessionFilter
    ? features.filter((feature) => feature.session_id === sessionFilter)
    : features;
  const sessions = {};
  for (const feature of features) {
    if (!feature.session_id) continue;
    sessions[feature.session_id] ??= [];
    sessions[feature.session_id].push(feature.slug);
  }
  const { historyDir } = qaPaths(root);
  const historyNames = listDir(historyDir).filter((name) => {
    try {
      return fs.statSync(path.join(historyDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const stale = historyNames.filter(
    (name) => entryTime(path.join(historyDir, name), true) < Date.now() - 30 * 86400000,
  );
  ok({
    command: "list",
    root,
    filter_session: sessionFilter,
    count: visible.length,
    features: visible,
    sessions,
    history: {
      path: historyDir,
      count: historyNames.length,
      stale_after_days: 30,
      stale: stale.length,
      hint: stale.length ? "有历史功能超过 30 天，可跑 qa-state gc --apply" : null,
    },
  });
}

function doctorCommand(flags) {
  const statePath = path.resolve(requireFlag(flags, "state"));
  const result = checkState(statePath, {
    projectRoot: flags.root ? path.resolve(String(flags.root)) : undefined,
  });
  const strict = Boolean(flags.strict);
  const failed = result.errors.length > 0 || (strict && result.warnings.length > 0);
  console.log(
    JSON.stringify(
      {
        command: "doctor",
        ok: !failed,
        strict,
        ...result,
        summary: { errors: result.errors.length, warnings: result.warnings.length },
      },
      null,
      2,
    ),
  );
  process.exit(failed ? 1 : 0);
}

function usage() {
  console.error(`Usage:
  qa-state.mjs doctor --state <workflow-state.md> [--root <projectRoot>] [--strict]
  qa-state.mjs migrate --state <state> --session <id> --run-id <id> [--feature-id <id>] [--force] [--dry-run]
  qa-state.mjs list [--root <projectRoot>] [--session <id>]
  qa-state.mjs bind --state <state> --session <id> --run-id <id> [--feature-id <id>] [--kind manual|watchdog]
  qa-state.mjs close --slug <slug> --session <id> --run-id <id> --stage done|aborted [--reason <text>] [--root <root>]
  qa-state.mjs archive [--slug <slug>] [--root <root>] [--apply] [--session <id> --run-id <id> | --force]
  qa-state.mjs gc [--root <root>] [--older-than <days>] [--apply] [--session <id> --run-id <id> | --force]

archive 把 done/aborted 的功能目录移入 .qoder/qa/history/<slug>-<YYYYMMDD>/，并把同 slug 的 pending 移入 archive/；默认 dry-run。
gc 清理 history/ 与 archive/ 中超过 N 天（默认 30）的条目；默认 dry-run。
Write commands (migrate without --dry-run, bind, close, archive --apply, gc --apply) require a valid workspace lease owned by --session/--run-id (or --force for archive/gc).
Exit codes: 0 = ok, 1 = doctor errors / usage, 2 = lease or identity conflict.`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "-h" || command === "--help") {
    usage();
    process.exit(command ? 0 : 1);
  }
  if (command === "doctor") doctorCommand(flags);
  if (command === "migrate") migrateCommand(flags);
  if (command === "list") listCommand(flags);
  if (command === "bind") bindCommand(flags);
  if (command === "close") closeCommand(flags);
  if (command === "archive") archiveCommand(flags);
  if (command === "gc") gcCommand(flags);
  usage();
  process.exit(1);
}

export {
  migrateCommand,
  bindCommand,
  listCommand,
  doctorCommand,
  closeCommand,
  archiveCommand,
  gcCommand,
};
