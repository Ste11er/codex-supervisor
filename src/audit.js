/**
 * Audit engine: deterministic checks over a unified diff's added lines and over
 * Codex's reply text. Findings are candidates (low-confidence warnings) or
 * clear violations; the supervising agent decides how to correct.
 */
import { RULES, RULE_BY_ID, GROUPS } from "./rules/catalog.js";

const LANG_BY_EXT = {
  py: "python", pyi: "python",
  js: "js", mjs: "js", cjs: "js", jsx: "js",
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts",
  sh: "shell", bash: "shell", zsh: "shell",
};

function languageOf(file) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(file || ""));
  return match ? LANG_BY_EXT[match[1].toLowerCase()] || "any" : "any";
}

function languageAllowed(matcher, language) {
  if (!matcher.languages || matcher.languages.length === 0) return true;
  return matcher.languages.includes(language);
}

const compiled = new Map();
for (const rule of RULES) {
  compiled.set(rule.id, {
    static: (rule.matchers || []).map((matcher) => ({
      matcher,
      regex: matcher.pattern instanceof RegExp ? matcher.pattern : new RegExp(matcher.pattern, matcher.flags || ""),
    })),
    text: (rule.textMatchers || []).map((matcher) => ({
      matcher,
      regex: matcher.pattern instanceof RegExp ? matcher.pattern : new RegExp(matcher.pattern, matcher.flags || "iu"),
    })),
  });
}

