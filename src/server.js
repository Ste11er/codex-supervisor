import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  codexStatus,
  collectDiff,
  DEFAULT_TIMEOUT_MS,
  runCodex,
} from "./runner.js";
import { auditChange } from "./audit.js";
import { buildCorrectionPrompt } from "./prompt.js";
import { supervise } from "./supervise.js";
import { defaultStateDir } from "./codex-home.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const SANDBOX = z.enum(["read-only", "workspace-write", "danger-full-access"]);

function textResult(payload, { isError = false } = {}) {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function turnResult(result) {
  if (!result.ok) {
    return textResult(
      {
        ok: false,
        error: result.error,
        thread_id: result.threadId ?? null,
        exit_code: result.exitCode ?? null,
        timed_out: Boolean(result.timedOut),
        stderr_tail: result.stderrTail || "",
      },
      { isError: true },
    );
  }
  return textResult({
    ok: true,
    reply: result.reply,
    thread_id: result.threadId,
    usage: result.usage,
    duration_ms: result.durationMs,
    event_count: result.eventCount,
  });
}

export function createServer() {
  const server = new McpServer({
    name: "codex-supervisor",
    version: pkg.version,
  });

  server.registerTool(
    "codex_status",
    {
      title: "Codex status",
      description:
        "Show the Codex CLI version, login status, isolated CODEX_HOME and effective model settings.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => textResult(await codexStatus()),
  );

  server.registerTool(
    "codex_ask",
    {
      title: "Ask Codex",
      description:
        "Send one task/message to Codex and return its final reply, thread_id, usage and timing. " +
        "Pass thread_id to continue an existing conversation, or omit it to start a new thread.",
      inputSchema: {
        prompt: z.string().min(1).describe("Task or message for Codex"),
        cwd: z.string().optional().describe("Working directory (defaults to the server cwd)"),
        thread_id: z.string().optional().describe("Existing thread id to resume"),
        model: z.string().optional().describe("Model override, e.g. gpt-6-astra"),
        sandbox: SANDBOX.optional().describe("Codex sandbox mode (default workspace-write)"),
        timeout_ms: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ prompt, cwd, thread_id, model, sandbox, timeout_ms }) =>
      turnResult(
        await runCodex({
          prompt,
          cwd: cwd || process.cwd(),
          threadId: thread_id || null,
          model: model || null,
          sandbox: sandbox || "workspace-write",
          timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
        }),
      ),
  );

  server.registerTool(
    "codex_continue",
    {
      title: "Continue Codex thread",
      description:
        "Continue an existing Codex thread with a follow-up message; same as codex_ask with thread_id.",
      inputSchema: {
        thread_id: z.string().min(1).describe("Thread id returned by an earlier call"),
        prompt: z.string().min(1).describe("Follow-up message"),
        cwd: z.string().optional(),
        model: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ thread_id, prompt, cwd, model, timeout_ms }) =>
      turnResult(
        await runCodex({
          prompt,
          cwd: cwd || process.cwd(),
          threadId: thread_id,
          model: model || null,
          timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
        }),
      ),
  );

  server.registerTool(
    "codex_diff",
    {
      title: "Collect workspace diff",
      description:
        "Collect `git status` and `git diff` (unstaged + staged) from a workspace as audit evidence.",
      inputSchema: {
        cwd: z.string().min(1).describe("Git workspace path"),
        max_bytes: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cwd, max_bytes }) => {
      const result = await collectDiff({ cwd, maxBytes: max_bytes || 200_000 });
      return textResult(result, { isError: !result.ok });
    },
  );

  server.registerTool(
    "audit_change",
    {
      title: "Audit change against anti-defensive rules",
      description:
        "Audit a unified diff and/or Codex reply text against the 40-class anti-defensive rule catalog. " +
        "Pass cwd to collect git status/diff automatically, or pass diff/reply directly.",
      inputSchema: {
        cwd: z.string().optional().describe("Git workspace to collect the diff from"),
        diff: z.string().optional().describe("Unified diff text to audit"),
        reply: z.string().optional().describe("Codex reply text to audit for timid/over-defensive behavior"),
        max_bytes: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cwd, diff, reply, max_bytes }) => {
      let diffText = diff || "";
      if (!diffText && cwd) {
        const collected = await collectDiff({ cwd, maxBytes: max_bytes || 200_000 });
        if (!collected.ok) return textResult(collected, { isError: true });
        diffText = [collected.diff, collected.stagedDiff].filter(Boolean).join("\n");
      }
      if (!diffText.trim() && !String(reply || "").trim()) {
        return textResult(
          { ok: false, error: "需要 cwd、diff 或 reply 中的至少一个输入" },
          { isError: true },
        );
      }
      return textResult(auditChange({ diff: diffText, reply: reply || "" }));
    },
  );

  server.registerTool(
    "codex_correct",
    {
      title: "Send evidence-backed corrections to Codex",
      description:
        "Build a correction instruction from audit findings (rule_id / file:line / evidence + action bias) " +
        "and send it to an existing Codex thread.",
      inputSchema: {
        thread_id: z.string().min(1).describe("Thread id returned by codex_ask"),
        findings: z
          .array(
            z.object({
              rule_id: z.string(),
              severity: z.string().optional(),
              file: z.string().nullable().optional(),
              line: z.number().nullable().optional(),
              evidence: z.string().optional(),
              message: z.string().optional(),
              suggestion: z.string().optional(),
              source: z.string().optional(),
              confidence: z.string().optional(),
            }),
          )
          .min(1)
          .describe("Actionable findings produced by audit_change"),
        task: z.string().optional().describe("Original task, included in the correction"),
        cwd: z.string().optional(),
        model: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ thread_id, findings, task, cwd, model, timeout_ms }) => {
      const prompt = buildCorrectionPrompt({
        findings,
        task: task || "",
        round: 1,
        maxRounds: 1,
        cwd: cwd || "",
      });
      const result = await runCodex({
        prompt,
        cwd: cwd || process.cwd(),
        threadId: thread_id,
        model: model || null,
        timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
      });
      if (!result.ok) return turnResult(result);
      return textResult({
        ok: true,
        reply: result.reply,
        thread_id: result.threadId,
        findings_sent: findings.length,
        duration_ms: result.durationMs,
      });
    },
  );

  server.registerTool(
    "supervise",
    {
      title: "Supervise Codex through audit and correction",
      description:
        "Run task -> Codex turn -> collect diff -> audit -> correction -> re-check, up to max_rounds. " +
        "Returns a structured report with status clean / unresolved / error and per-round findings.",
      inputSchema: {
        task: z.string().min(1).describe("Task for Codex"),
        cwd: z.string().min(1).describe("Git workspace Codex works in"),
        max_rounds: z.number().int().min(1).max(10).optional().describe("Correction rounds (default 3)"),
        thread_id: z.string().optional(),
        model: z.string().optional(),
        sandbox: SANDBOX.optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ task, cwd, max_rounds, thread_id, model, sandbox, timeout_ms }) => {
      const report = await supervise({
        task,
        cwd,
        maxRounds: max_rounds || 3,
        threadId: thread_id || null,
        model: model || null,
        sandbox: sandbox || "workspace-write",
        timeoutMs: timeout_ms,
      });
      return textResult(report, { isError: report.status === "error" });
    },
  );

  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the state dir warm/validated at startup (no network calls).
  await defaultStateDir();
}

const isEntry =
  process.argv[1] && fileURLToPath(new URL(import.meta.url)) === process.argv[1];
if (isEntry) {
  main().catch((error) => {
    process.stderr.write(`codex-supervisor mcp server failed: ${error?.stack || error}\n`);
    process.exit(1);
  });
}
