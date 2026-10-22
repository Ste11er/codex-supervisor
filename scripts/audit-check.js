#!/usr/bin/env node
/**
 * Live end-to-end check for the audit engine over MCP stdio (no Codex quota used).
 *
 * Creates a temp git repo with a defensive change, calls audit_change twice
 * (diff mode and reply mode) and asserts expected rule ids.
 *
 * Usage: node scripts/audit-check.js
 * Writes: outputs/evidence/phase2-audit.json
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const EVIDENCE_DIR = join(WORKSPACE_ROOT, "outputs", "evidence");
const STATE_DIR = join(REPO_ROOT, ".state", "audit-check");
const DIFF_REPO = join(STATE_DIR, "diff-repo");
const SERVER_PATH = join(REPO_ROOT, "bin", "server.js");

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
  await mkdir(DIFF_REPO, { recursive: true });

  git(["init", "-b", "main"], DIFF_REPO);
  git(["config", "user.email", "audit-check@example.invalid"], DIFF_REPO);
  git(["config", "user.name", "audit-check"], DIFF_REPO);
  await writeFile(
    join(DIFF_REPO, "app.py"),
    [
      "def load(data):",
      '    value = data.get("count") or 0',
      '    return data.get("id")',
      "",
    ].join("\n"),
  );
  git(["add", "."], DIFF_REPO);
  git(["commit", "-m", "initial"], DIFF_REPO);
  await writeFile(
    join(DIFF_REPO, "app.py"),
    [
      "def load(data):",
      "    try:",
      '        value = data.get("count") or 0',
      '        return data.get("id")',
      "    except Exception:",
      "        pass",
      '    return data.get("id")',
      "",
    ].join("\n"),
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CODEX_SUPERVISOR_STATE_DIR: STATE_DIR },
  });
  const client = new Client({ name: "audit-check", version: "0.2.0" });
  const evidence = { started_at: new Date().toISOString(), ok: false };

  try {
    await client.connect(transport);
    evidence.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();

    const diffAudit = parseToolJson(
      await client.callTool({ name: "audit_change", arguments: { cwd: DIFF_REPO } }),
    );
    evidence.diff_audit = {
      ok: diffAudit.ok,
      total: diffAudit.summary?.total,
      rule_ids: (diffAudit.findings || []).map((finding) => finding.rule_id),
      sample: (diffAudit.findings || [])[0],
    };
    for (const expected of ["B01", "C01", "C02"]) {
      if (!evidence.diff_audit.rule_ids.includes(expected)) {
        throw new Error(`diff audit missing ${expected}: ${JSON.stringify(evidence.diff_audit)}`);
      }
    }

    const replyAudit = parseToolJson(
      await client.callTool({
        name: "audit_change",
        arguments: { reply: "为了安全起见，建议先备份；这个 API 可能不支持批量模式。" },
      }),
    );
    evidence.reply_audit = {
      ok: replyAudit.ok,
      total: replyAudit.summary?.total,
      rule_ids: (replyAudit.findings || []).map((finding) => finding.rule_id),
    };
    for (const expected of ["H04", "H05"]) {
      if (!evidence.reply_audit.rule_ids.includes(expected)) {
        throw new Error(`reply audit missing ${expected}: ${JSON.stringify(evidence.reply_audit)}`);
      }
    }

    evidence.ok = true;
  } catch (error) {
    evidence.error = String(error?.message || error);
  } finally {
    await client.close().catch(() => {});
  }

  evidence.finished_at = new Date().toISOString();
  await writeFile(join(EVIDENCE_DIR, "phase2-audit.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
