#!/usr/bin/env node
/**
 * Live end-to-end check: starts the MCP server over stdio, runs a real two-turn
 * Codex conversation and collects a git diff as evidence.
 *
 * Usage: node scripts/live-check.js
 * Writes: outputs/evidence/phase1-live.json (workspace root, gitignored)
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
const STATE_DIR = join(REPO_ROOT, ".state", "live-check");
const WORK_DIR = join(STATE_DIR, "work");
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
  await mkdir(WORK_DIR, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CODEX_SUPERVISOR_STATE_DIR: STATE_DIR },
  });
  const client = new Client({ name: "live-check", version: "0.1.0" });
  const evidence = { started_at: new Date().toISOString(), repo_commit: null };

  try {
    await client.connect(transport);
    evidence.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();

    evidence.status = parseToolJson(await client.callTool({ name: "codex_status", arguments: {} }));

    const first = parseToolJson(
      await client.callTool({
        name: "codex_ask",
        arguments: {
          prompt: "Reply with exactly the word OK and nothing else.",
          cwd: WORK_DIR,
          sandbox: "read-only",
          timeout_ms: 300000,
        },
      }),
    );
    evidence.turn1 = first;
    if (!first.ok || !first.thread_id) throw new Error(`turn 1 failed: ${JSON.stringify(first)}`);

    const second = parseToolJson(
      await client.callTool({
        name: "codex_continue",
        arguments: {
          thread_id: first.thread_id,
          prompt: "Reply with exactly the word DONE and nothing else.",
          timeout_ms: 300000,
        },
      }),
    );
    evidence.turn2 = second;
    if (!second.ok || second.thread_id !== first.thread_id) {
      throw new Error(`turn 2 failed or thread changed: ${JSON.stringify(second)}`);
    }

    await mkdir(DIFF_REPO, { recursive: true });
    git(["init", "-b", "main"], DIFF_REPO);
    git(["config", "user.email", "live-check@example.invalid"], DIFF_REPO);
    git(["config", "user.name", "live-check"], DIFF_REPO);
    await writeFile(join(DIFF_REPO, "example.txt"), "before\n");
    git(["add", "."], DIFF_REPO);
    git(["commit", "-m", "initial"], DIFF_REPO);
    await writeFile(join(DIFF_REPO, "example.txt"), "before\nafter\n");

    const diff = parseToolJson(
      await client.callTool({ name: "codex_diff", arguments: { cwd: DIFF_REPO } }),
    );
    evidence.diff = {
      ok: diff.ok,
      status: diff.status,
      has_after_line: String(diff.diff || "").includes("+after"),
    };
    if (!diff.ok || !evidence.diff.has_after_line) {
      throw new Error(`codex_diff failed: ${JSON.stringify(diff).slice(0, 500)}`);
    }

    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = String(error?.message || error);
  } finally {
    await client.close().catch(() => {});
  }

  evidence.finished_at = new Date().toISOString();
  await writeFile(join(EVIDENCE_DIR, "phase1-live.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