export function parseUnifiedDiff(diffText) {
  const hunks = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of String(diffText || "").split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      file = null;
      hunk = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim().replace(/^b\//, "");
      file = target === "/dev/null" ? null : target;
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match || !file) {
        hunk = null;
        continue;
      }
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      hunk = { file, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const marker = raw[0];
    if (marker === "+") {
      hunk.lines.push({ type: "+", text: raw.slice(1), newLine });
      newLine += 1;
    } else if (marker === "-") {
      hunk.lines.push({ type: "-", text: raw.slice(1), oldLine });
      oldLine += 1;
    } else if (marker === " ") {
      hunk.lines.push({ type: " ", text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

function makeFinding(rule, matcher, { file = null, line = null, evidence = "", source = "diff" } = {}) {
  return {
    rule_id: rule.id,
    group: rule.group,
    group_name: GROUPS[rule.group],
    title: rule.title,
    severity: rule.severity,
    detection: rule.detection,
    confidence: matcher?.confidence || "medium",
    file,
    line,
    evidence: String(evidence || "").trim().slice(0, 240),
    message: matcher?.message || rule.description,
    suggestion: matcher?.suggestion || rule.suggestion || "",
    source,
  };
}

function byRule(ruleId) {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) throw new Error(`unknown rule id in engine: ${ruleId}`);
  return rule;
}

function pushFinding(findings, rule, matcher, location) {
  findings.push(makeFinding(rule, matcher, location));
}

export function auditDiff(diffText, { maxFindings = 500 } = {}) {
  const findings = [];
  const perFileAdded = new Map();
  const hunks = parseUnifiedDiff(diffText);

  for (const hunk of hunks) {
    const language = languageOf(hunk.file);
    const added = hunk.lines.filter((line) => line.type === "+");
    const removed = hunk.lines.filter((line) => line.type === "-");
    if (!perFileAdded.has(hunk.file)) perFileAdded.set(hunk.file, []);
    perFileAdded.get(hunk.file).push(...added);

    for (const line of added) {
      for (const rule of RULES) {
        for (const { matcher, regex } of compiled.get(rule.id).static) {
          if (!languageAllowed(matcher, language)) continue;
          if (regex.test(line.text)) pushFinding(findings, rule, matcher, { file: hunk.file, line: line.newLine, evidence: line.text });
        }
      }
    }

    // Cross-line patterns: an `except` line followed by pass/continue, empty
    // return, or a re-raise that drops the original exception cause.
    for (let index = 0; index < added.length - 1; index += 1) {
      const current = added[index];
      const next = added[index + 1];
      if (!/^\s*except\b/.test(current.text)) continue;
      const evidence = `${current.text.trim()} / ${next.text.trim()}`;
      if (/^\s*(?:pass|continue|\.\.\.)\s*(?:#.*)?$/.test(next.text)) {
        pushFinding(findings, byRule("C02"), compiled.get("C02").static[0]?.matcher, { file: hunk.file, line: next.newLine, evidence });
      }
      if (/^\s*return\s+(?:None|\[\]|\{\}|False|0|""|'')\b/.test(next.text)) {
        pushFinding(findings, byRule("C03"), compiled.get("C03").static[0]?.matcher, { file: hunk.file, line: next.newLine, evidence });
      }
      if (/^\s*raise\s+\w+/.test(next.text) && !/\bfrom\b/.test(next.text)) {
        pushFinding(findings, byRule("D04"), null, { file: hunk.file, line: next.newLine, evidence });
      }
    }

    // Deleting assertions while adding none in the same hunk.
    const removedAssertions = removed.filter((line) => /\bassert\b|\bexpect\s*\(/.test(line.text));
    const addedAssertions = added.filter((line) => /\bassert\b|\bexpect\s*\(/.test(line.text));
    if (removedAssertions.length > 0 && addedAssertions.length === 0) {
      pushFinding(findings, byRule("H01"), null, {
        file: hunk.file,
        line: hunk.newStart,
        evidence: removedAssertions[0].text,
      });
    }
  }

  // Heuristic: repeated "if x is None: return" guards in one file (patch-over-root-cause).
  for (const [file, lines] of perFileAdded.entries()) {
    const guards = lines.filter((line) => /if\s+[^\n]*\bis\s+None\s*:\s*return\b/.test(line.text));
    if (guards.length >= 3) {
      pushFinding(findings, byRule("H03"), null, {
        file,
        line: guards[2].newLine,
        evidence: `同一文件新增 ${guards.length} 处 is None: return 兜底`,
      });
    }
  }

  suppressReraisedExceptionText(findings, hunks);
  return dedupe(findings).slice(0, maxFindings);
}

/**
 * C04 false-positive guard: `except ... as exc: record(str(exc)); raise` keeps the
 * cause (the re-raise propagates it). Only flag when the block converts the failure
 * into a non-raising result.
 */
function suppressReraisedExceptionText(findings, hunks) {
  for (const hunk of hunks) {
    const added = hunk.lines.filter((line) => line.type === "+");
    for (let index = 0; index < added.length; index += 1) {
      const line = added[index];
      const c04 = findings.find(
        (finding) =>
          finding.rule_id === "C04" &&
          finding.file === hunk.file &&
          finding.line === line.newLine,
      );
      if (!c04) continue;
      let reRaised = false;
      for (let next = index + 1; next < added.length && next <= index + 8; next += 1) {
        const text = added[next].text;
        if (/^\s*except\b/.test(text)) break;
        if (/^\s*raise\b/.test(text)) {
          reRaised = true;
          break;
        }
      }
      if (reRaised) {
        const position = findings.indexOf(c04);
        if (position >= 0) findings.splice(position, 1);
      }
    }
  }
}

export function auditReply(text, { maxFindings = 200 } = {}) {
  const reply = String(text || "");
  if (!reply.trim()) return [];
  const findings = [];
  for (const rule of RULES) {
    for (const { matcher, regex } of compiled.get(rule.id).text) {
      const match = reply.match(regex);
      if (match) {
        pushFinding(findings, rule, matcher, { evidence: match[0], source: "reply", line: null, file: null });
        break; // one finding per rule is enough for reply text
      }
    }
  }
  return findings.slice(0, maxFindings);
}

function dedupe(findings) {
  const seen = new Set();
  const output = [];
  for (const finding of findings) {
    const key = [finding.rule_id, finding.file, finding.line, finding.evidence].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

export function summarizeAudit(findings, { filesScanned = null, addedLinesScanned = null } = {}) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byRule = {};
  const byGroup = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byRule[finding.rule_id] = (byRule[finding.rule_id] || 0) + 1;
    byGroup[finding.group] = (byGroup[finding.group] || 0) + 1;
  }
  const topRules = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule_id, count]) => ({ rule_id, count }));
  return {
    total: findings.length,
    by_severity: bySeverity,
    by_rule: byRule,
    by_group: byGroup,
    top_rules: topRules,
    files_scanned: filesScanned,
    added_lines_scanned: addedLinesScanned,
  };
}

/**
 * Audit a change: diff (unified) and/or the Codex reply text.
 * Returns findings + summary in a single stable shape for MCP/CLI consumers.
 */
export function auditChange({ diff = "", reply = "" } = {}) {
  const findings = [];
  let filesScanned = null;
  let addedLinesScanned = null;
  if (diff && String(diff).trim()) {
    const hunks = parseUnifiedDiff(diff);
    filesScanned = new Set(hunks.map((hunk) => hunk.file)).size;
    addedLinesScanned = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.type === "+").length, 0);
    findings.push(...auditDiff(diff));
  }
  if (reply && String(reply).trim()) {
    findings.push(...auditReply(reply));
  }
  const merged = dedupe(findings);
  return {
    ok: true,
    findings: merged,
    summary: summarizeAudit(merged, { filesScanned, addedLinesScanned }),
  };
}
