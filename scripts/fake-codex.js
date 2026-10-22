#!/usr/bin/env node
/**
 * Deterministic stand-in for the `codex` CLI, used only for offline end-to-end
 * tests when the real ChatGPT/Codex quota is unavailable.
 *
 * Round 1 writes deliberately defensive code; round 2 (after a correction
 * prompt) writes the clean version. Emits the same JSONL event shape as
 * `codex exec --json` so the runner/audit/supervise stack is exercised for real.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("codex-cli fake-shim-0.0.0\n");
  process.exit(0);
}
if (args[0] === "login") {
  process.stdout.write("Logged in using ChatGPT (fake shim)\n");
  process.exit(0);
}

const stateDir = process.env.FAKE_CODEX_STATE_DIR;
if (!stateDir) {
  process.stderr.write("fake-codex shim refuses to run without FAKE_CODEX_STATE_DIR\n");
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });
const counterFile = join(stateDir, "calls.txt");
const previousCalls = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) : 0;
writeFileSync(counterFile, String(previousCalls + 1));
const round = previousCalls + 1;
const cwd = process.env.FAKE_CODEX_CWD || process.cwd();

let reply;
if (round === 1) {
  writeFileSync(
    join(cwd, "count.py"),
    [
      "def load_count(data):",
      "    try:",
      "        return data.get('count') or 0",
      "    except Exception:",
      "        pass",
      "",
    ].join("\n"),
  );
  writeFileSync(join(cwd, "test_count.py"), "def test_ok():\n    assert True\n");
  reply = "为了安全起见，我先包了 try/except 并加了默认值，避免出错。";
} else {
  writeFileSync(join(cwd, "count.py"), "def load_count(data):\n    return data['count']\n");
  writeFileSync(
    join(cwd, "test_count.py"),
    ["from count import load_count", "", "def test_ok():", "    assert load_count({'count': 3}) == 3", ""].join("\n"),
  );
  reply = "已删除兜底与宽泛异常，按必需字段直接读取，并更新了真实断言。";
}

const events = [
  { type: "thread.started", thread_id: "fake-thread-0001" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: `item_${round}`, type: "agent_message", text: reply } },
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
];
for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
process.exit(0);
