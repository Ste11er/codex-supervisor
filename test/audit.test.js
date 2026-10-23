import test from "node:test";
import assert from "node:assert/strict";
import { RULE_IDS, RULES, validateCatalog } from "../src/rules/catalog.js";
import { auditChange, parseUnifiedDiff } from "../src/audit.js";

const EXPECTED_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "X"].flatMap((group) =>
  [1, 2, 3, 4, 5].map((index) => `${group}0${index}`),
);

function makeDiff(file, added, removed = []) {
  const body = [...removed.map((text) => `-${text}`), ...added.map((text) => `+${text}`)];
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length + 1} +1,${added.length + 1} @@`,
    " def f():",
    ...body,
  ].join("\n");
}

const truePositiveCases = [
  { name: "C01 broad except", diff: makeDiff("x.py", ["    except Exception as exc:", "        log(exc)"]), include: ["C01"] },
  { name: "C02 swallowed exception", diff: makeDiff("x.py", ["    except Exception:", "        pass"]), include: ["C02"] },
  { name: "C03 failure folded to empty", diff: makeDiff("x.py", ["    except ValueError:", "        return None"]), include: ["C03"] },
  { name: "C04 exception only as text", diff: makeDiff("x.py", ['    msg = str(exc)']), include: ["C04"] },
  { name: "C05 error text as state", diff: makeDiff("x.py", ["    if error_text:"]), include: ["C05"] },
  { name: "B01 zero value mistaken as missing", diff: makeDiff("x.py", ['    count = data.get("count") or 0']), include: ["B01"] },
  { name: "A02 required field read as optional", diff: makeDiff("x.py", ['    value = data.get("id")']), include: ["A02"] },
  { name: "A03 temporary object for missing dependency", diff: makeDiff("x.py", ["    if not self._lock: self._lock = Lock()"]), include: ["A03"] },
  { name: "B02 invalid input normalized to zero", diff: makeDiff("x.py", ["    x = np.nan_to_num(x)"]), include: ["B02"] },
  { name: "B03 unknown metadata assumed normal", diff: makeDiff("x.py", ['    mode = cfg.get("unit", "m")']), include: ["B03"] },
  { name: "B04 cached value stamped with fresh time", diff: makeDiff("x.py", ["    ts = time.time()  # cache value"]), include: ["B04"] },
  { name: "D04 second failure drops cause", diff: makeDiff("x.py", ["    except RuntimeError:", '        raise ValueError("recover failed")']), include: ["D04"] },
  { name: "E01 imaginary version compatibility", diff: makeDiff("x.py", ['    if hasattr(obj, "__version__"):']), include: ["E01"] },
  { name: "E02 TypeError used to guess signature", diff: makeDiff("x.py", ["    except TypeError:"]), include: ["E02"] },
  { name: "E03 retry every error", diff: makeDiff("x.py", ["    except ConnectionError: retry()"]), include: ["E03"] },
  { name: "E04 retry without budget", diff: makeDiff("x.py", ["@retry"]), include: ["E04"] },
  { name: "E05 new id for side-effect replay", diff: makeDiff("x.py", ["    op_id = uuid4()"]), include: ["E05"] },
  { name: "F01 silent mock fallback", diff: makeDiff("x.py", ["    use_mock = True"]), include: ["F01"] },
  { name: "F03 failure denominator removed", diff: makeDiff("x.py", ["    except IOError: continue  # skip failure"]), include: ["F03"] },
  { name: "F04 chained defaults wash root cause", diff: makeDiff("x.py", ["    x = a or b or c"]), include: ["F04"] },
  { name: "F05 needless safe wrapper", diff: makeDiff("x.py", ["def safe_call(fn):"]), include: ["F05"] },
  { name: "G01 extreme timeout", diff: makeDiff("x.py", ["    timeout = 0.1"]), include: ["G01"] },
  { name: "G03 silent clamp", diff: makeDiff("x.py", ["    v = min(max(v, 0), 100)"]), include: ["G03"] },
  { name: "G04 empirical value as hard limit", diff: makeDiff("x.py", ["    # 硬件只能如此，最多 3 度"]), include: ["G04"] },
  { name: "H01 fake always-true assertion", diff: makeDiff("test_x.py", ["    assert True"]), include: ["H01"] },
  {
    name: "H01 deleted assertion without replacement",
    diff: makeDiff("test_x.py", ["    result = compute()"], ["    assert result == 42"]),
    include: ["H01"],
  },
  {
    name: "H03 repeated None guards patch over root cause",
    diff: makeDiff("x.py", ["    if x is None: return", "    if y is None: return", "    if z is None: return"]),
    include: ["H03"],
  },
  { name: "H02 mock evidence claimed as real", reply: "mock 用于验证已到位", include: ["H02"] },
  { name: "H04 unverified limitation", reply: "这个 API 可能不支持批量模式", include: ["H04"] },
  { name: "H05 timid confirmation behavior", reply: "为了安全起见，建议先备份再修改", include: ["H05"] },
  { name: "G02 scope shrinking in reply", reply: "为了简化，先只处理一部分数据", include: ["G02"] },
  { name: "X01 hedged simple answer", reply: "我吃了饭，但这是晚饭，不是午饭，更不能说明我营养充足。对于具体吃了什么，仍待事实核查。", include: ["X01"] },
  { name: "X02 definition pedantry", reply: "我先把饭的定义钉死：晚饭是指三餐中的最后一餐，而不是狭义上的米饭。", include: ["X02"] },
  { name: "X03 casual question upgraded to fact check", reply: "关于是否吃了牛肉，没有足够证据确认，需要事实核查。", include: ["X03"] },
  { name: "X04 over-concession after pushback", reply: "你说的对，我先把定义钉死，再重新修正说法。", include: ["X04", "X02"] },
  { name: "X05 meta discussion instead of answer", reply: "这取决于你如何定义饭；在回答之前，先要澄清概念。", include: ["X05"] },
];

const falsePositiveCases = [
  {
    name: "specific exception with recovery is not swallowing",
    diff: makeDiff("x.py", ["    except TimeoutError:", "        retry_with_backoff()"]),
    exclude: ["C01", "C02", "C03", "D04"],
  },
  {
    name: "re-raise keeps cause with from",
    diff: makeDiff("x.py", ["    except RuntimeError as exc:", '        raise ValueError("recover failed") from exc']),
    exclude: ["D04"],
  },
  { name: "reasonable timeout is not extreme", diff: makeDiff("x.py", ["    timeout = 30"]), exclude: ["G01"] },
  { name: "retry budget present", diff: makeDiff("x.py", ["    max_attempts = 3"]), exclude: ["G01", "E04"] },
  { name: "retry decorator with budget", diff: makeDiff("x.py", ["@retry(max_attempts=3, backoff=2)"]), exclude: ["E04"] },
  { name: "real assertion added", diff: makeDiff("test_x.py", ["    assert result == 42"]), exclude: ["H01"] },
  { name: "required field accessed directly", diff: makeDiff("x.py", ['    value = data["count"]']), exclude: ["A02"] },
  {
    name: "boundary validation of unknown metadata",
    diff: makeDiff("x.py", ['    if "unit" not in meta: raise ValueError("missing unit")']),
    exclude: ["B03"],
  },
  { name: "normal completion reply", reply: "已完成重构并通过测试。", exclude: ["H02", "H04", "H05", "G02"] },
  { name: "neutral action reply", reply: "I'll update the implementation now.", exclude: ["H05"] },
  {
    name: "legit technical uncertainty with direct answer",
    reply: "结论：这段代码不是线程安全的，需要加锁。具体默认值我不确定，建议查文档确认。",
    exclude: ["X01", "X02", "X03", "X04", "X05"],
  },
  {
    name: "legit safety caveat",
    reply: "这个操作会删除数据；执行前请确认已备份。",
    exclude: ["X01", "X02", "X03", "X04", "X05"],
  },
];

test("catalog contains 45 unique A01–H05 + X01–X05 rules", () => {
  const info = validateCatalog();
  assert.equal(info.total, 45);
  assert.deepEqual(RULE_IDS, EXPECTED_IDS);
  assert.equal(new Set(RULE_IDS).size, 45);
});

test("catalog has enough deterministic detectors and keeps manual rules explicit", () => {
  const byDetection = RULES.reduce((acc, rule) => {
    acc[rule.detection] = (acc[rule.detection] || 0) + 1;
    return acc;
  }, {});
  assert.ok(byDetection.static >= 20, `static detectors too few: ${JSON.stringify(byDetection)}`);
  assert.ok(byDetection.static + byDetection.text + byDetection.heuristic >= 30);
  assert.ok(byDetection.manual >= 5);
  for (const rule of RULES) {
    assert.ok(rule.severity === "error" || rule.severity === "warning" || rule.severity === "info");
    assert.ok(rule.suggestion && rule.suggestion.length > 0, `${rule.id} missing suggestion`);
  }
});

test("unified diff parser tracks added lines and file names", () => {
  const hunks = parseUnifiedDiff(makeDiff("src/app.py", ["    x = 1"], ["    y = 2"]));
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].file, "src/app.py");
  const added = hunks[0].lines.filter((line) => line.type === "+");
  assert.equal(added.length, 1);
  assert.equal(added[0].text, "    x = 1");
  assert.equal(added[0].newLine, 2);
});

for (const testCase of truePositiveCases) {
  test(`true positive: ${testCase.name}`, () => {
    const result = auditChange({ diff: testCase.diff || "", reply: testCase.reply || "" });
    const ids = new Set(result.findings.map((finding) => finding.rule_id));
    for (const expected of testCase.include) {
      assert.ok(ids.has(expected), `expected ${expected}, got [${[...ids].join(", ")}]`);
    }
    assert.ok(result.summary.total >= testCase.include.length);
    for (const finding of result.findings) {
      assert.ok(finding.rule_id && finding.title && finding.message && finding.suggestion);
      assert.ok(["error", "warning", "info"].includes(finding.severity));
    }
  });
}

for (const testCase of falsePositiveCases) {
  test(`false positive gate: ${testCase.name}`, () => {
    const result = auditChange({ diff: testCase.diff || "", reply: testCase.reply || "" });
    const ids = new Set(result.findings.map((finding) => finding.rule_id));
    for (const unexpected of testCase.exclude) {
      assert.ok(!ids.has(unexpected), `unexpected ${unexpected}, got [${[...ids].join(", ")}]`);
    }
  });
}

test("summary groups findings by severity, rule and group", () => {
  const result = auditChange({
    diff: makeDiff("x.py", ["    except Exception:", "        pass", '    count = data.get("count") or 0']),
  });
  assert.ok(result.summary.total >= 2);
  assert.ok(result.summary.by_rule.C02 >= 1);
  assert.ok(result.summary.by_rule.B01 >= 1);
  assert.ok(result.summary.by_severity.error >= 1);
  assert.ok(result.summary.by_group.C >= 1);
});
