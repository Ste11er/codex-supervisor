import test from "node:test";
import assert from "node:assert/strict";
import { buildCorrectionPrompt, formatFindings } from "../src/prompt.js";

const FINDINGS = [
  {
    rule_id: "C02",
    severity: "error",
    file: "app.py",
    line: 6,
    evidence: "except Exception: / pass",
    suggestion: "保留失败传播或设置明确失败状态",
  },
  {
    rule_id: "B01",
    severity: "warning",
    file: "app.py",
    line: 3,
    evidence: 'count = data.get("count") or 0',
    suggestion: "区分缺失与有效零值",
  },
];

test("correction prompt carries rule ids, file:line, evidence and round number", () => {
  const prompt = buildCorrectionPrompt({ findings: FINDINGS, task: "实现 load_count", round: 2, maxRounds: 3, cwd: "/tmp/repo" });
  assert.match(prompt, /第 2\/3 轮纠正/);
  assert.match(prompt, /\[C02\]/);
  assert.match(prompt, /app\.py:6/);
  assert.match(prompt, /except Exception: \/ pass/);
  assert.match(prompt, /\[B01\]/);
  assert.match(prompt, /app\.py:3/);
  assert.match(prompt, /实现 load_count/);
  assert.match(prompt, /\/tmp\/repo/);
});

test("correction prompt enforces action bias instead of timidity", () => {
  const prompt = buildCorrectionPrompt({ findings: FINDINGS, task: "t" });
  assert.match(prompt, /不要反问确认/);
  assert.match(prompt, /允许为消除根因做必要的多文件重构/);
  assert.match(prompt, /不要通过新增默认值\/兜底\/兼容层/);
  assert.match(prompt, /运行相关检查或测试/);
});

test("formatFindings handles empty list and caps long evidence", () => {
  assert.equal(formatFindings([]), "（无）");
  const longFinding = { rule_id: "H05", severity: "warning", source: "reply", evidence: "x".repeat(500), suggestion: "s" };
  const formatted = formatFindings([longFinding]);
  assert.match(formatted, /回复文本/);
  assert.ok(!formatted.includes("x".repeat(201)));
});
