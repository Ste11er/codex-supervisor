import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const SERVER_PATH = fileURLToPath(new URL("../bin/server.js", import.meta.url));

function hasCodex() {
  try {
    execFileSync(CODEX_BIN, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "MCP stdio server lists tools and answers codex_status",
  { skip: hasCodex() ? false : "codex CLI is not installed" },
  async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "codex-supervisor-mcp-state-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH],
      env: { ...process.env, CODEX_SUPERVISOR_STATE_DIR: stateDir },
    });
    const client = new Client({ name: "codex-supervisor-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, ["audit_change", "codex_ask", "codex_continue", "codex_diff", "codex_status"]);

      const response = await client.callTool({ name: "codex_status", arguments: {} });
      assert.ok(Array.isArray(response.content) && response.content.length > 0);
      const text = response.content.map((part) => part.text || "").join("\n");
      assert.match(text, /"version"/);
      assert.match(text, /"codexHome"|"codex_home"/);
    } finally {
      await client.close().catch(() => {});
      await rm(stateDir, { recursive: true, force: true });
    }
  },
);
