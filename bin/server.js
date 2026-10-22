#!/usr/bin/env node
/**
 * Stdio entrypoint for the codex-supervisor MCP server.
 *
 * Protocol traffic uses stdout; diagnostics must go to stderr only.
 */
import { main } from "../src/server.js";

main().catch((error) => {
  process.stderr.write(`codex-supervisor mcp server failed: ${error?.stack || error}\n`);
  process.exit(1);
});
