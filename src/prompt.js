/**
 * Correction prompt builder: turns audit findings into an evidence-backed
 * instruction for Codex, with an explicit action bias against timidity
 * (no repeated confirmations, no imaginary compatibility, root-cause fixes only).
 */
const MAX_FINDINGS = 20;
const MAX_EVIDENCE = 200;

export function formatFinding(finding = {}, index = 1) {
  const location = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
    : finding.source === "reply"
      ? "回复文本"
      : "—";
  const evidence = String(finding.evidence || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EVIDENCE);
  const fix = finding.suggestion || finding.message || "按规则修复";
  return [
    `${index}. [${finding.rule_id || "?"}] ${finding.severity || "warning"} — ${location}`,
    `   证据：${evidence || "—"}`,
    `   要求：${fix}`,
  ].join("\n");
}

export function formatFindings(findings = []) {
  const items = findings.slice(0, MAX_FINDINGS);
  if (items.length === 0) return "（无）";
  return items.map((finding, index) => formatFinding(finding, index + 1)).join("\n");
}

export function buildCorrectionPrompt({
  findings = [],
  task = "",
  round = 1,
  maxRounds = 3,
  cwd = "",
} = {}) {
  const taskExcerpt = String(task || "").trim().slice(0, 2000) || "（未提供）";
  return [
    `你上一轮的实现被监督审计命中以下反防御/畏缩问题（第 ${round}/${maxRounds} 轮纠正）。`,
    "",
    `原始任务：${taskExcerpt}`,
    cwd ? `工作目录：${cwd}` : "",
    "",
    "问题清单：",
    formatFindings(findings),
    "",
    "修复要求：",
    "- 在已授权范围内直接修改，不要反问确认，不要等待批准。",
    "- 允许为消除根因做必要的多文件重构，不要只加补丁绕过。",
    "- 不要通过新增默认值/兜底/兼容层/更宽异常捕获来“消除”告警。",
    "- 修复后运行相关检查或测试，并在回复中给出实际执行结果。",
    "- 只处理以上问题，不要顺带重构无关模块。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
