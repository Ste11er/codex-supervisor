#!/usr/bin/env node
/**
 * codex-supervisor CLI — initialization scaffold.
 *
 * The MCP server and supervision loop are not implemented yet; this entrypoint
 * intentionally only reports version/help so the repository stays honest about
 * its state. See docs/roadmap.md for the implementation phases.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const help = `codex-supervisor v${pkg.version}

MCP bridge for supervising OpenAI Codex: drive, audit, and correct
defensive-programming and timid behavior.

Status: MCP transport + 40-class audit engine + supervise loop implemented (Phase 3).

Implemented MCP tools:
  codex_ask        send a task to Codex and return its reply + thread_id
  codex_continue   continue an existing Codex thread
  codex_status     login, quota, model and version information
  codex_diff       collect git status/diff as audit evidence
  audit_change     audit a diff and/or Codex reply against 40 anti-defensive rules
  codex_correct    send evidence-backed corrections to an existing thread
  supervise        task -> audit -> correct -> re-check -> structured report (<=3 rounds)

Usage:
  codex-supervisor --version
  codex-supervisor --help

Docs:  https://github.com/${pkg.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace("https://", "")}#readme
`;

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${pkg.version}\n`);
} else {
  process.stdout.write(help);
}
