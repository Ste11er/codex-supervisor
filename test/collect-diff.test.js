import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditChange } from "../src/audit.js";
import { collectDiff } from "../src/runner.js";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("collectDiff includes untracked new files so they can be audited", async () => {
  const repo = await mkdtemp(join(tmpdir(), "codex-supervisor-diff-"));
  try {
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "diff-test@example.invalid"], repo);
    git(["config", "user.name", "diff-test"], repo);
    await writeFile(join(repo, "README.md"), "# test\n");
    git(["add", "."], repo);
    git(["commit", "-m", "initial"], repo);

    await writeFile(
      join(repo, "count.py"),
      ["def load(data):", "    try:", "        return data.get('count') or 0", "    except Exception:", "        pass", ""].join("\n"),
    );

    const collected = await collectDiff({ cwd: repo });
    assert.equal(collected.ok, true);
    assert.ok(collected.untracked_files.includes("count.py"));
    assert.match(collected.diff, /new file mode 100644/);
    assert.match(collected.diff, /\+    except Exception:/);

    const audit = auditChange({ diff: collected.diff });
    const ids = new Set(audit.findings.map((finding) => finding.rule_id));
    assert.ok(ids.has("C01"), `expected C01, got [${[...ids].join(", ")}]`);
    assert.ok(ids.has("C02"));
    assert.ok(ids.has("B01"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("collectDiff reports clean workspace without synthetic hunks", async () => {
  const repo = await mkdtemp(join(tmpdir(), "codex-supervisor-diff-clean-"));
  try {
    await mkdir(repo, { recursive: true });
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "diff-test@example.invalid"], repo);
    git(["config", "user.name", "diff-test"], repo);
    await writeFile(join(repo, "README.md"), "# clean\n");
    git(["add", "."], repo);
    git(["commit", "-m", "initial"], repo);

    const collected = await collectDiff({ cwd: repo });
    assert.equal(collected.ok, true);
    assert.equal(collected.untracked_files.length, 0);
    assert.equal(collected.diff, "");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
