import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionableFindings, supervise } from "../src/supervise.js";

function makeDiff(file, added) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    " def f():",
    ...added.map((text) => `+${text}`),
  ].join("\n");
}

const CLEAN_DIFF = makeDiff("app.py", ["    return compute()"]);
const DEFENSIVE_DIFF = makeDiff("app.py", ["    try:", "        return data.get('count') or 0", "    except Exception:", "        pass"]);

function fakeDeps({ turns, diffs, prompts }) {
  let turnIndex = 0;
  let diffIndex = 0;
  return {
    runTurn: async (options) => {
      prompts.push(options.prompt);
      const turn = turns[turnIndex];
      turnIndex += 1;
      return turn;
    },
    collectDiff: async () => {
      const diff = diffs[diffIndex] ?? "";
      diffIndex += 1;
      return { ok: true, diff, stagedDiff: "" };
    },
  };
}

async function withState(fn) {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-supervisor-supervise-"));
  try {
    return await fn(stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

test("clean first round stops immediately and records history", async () => {
  await withState(async (stateDir) => {
    const prompts = [];
    const deps = fakeDeps({
      turns: [{ ok: true, reply: "implemented", threadId: "t1", duration_ms: 10 }],
      diffs: [CLEAN_DIFF],
      prompts,
    });
    const report = await supervise({ task: "implement", cwd: "/tmp/x", stateDir }, deps);
    assert.equal(report.ok, true);
    assert.equal(report.status, "clean");
    assert.equal(report.rounds.length, 1);
    assert.equal(report.actionable_count, 0);
    assert.equal(prompts.length, 1);
    const history = await readFile(join(stateDir, "history.jsonl"), "utf8");
    const entry = JSON.parse(history.trim().split("\n")[0]);
    assert.equal(entry.status, "clean");
    assert.equal(entry.rounds, 1);
    assert.equal(entry.task, "implement");
  });
});

test("defensive first round triggers correction and second round can be clean", async () => {
  await withState(async (stateDir) => {
    const prompts = [];
    const deps = fakeDeps({
      turns: [
        { ok: true, reply: "为了安全起见，先加个兜底", threadId: "t1", duration_ms: 10 },
        { ok: true, reply: "已删除兜底，直接使用必需字段", threadId: "t1", duration_ms: 12 },
      ],
      diffs: [DEFENSIVE_DIFF, CLEAN_DIFF],
      prompts,
    });
    const report = await supervise({ task: "implement load_count", cwd: "/tmp/x", stateDir, maxRounds: 3 }, deps);
    assert.equal(report.status, "clean");
    assert.equal(report.rounds.length, 2);
    assert.equal(report.rounds[0].actionable > 0, true);
    assert.equal(report.rounds[0].corrected, true);
    assert.match(prompts[1], /\[C02\]/);
    assert.match(prompts[1], /\[B01\]/);
    assert.match(prompts[1], /第 1\/3 轮纠正/);
    assert.equal(report.thread_id, "t1");
  });
});

test("unresolved when violations persist until max rounds", async () => {
  await withState(async (stateDir) => {
    const prompts = [];
    const deps = fakeDeps({
      turns: [
        { ok: true, reply: "still defensive", threadId: "t1", duration_ms: 10 },
        { ok: true, reply: "still defensive", threadId: "t1", duration_ms: 10 },
      ],
      diffs: [DEFENSIVE_DIFF, DEFENSIVE_DIFF],
      prompts,
    });
    const report = await supervise({ task: "implement", cwd: "/tmp/x", stateDir, maxRounds: 2 }, deps);
    assert.equal(report.status, "unresolved");
    assert.equal(report.ok, true);
    assert.equal(report.rounds.length, 2);
    assert.ok(report.actionable_count > 0);
    assert.ok(report.final_findings.length > 0);
  });
});

test("codex failure produces error status and never a fake success", async () => {
  await withState(async (stateDir) => {
    const prompts = [];
    const deps = fakeDeps({
      turns: [{ ok: false, error: "usage limit reached" }],
      diffs: [],
      prompts,
    });
    const report = await supervise({ task: "implement", cwd: "/tmp/x", stateDir }, deps);
    assert.equal(report.ok, false);
    assert.equal(report.status, "error");
    assert.match(report.error, /usage limit/);
    assert.equal(report.rounds.length, 1);
    const history = await readFile(join(stateDir, "history.jsonl"), "utf8");
    assert.equal(JSON.parse(history.trim()).status, "error");
  });
});

test("actionable filter drops low-confidence warnings but keeps errors and medium warnings", () => {
  const findings = [
    { rule_id: "A02", severity: "warning", confidence: "low" },
    { rule_id: "B01", severity: "warning", confidence: "medium" },
    { rule_id: "C02", severity: "error", confidence: "medium" },
    { rule_id: "A04", severity: "info", confidence: "low" },
  ];
  assert.deepEqual(actionableFindings(findings).map((finding) => finding.rule_id), ["B01", "C02"]);
});
