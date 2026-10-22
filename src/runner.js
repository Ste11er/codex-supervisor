import { spawn } from "node:child_process";
import { readFile, readdir, stat as statFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { defaultStateDir, ensureDir, prepareCodexHome } from "./codex-home.js";

export const CODEX_BIN = process.env.CODEX_BIN || "codex";
export const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_SUPERVISOR_TIMEOUT_MS || 600_000);
const MAX_STREAM_BYTES = 512_000;

/** Parse one JSONL event line; returns null for blank/invalid lines. */
export function parseEventLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Parse a complete JSONL stream, ignoring malformed lines. */
export function parseEventLines(text) {
  const events = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const event = parseEventLine(line);
    if (event) events.push(event);
  }
  return events;
}

/** Extract reply, thread id, usage and failure semantics from codex JSONL events. */
export function extractResult(events) {
  let threadId = null;
  let usage = null;
  let error = null;
  const agentMessages = [];

  for (const event of events) {
    switch (event.type) {
      case "thread.started":
        if (event.thread_id) threadId = event.thread_id;
        break;
      case "item.completed":
        if (event.item?.type === "agent_message" && typeof event.item.text === "string") {
          agentMessages.push(event.item.text);
        }
        break;
      case "turn.completed":
        if (event.usage) usage = event.usage;
        break;
      case "error":
        if (typeof event.message === "string" && event.message) error = event.message;
        break;
      case "turn.failed":
        if (event.error?.message) error = event.error.message;
        break;
      default:
        break;
    }
  }

  const reply = agentMessages.length ? agentMessages[agentMessages.length - 1] : null;
  return { threadId, reply, usage, error, agentMessages, eventCount: events.length };
}

function runProcess(command, args, { cwd, env, timeoutMs = 30_000, stdin = null } = {}) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      return next.length > MAX_STREAM_BYTES ? next.slice(-MAX_STREAM_BYTES) : next;
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.stdin.on("error", () => {});
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.once("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        code: null,
        stdout,
        stderr: append(stderr, String(err?.message || err)),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

function tail(text, max = 2_000) {
  const value = String(text || "").trim();
  return value.length > max ? value.slice(-max) : value;
}

/**
 * Run one Codex turn.
 *
 * - fresh turn:   codex exec --json -s <sandbox> -C <cwd> -o <last> -
 * - resumed turn: codex exec resume <threadId> --json -c sandbox_mode="<sandbox>" -o <last> -
 *
 * The prompt is always delivered through stdin with `-` as the prompt argument,
 * which avoids shell quoting issues and keeps the JSONL stream clean.
 */
export async function runCodex({
  prompt,
  cwd = process.cwd(),
  threadId = null,
  model = null,
  sandbox = "workspace-write",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stateDir = defaultStateDir(),
} = {}) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { ok: false, error: "prompt 不能为空", code: "INVALID_PROMPT" };
  }

  const prepared = await prepareCodexHome({ stateDir });
  const lastMessagePath = join(prepared.stateDir, "last-message.txt");
  await ensureDir(prepared.stateDir);
  const workdir = resolve(cwd);

  const args = ["exec"];
  if (threadId) {
    args.push("resume", threadId);
    args.push("--json", "--skip-git-repo-check", "--all");
    if (sandbox === "danger-full-access") {
      // A nested sandbox (e.g. the DSH bash sandbox) can make Codex's own
      // workspace-write sandbox fail writes; the outer boundary already exists.
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("-c", `sandbox_mode="${sandbox}"`);
    }
  } else {
    args.push("--json", "--skip-git-repo-check", "-s", sandbox, "-C", workdir);
  }
  args.push("-o", lastMessagePath);
  if (model) args.push("-m", model);
  args.push("-");

  const env = { ...process.env, CODEX_HOME: prepared.codexHome };
  const result = await runProcess(CODEX_BIN, args, {
    cwd: workdir,
    env,
    timeoutMs,
    stdin: prompt,
  });

  const events = parseEventLines(result.stdout);
  const extracted = extractResult(events);

  let reply = extracted.reply;
  if (!reply) {
    try {
      const fallback = await readFile(lastMessagePath, "utf8");
      if (fallback.trim()) reply = fallback.trim();
    } catch {
      // last-message.txt is only written on success; absence is expected on failures
    }
  }

  const failure = result.code !== 0 || extracted.error || !reply;
  return {
    ok: !failure,
    reply,
    threadId: extracted.threadId,
    usage: extracted.usage,
    error: failure
      ? extracted.error || (result.timedOut ? "codex 调用超时" : `codex 退出码 ${result.code}`)
      : null,
    stderrTail: result.stderr ? tail(result.stderr) : "",
    exitCode: result.code,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    eventCount: extracted.eventCount,
    codexHome: prepared.codexHome,
    stateDir: prepared.stateDir,
  };
}

