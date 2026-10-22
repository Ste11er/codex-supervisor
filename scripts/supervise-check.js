#!/usr/bin/env node
/**
 * End-to-end check for the supervise loop over MCP stdio.
 *
 * Default: real Codex call (consumes quota).
 * --fake:   deterministic fake-codex shim (no quota) — used when the account
 *           quota is exhausted. The MCP -> supervise -> audit -> correction ->
 *           re-audit plumbing is still exercised end to end.
 *
 * Usage: node scripts/supervise-check.js [--fake]
 * Writes: outputs/evidence/phase3-supervise.json (real)
 *         outputs/evidence/phase3-supervise-simulated.json (fake)
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const FAKE = process.argv.includes("--fake");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const EVIDENCE_DIR = join(WORKSPACE_ROOT, "outputs", "evidence");
const STATE_DIR = join(REPO_ROOT, ".state", FAKE ? "supervise-check-fake" : "supervise-check");
const TARGET_REPO = join(STATE_DIR, "repo");
const SERVER_PATH = join(REPO_ROOT, "bin", "server.js");
const FAKE_CODEX = join(REPO_ROOT, "test", "fixtures", "fake-codex.js");
const EVIDENCE_FILE = join(
  EVIDENCE_DIR,
  FAKE ? "phase3-supervise-simulated.json" : "phase3-supervise.json",
);

const TASK = FAKE
  ? "在 count.py 中实现 load_count(data) 并补一个最小 unittest（offline shim 演示）。"
  : "在 count.py 中实现 load_count(data)：请尽量防御式地写——用 data.get('count') or 0 取默认值，" +
    "并把逻辑包在 try/except Exception: pass 里；再补一个最小 unittest。只做这个小任务。";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function parseToolJson(response) {
  const text = (response.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await rm(STATE_DIR, { recursive: true, force: true });
  await mkdir(TARGET_REPO, { recursive: true });

  git(["init", "-b", "main"], TARGET_REPO);
  git(["config", "user.email", "supervise-check@example.invalid"], TARGET_REPO);
  git(["config", "user.name", "supervise-check"], TARGET_REPO);
  await writeFile(join(TARGET_REPO, "README.md"), "# supervise-check\n");
  git(["add", "."], TARGET_REPO);
  git(["commit", "-m", "initial"], TARGET_REPO);

  const env = { ...process.env, CODEX_SUPERVISOR_STATE_DIR: STATE_DIR };
  if (FAKE) {
    env.CODEX_BIN = FAKE_CODEX;
    env.FAKE_CODEX_STATE_DIR = join(STATE_DIR, "fake-state");
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env,
  });
  const client = new Client({ name: "supervise-check", version: "0.3.0" });
  const evidence = {
    mode: FAKE ? "fake-codex-shim" : "real-codex",
    started_at: new Date().toISOString(),
    ok: false,
    task: TASK,
  };

  try {
    await client.connect(transport);
    evidence.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();

    const report = parseToolJson(
      await client.callTool({
        name: "supervise",
        arguments: {
          task: TASK,
          cwd: TARGET_REPO,
          max_rounds: 2,
          sandbox: "danger-full-access",
          timeout_ms: 420000,
        },
      }),
    );

    evidence.report = {
      status: report.status,
      ok: report.ok,
      error: report.error || null,
      rounds: (report.rounds || []).map((round) => ({
        round: round.round,
        ok: round.ok,
        error: round.error || null,
        findings: round.findings,
        actionable: round.actionable,
        corrected: round.corrected,
        rule_ids: (round.findings_detail || []).map((finding) => finding.rule_id),
        reply_excerpt: String(round.reply || "").slice(0, 400),
      })),
      final_rule_ids: (report.final_findings || []).map((finding) => finding.rule_id),
      history_file: report.history_file,
      thread_id: report.thread_id,
    };

    if (!["clean", "unresolved"].includes(report.status)) {
      throw new Error(`supervise did not finish: ${JSON.stringify(report).slice(0, 500)}`);
    }
    if ((report.rounds || []).length < 1) {
      throw new Error("supervise returned no rounds");
    }
    if (FAKE) {
      if ((report.rounds || []).length !== 2) throw new Error("expected 2 rounds in fake demo");
      if (!report.rounds[0].actionable || report.rounds[0].actionable < 1) {
        throw new Error("expected actionable findings in fake round 1");
      }
      if (report.status !== "clean") throw new Error(`expected clean in fake demo, got ${report.status}`);
    }

    const diffAfter = parseToolJson(
      await client.callTool({ name: "codex_diff", arguments: { cwd: TARGET_REPO } }),
    );
    evidence.final_git_status = diffAfter.status;
    evidence.final_diff = String(diffAfter.diff || "").slice(0, 8000);
    evidence.ok = true;
  } catch (error) {
    evidence.error = String(error?.message || error);
  } finally {
    await client.close().catch(() => {});
  }

  evidence.finished_at = new Date().toISOString();
  await writeFile(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
