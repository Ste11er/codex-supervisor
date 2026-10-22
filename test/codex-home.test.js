import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractMinimalConfig, prepareCodexHome } from "../src/codex-home.js";

const SOURCE_CONFIG = `model = "gpt-6-astra"
model_reasoning_effort = "ultra"
service_tier = "priority"

[mcp_servers.node_repl]
command = "/usr/lib/chatgpt/resources/cua_node/bin/node_repl"

[plugins."browser@openai-bundled"]
enabled = true

[projects."/home/user/project"]
trust_level = "trusted"
`;

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "codex-supervisor-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("minimal config keeps only model settings and never copies plugins/hooks/mcp", () => {
  const lines = extractMinimalConfig(SOURCE_CONFIG);
  assert.deepEqual(lines, [
    'model = "gpt-6-astra"',
    'model_reasoning_effort = "ultra"',
    'service_tier = "priority"',
  ]);
  assert.ok(!lines.join("\n").includes("mcp_servers"));
  assert.ok(!lines.join("\n").includes("plugins"));
});

test("prepareCodexHome isolates auth.json (600) and writes a minimal config", async () => {
  await withTemp(async (root) => {
    const sourceHome = join(root, "source-home");
    const stateDir = join(root, "state");
    await writeFile(
      join(await (async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(sourceHome, { recursive: true });
        return sourceHome;
      })(), "auth.json"),
      '{"tokens":{"access_token":"fake"}}',
      { mode: 0o600 },
    );
    await writeFile(join(sourceHome, "config.toml"), SOURCE_CONFIG);

    const result = await prepareCodexHome({ stateDir, sourceHome });
    assert.equal(result.isolated, true);
    assert.equal(result.copiedAuth, true);
    assert.equal(result.codexHome, join(stateDir, "codex-home"));

    const authMode = (await stat(join(result.codexHome, "auth.json"))).mode & 0o777;
    assert.equal(authMode, 0o600);

    const stateMode = (await stat(stateDir)).mode & 0o777;
    assert.equal(stateMode, 0o700);

    const config = await readFile(join(result.codexHome, "config.toml"), "utf8");
    assert.match(config, /model = "gpt-6-astra"/);
    assert.match(config, /model_reasoning_effort = "ultra"/);
    assert.doesNotMatch(config, /\[mcp_servers/);
    assert.doesNotMatch(config, /\[plugins/);
    assert.doesNotMatch(config, /\[projects/);
    assert.doesNotMatch(config, /hooks\.state/);
  });
});

test("prepareCodexHome warns when the source auth.json is missing", async () => {
  await withTemp(async (root) => {
    const sourceHome = join(root, "missing-home");
    const result = await prepareCodexHome({ stateDir: join(root, "state"), sourceHome });
    assert.equal(result.copiedAuth, false);
    assert.ok(result.notes.some((note) => note.includes("auth.json")));
  });
});
