/**
 * supervise: task -> Codex turn -> collect diff -> audit -> correction -> re-check.
 *
 * The loop is dependency-injectable (runTurn / collectDiff / audit) so unit tests
 * can cover clean, corrected and unresolved outcomes without spending quota.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auditChange } from "./audit.js";
import { defaultStateDir } from "./codex-home.js";
import { buildCorrectionPrompt } from "./prompt.js";
import { collectDiff, runCodex } from "./runner.js";

const REPLY_EXCERPT = 4000;

/** Low-confidence candidates are audit hints, not correction orders. */
export function actionableFindings(findings = []) {
  return findings.filter(
    (finding) =>
      finding.severity === "error" ||
      (finding.severity === "warning" && finding.confidence !== "low"),
  );
}

function truncate(text, max = REPLY_EXCERPT) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function appendHistory(stateDir, entry) {
  const dir = stateDir || defaultStateDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, "history.jsonl");
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  return file;
}

export async function supervise(
  {
    task,
    cwd = process.cwd(),
    maxRounds = 3,
    threadId = null,
    model = null,
    sandbox = "workspace-write",
    timeoutMs,
    stateDir = defaultStateDir(),
  } = {},
  deps = {},
) {
  const runTurn = deps.runTurn || runCodex;
  const collect = deps.collectDiff || collectDiff;
  const audit = deps.audit || auditChange;

  const startedAt = Date.now();
  const startedIso = new Date().toISOString();
  const max = Math.max(1, Math.min(Number(maxRounds) || 3, 10));

  const report = {
    ok: true,
    status: "clean",
    task,
    cwd,
    thread_id: threadId || null,
    rounds: [],
    final_findings: [],
    actionable_count: 0,
    history_file: null,
    started_at: startedIso,
    finished_at: null,
    duration_ms: 0,
  };

  if (typeof task !== "string" || !task.trim()) {
    return { ...report, ok: false, status: "error", error: "task 不能为空", finished_at: new Date().toISOString() };
  }

  let prompt = task;
  let currentThread = threadId || null;

  for (let round = 1; round <= max; round += 1) {
    const turn = await runTurn({
      prompt,
      cwd,
      threadId: currentThread,
      model,
      sandbox,
      timeoutMs,
      stateDir,
    });

    if (!turn?.ok) {
      report.ok = false;
      report.status = "error";
      report.error = turn?.error || "codex 调用失败";
      report.rounds.push({ round, ok: false, error: report.error, thread_id: currentThread });
      break;
    }

    currentThread = turn.threadId || currentThread;
    const collected = await collect({ cwd });
    const diffText = collected?.ok
      ? [collected.diff, collected.stagedDiff].filter(Boolean).join("\n")
      : "";
    const auditResult = audit({ diff: diffText, reply: turn.reply || "" });
    const findings = auditResult?.findings || [];
    const actionable = actionableFindings(findings);

    const roundRecord = {
      round,
      ok: true,
      thread_id: currentThread,
      duration_ms: turn.duration_ms ?? null,
      reply: truncate(turn.reply),
      findings: findings.length,
      actionable: actionable.length,
      findings_detail: findings.slice(0, 20),
      corrected: false,
    };
    if (!collected?.ok) roundRecord.diff_error = collected?.error || "diff 采集失败";

    report.rounds.push(roundRecord);
    report.thread_id = currentThread;
    report.final_findings = findings;
    report.actionable_count = actionable.length;

    if (actionable.length === 0) {
      report.status = "clean";
      break;
    }
    if (round === max) {
      report.status = "unresolved";
      break;
    }

    roundRecord.corrected = true;
    prompt = buildCorrectionPrompt({ findings: actionable, task, round, maxRounds: max, cwd });
  }

  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - startedAt;

  const historyEntry = {
    ts: report.finished_at,
    task,
    cwd,
    max_rounds: max,
    status: report.status,
    rounds: report.rounds.length,
    findings_total: report.final_findings.length,
    actionable: report.actionable_count,
    thread_id: report.thread_id,
  };
  try {
    report.history_file = await appendHistory(stateDir, historyEntry);
  } catch (error) {
    report.history_error = String(error?.message || error);
  }

  return report;
}
