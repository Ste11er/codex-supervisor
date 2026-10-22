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
