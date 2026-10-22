import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractResult, parseEventLines } from "../src/runner.js";

const readFixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("fresh turn: thread id, final reply and usage are extracted", () => {
  const result = extractResult(parseEventLines(readFixture("codex-exec-fresh.jsonl")));
  assert.equal(result.threadId, "01a163c5-3d2c-7020-8526-3a4c6e9055b9");
  assert.equal(result.reply, "OK");
  assert.equal(result.error, null);
  assert.equal(result.usage?.input_tokens, 18947);
  assert.equal(result.usage?.output_tokens, 5);
  assert.ok(result.eventCount >= 4);
});

test("resume turn: same thread and new reply", () => {
  const result = extractResult(parseEventLines(readFixture("codex-exec-resume.jsonl")));
  assert.equal(result.threadId, "01a163c5-3d2c-7020-8526-3a4c6e9055b9");
  assert.equal(result.reply, "DONE");
  assert.equal(result.error, null);
});

test("failure turn: usage-limit error is surfaced, no fake success", () => {
  const result = extractResult(parseEventLines(readFixture("codex-exec-failure.jsonl")));
  assert.equal(result.reply, null);
  assert.match(result.error, /usage limit/i);
});

test("malformed lines are ignored instead of crashing the parser", () => {
  const events = parseEventLines(
    ['{"type":"thread.started","thread_id":"t1"}', "not-json", "", '{"type":"turn.completed"}'].join("\n"),
  );
  assert.equal(events.length, 2);
  const result = extractResult(events);
  assert.equal(result.threadId, "t1");
  assert.equal(result.reply, null);
});