/** Read `codex --version` and `codex login status` using the isolated CODEX_HOME. */
export async function codexStatus({ stateDir = defaultStateDir() } = {}) {
  const prepared = await prepareCodexHome({ stateDir });
  const env = { ...process.env, CODEX_HOME: prepared.codexHome };
  const [version, login] = await Promise.all([
    runProcess(CODEX_BIN, ["--version"], { env, timeoutMs: 20_000 }),
    runProcess(CODEX_BIN, ["login", "status"], { env, timeoutMs: 20_000 }),
  ]);

  const firstLine = (text) =>
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("WARNING:")) || "";

  return {
    codexBin: CODEX_BIN,
    version: firstLine(version.stdout) || firstLine(version.stderr),
    login: firstLine(login.stdout) || firstLine(login.stderr),
    codexHome: prepared.codexHome,
    stateDir: prepared.stateDir,
    isolated: prepared.isolated,
    copiedAuth: prepared.copiedAuth ?? false,
    modelConfig: prepared.modelConfig ?? [],
    notes: prepared.notes ?? [],
  };
}

/** Synthesize unified-diff hunks for untracked files so new files are audited too. */
async function buildUntrackedDiff(cwd, entries, maxBytes) {
  const parts = [];
  let used = 0;
  let truncated = false;

  const addFile = async (absolute, relativePath) => {
    if (used >= maxBytes) {
      truncated = true;
      return;
    }
    let text;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      return;
    }
    if (text.includes("\u0000")) return; // binary
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const chunk = [
      `diff --git a/${relativePath} b/${relativePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relativePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
    const slice = chunk.slice(0, Math.max(0, maxBytes - used));
    if (slice.length < chunk.length) truncated = true;
    parts.push(slice);
    used += slice.length;
  };

  const walk = async (absolute, relativePath) => {
    let info;
    try {
      info = await statFile(absolute);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      let children;
      try {
        children = await readdir(absolute);
      } catch {
        return;
      }
      for (const child of children) {
        if (child === ".git" || child === "node_modules") continue;
        await walk(join(absolute, child), `${relativePath}/${child}`);
      }
    } else if (info.isFile()) {
      await addFile(absolute, relativePath);
    }
  };

  for (const entry of entries) {
    const clean = entry.replace(/\/$/, "");
    await walk(join(cwd, clean), clean);
  }
  return { text: parts.join("\n"), truncated };
}

/** Collect `git status` + `git diff` from a workspace as audit evidence. */
export async function collectDiff({ cwd = process.cwd(), maxBytes = 200_000 } = {}) {
  const runGit = (args) =>
    runProcess("git", ["-C", cwd, ...args], { timeoutMs: 30_000 });

  const status = await runGit(["status", "--porcelain=v1", "-b"]);
  if (status.code !== 0) {
    return {
      ok: false,
      error: `git status 失败（不是 git 仓库？）: ${tail(status.stderr, 500)}`,
      cwd,
    };
  }
  const diff = await runGit(["diff", "--no-color"]);
  const staged = await runGit(["diff", "--cached", "--no-color"]);
  const untrackedEntries = status.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const untrackedPart = await buildUntrackedDiff(cwd, untrackedEntries, maxBytes);

  const truncate = (text) => {
    const value = String(text || "");
    if (value.length <= maxBytes) return { text: value, truncated: false };
    return { text: value.slice(0, maxBytes), truncated: true };
  };

  const diffPart = truncate([diff.stdout, untrackedPart.text].filter(Boolean).join("\n"));
  const stagedPart = truncate(staged.stdout);
  return {
    ok: true,
    cwd,
    status: status.stdout.trim(),
    diff: diffPart.text,
    stagedDiff: stagedPart.text,
    truncated: diffPart.truncated || stagedPart.truncated || untrackedPart.truncated,
    untracked_files: untrackedEntries,
  };
}
