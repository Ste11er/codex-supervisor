import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package declares the MIT license", () => {
  assert.equal(pkg.license, "MIT");
});

test("LICENSE contains the MIT text and the copyright holder", () => {
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Ste11er/);
});

test("CLI entrypoint prints the package version", () => {
  const bin = new URL("../bin/codex-supervisor.js", import.meta.url);
  const out = execFileSync(process.execPath, [fileURLToPath(bin), "--version"], {
    encoding: "utf8",
  });
  assert.equal(out.trim(), pkg.version);
});

test("repository skeleton exists", () => {
  for (const rel of [
    "README.md",
    "docs/architecture.md",
    "docs/roadmap.md",
    "docs/security.md",
    "policy/README.md",
    "dsh/README.md",
  ]) {
    assert.doesNotThrow(() => readFileSync(new URL(`../${rel}`, import.meta.url)));
  }
  assert.ok(root.endsWith("/"));
});
