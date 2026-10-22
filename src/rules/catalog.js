/**
 * 40-class anti-defensive rule catalog (A01–H05), derived from the local
 * "defensive programming audit" taxonomy used by this project.
 *
 * detection:
 *   static    — deterministic regex over added diff lines (or reply text)
 *   text      — heuristic over Codex's reply text (timidity / over-caution)
 *   heuristic — counted/context rule implemented by the audit engine
 *   manual    — needs supervising-agent judgement; never auto-reported as a defect
 *
 * Every rule keeps a short suggestion so corrections can quote rule_id + guidance.
 * Low-confidence regexes intentionally stay warnings; they are candidates, not verdicts.
 */

const m = (pattern, { flags = "", languages = null, message, suggestion = "", confidence = "medium" } = {}) => ({
  pattern,
  flags,
  languages,
  message,
  suggestion,
  confidence,
});

const t = (pattern, { flags = "iu", message, suggestion = "" } = {}) => ({
  pattern,
  flags,
  message,
  suggestion,
});

export const GROUPS = {
  A: "内部契约",
  B: "默认值与未知值",
  C: "异常语义",
  D: "状态与部分完成",
  E: "重试与兼容",
  F: "回退与伪成功",
  G: "参数与缩水",
  H: "验收与流程",
};

export const RULES = [
  // ── A 内部契约 ────────────────────────────────────────────────────────────
  {
    id: "A01", group: "A", title: "已验证类型逐层再判断", detection: "manual", severity: "warning",
    description: "同一不可变值被多层 isinstance/typeof 检查；集中解析，内部按契约使用。",
    suggestion: "只保留责任边界处的一次校验；内部消费已建立契约的数据。",
  },
  {
    id: "A02", group: "A", title: "必需字段按可选字段读取", detection: "static", severity: "warning",
    description: "`.get(...)` / `getattr(..., None)` 使漏字段悄悄通过，掩盖生产者违约。",
    suggestion: "修复生产者或直接暴露契约错误；仅对契约明确的可选成员使用默认值。",
    matchers: [
      m(/\b\w+\.get\(\s*["'][A-Za-z_][\w.-]*["']\s*\)/, {
        message: "必需字段按可选字段读取（.get 无默认值）",
        confidence: "low",
      }),
      m(/getattr\([^,)]+,\s*["'][\w.-]+["']\s*,\s*None\s*\)/, {
        message: "必需成员用 getattr(..., None) 兜底",
        confidence: "low",
      }),
    ],
  },
  {
    id: "A03", group: "A", title: "必需依赖缺失时临时造对象", detection: "static", severity: "warning",
    description: "缺共享锁/状态机时临时创建替代对象，破坏构造期不变量。",
    suggestion: "在构造期建立真实不变量；初始化失败直接暴露，不返回半可用对象。",
    matchers: [
      m(/if\s+not\s+self\._\w+\s*:\s*self\._\w+\s*=/, {
        message: "缺依赖时临时创建替代对象",
      }),
    ],
  },
  {
    id: "A04", group: "A", title: "生产代码迁就残缺测试替身", detection: "static", severity: "info",
    description: "因 fake/mock 缺成员而用 hasattr 跳过正式检查。",
    suggestion: "修复测试替身使其满足被替代接口，生产逻辑不迁就替身。",
    matchers: [
      m(/hasattr\(\s*[^,)]+,\s*["'][\w-]+["']\s*\)/, {
        message: "hasattr 检查可能是迁就残缺测试替身（需人工确认）",
        confidence: "low",
      }),
    ],
  },
  { id: "A05", group: "A", title: "复制同一份校验", detection: "manual", severity: "warning", description: "同一边界、同一数据重复校验，导致规则漂移；跨时间/并发的独立核验除外。", suggestion: "校验责任集中一处；保留跨时间窗口的独立核验。" },

  // ── B 默认值与未知值 ──────────────────────────────────────────────────────
  {
    id: "B01", group: "B", title: "缺失与有效零值混淆", detection: "static", severity: "warning",
    description: "`value or default` 把 0/False/空集合当成缺失。",
    suggestion: "用显式 None/缺失判断，区分缺失、None、0、False 与空集合。",
    matchers: [
      m(/\bor\s+(?:0|0\.0|False|\[\]|\{\}|""|'')/, { message: "or 默认值把有效零值/空值当成缺失" }),
      m(/\.get\([^)]*\)\s+or\s+/, { message: ".get(...) or 默认值混淆缺失与零值" }),
    ],
  },
  {
    id: "B02", group: "B", title: "非法输入“修好”再用", detection: "static", severity: "warning",
    description: "NaN 改零、坏长度补齐、坏姿态变单位姿态后继续宣称输入有效。",
    suggestion: "拒绝非法输入或采用有定义的缺测策略，并保留数据质量标记。",
    matchers: [
      m(/nan_to_num|fillna\(\s*0\s*\)|np\.zeros_like/, { message: "把非法/缺失数值修补成零值后继续使用" }),
    ],
  },
  {
    id: "B03", group: "B", title: "未知元数据推定为正常", detection: "static", severity: "warning",
    description: "坐标系、单位、几何类型缺失时默认成“正常”值。",
    suggestion: "在边界校验语义；未知元数据不得猜测为正常值。",
    matchers: [
      m(/\.get\(\s*["'](?:unit|frame|coord|geometry|mode|version|type)["']\s*,/, { message: "未知元数据用默认值推定为正常" }),
      m(/getattr\([^,)]+,\s*["'](?:unit|frame|mode|version)["']/, { message: "元数据缺失时用 getattr 默认值推定正常" }),
    ],
  },
  {
    id: "B04", group: "B", title: "刷新旧数据时间戳", detection: "heuristic", severity: "warning",
    description: "缓存/旧数据被写入新时间戳，伪装成新观测。",
    suggestion: "保留真实采样时间与数据来源，不覆盖时效信息。",
    matchers: [
      m(/^(?=.*\bcache\b)(?=.*(?:time\.time\(\)|datetime\.now\(\)|time\(\))).*$/i, {
        message: "缓存数据同时写入当前时间戳，可能伪造时效",
        confidence: "low",
      }),
    ],
  },
  { id: "B05", group: "B", title: "把建议值冒充实际读数", detection: "manual", severity: "warning", description: "UI 用默认值填缺失状态并可回写。", suggestion: "显示未知；用户明确选择后才应用默认值。" },

  // ── C 异常语义 ────────────────────────────────────────────────────────────
  {
    id: "C01", group: "C", title: "大范围捕获一切异常", detection: "static", severity: "warning",
    description: "网络与计算混在一个 try 中，或用裸 except / 空 catch。",
    suggestion: "缩小 try 范围，只捕获当前层能处理或必须转换的具体异常。",
    matchers: [
      m(/except\s+(?:Exception|BaseException)\b/, { languages: ["python"], message: "宽泛捕获 Exception/BaseException" }),
      m(/except\s*:/, { languages: ["python"], message: "裸 except 捕获一切" }),
      m(/catch\s*\{\s*$/, { languages: ["js", "ts"], message: "JS 空 catch（无绑定、无处理）" }),
    ],
  },
  {
    id: "C02", group: "C", title: "异常吞掉继续", detection: "static", severity: "error",
    description: "`except: pass`、打印后继续、`|| true`、忽略退出码。",
    suggestion: "保留失败传播或设置明确失败状态；不得静默吞掉。",
    matchers: [
      m(/except[^:\n]*:\s*(?:pass|continue|\.\.\.)\s*(?:#.*)?$/, { languages: ["python"], message: "异常被 pass/continue 吞掉" }),
      m(/\|\|\s*true\b|2>\/dev\/null/, { languages: ["shell", "js", "ts"], message: "忽略命令/表达式失败" }),
    ],
  },
  {
    id: "C03", group: "C", title: "失败折叠为正常空结果", detection: "static", severity: "error",
    description: "无目标、超时、崩溃都返回 []/None，调用方无法区分。",
    suggestion: "使用可区分的业务结果/错误类型，不把失败压成空集合。",
    matchers: [
      m(/except[^:\n]*:\s*return\s+(?:None|\[\]|\{\}|False|0|""|'')\b/, { languages: ["python"], message: "异常被折叠成空结果" }),
    ],
  },
  {
    id: "C04", group: "C", title: "异常只剩一句文本", detection: "static", severity: "error",
    description: "转译丢失类型、因果和堆栈。",
    suggestion: "保留异常链（raise ... from exc）；文本只作为诊断摘要。",
    matchers: [
      m(/=\s*str\(\s*(?:e|exc|err|error)\s*\)/, { message: "异常仅转成字符串，丢失类型与因果" }),
    ],
  },
  {
    id: "C05", group: "C", title: "错误文字充当状态位", detection: "static", severity: "error",
    description: "`if error_text` 漏掉空消息异常，缺少显式成功/失败判据。",
    suggestion: "使用显式成功/失败状态；不以错误文本真假判断结果。",
    matchers: [
      m(/if\s+(?:error_text|err_text|error_message|str\(\s*(?:e|exc)\s*\))\s*:/, { message: "用错误文本真假判断失败" }),
    ],
  },

  // ── D 状态与部分完成 ──────────────────────────────────────────────────────
  {
    id: "D01", group: "D", title: "未知状态默认健康", detection: "static", severity: "warning",
    description: "缺反馈时推定已停止/无故障/无需恢复。",
    suggestion: "保留未知状态与受影响操作限制，未知不等于健康。",
    matchers: [
      m(/or\s+["'](?:READY|OK|healthy|正常)["']/i, { message: "未知状态回退成“正常/健康”" }),
      m(/state\s*=\s*["'](?:READY|OK|正常)["']/, { message: "状态被默认置为正常" }),
    ],
  },
  { id: "D02", group: "D", title: "接口成功冒充目标成功", detection: "manual", severity: "error", description: "指令受理等同物体已抓住、请求 200 等同任务完成。", suggestion: "按可观察功能层级验收；接口成功只证明该层。" },
  { id: "D03", group: "D", title: "部分执行被写成未执行", detection: "manual", severity: "error", description: "超时后抹掉副作用，或把已发生部分执行当作未执行。", suggestion: "保留阶段、操作身份与不确定结果。" },
  {
    id: "D04", group: "D", title: "二次故障覆盖首个故障", detection: "static", severity: "error",
    description: "恢复/清理异常覆盖原错误，或把需恢复改成普通失败。",
    suggestion: "保留两层因果（from exc / 异常组），不覆盖原始故障与恢复锁。",
    matchers: [],
  },
  { id: "D05", group: "D", title: "后台失效仍显示正常", detection: "manual", severity: "warning", description: "线程死亡或初始化半完成，前台仍 READY。", suggestion: "由生命周期边界报告真实状态，前台不缓存“正常”。" },

  // ── E 重试与兼容 ──────────────────────────────────────────────────────────
  {
    id: "E01", group: "E", title: "虚构历史兼容", detection: "static", severity: "warning",
    description: "未确认版本也增加旧字段与备用路径。",
    suggestion: "只支持有明确需求的版本；兼容分支集中在边界适配处并有验证。",
    matchers: [
      m(/hasattr\([^)]*["'](?:__version__|version_)[^)]*\)/, { message: "未确认版本即增加兼容判断" }),
      m(/sys\.version_info\s*[<>]|platform\.version\(\)/, { message: "按运行时版本猜兼容分支" }),
    ],
  },
  {
    id: "E02", group: "E", title: "用异常猜接口签名", detection: "static", severity: "error",
    description: "捕获任意 TypeError 再试调用，掩盖函数内部缺陷。",
    suggestion: "查文档/源码确定签名；不通过捕获 TypeError 反复试调用。",
    matchers: [m(/except\s+TypeError\b/, { message: "用 TypeError 猜接口签名" })],
  },
  {
    id: "E03", group: "E", title: "所有错误都重试", detection: "static", severity: "warning",
    description: "程序错误也持续重试，而不是只对可恢复故障重试。",
    suggestion: "只对已识别的可恢复故障重试，并设置次数/时间预算。",
    matchers: [m(/except[^:\n]*:\s*.*\b(?:retry|重试)\b/i, { message: "在异常处理中无条件重试" })],
  },
  {
    id: "E04", group: "E", title: "多层/无预算重试", detection: "static", severity: "error",
    description: "重试没有次数/时间上限，或多层叠加放大延迟。",
    suggestion: "单层负责重试，明确预算、退避、取消条件与可观测失败。",
    matchers: [
      m(/@retry(?!\s*\(\s*[^)]*(?:max_attempts|attempts|tries|stop_after_attempt|budget))/i, { languages: ["python"], message: "重试装饰器未声明预算" }),
      m(/while\s+True\s*:.*\bretry\b/i, { languages: ["python"], message: "无预算的无限重试" }),
    ],
  },
  {
    id: "E05", group: "E", title: "有副作用操作盲目重放", detection: "static", severity: "warning",
    description: "提交超时换新 UUID 再发运动/写入。",
    suggestion: "先明确幂等/去重与结果查询语义；超时不证明未执行。",
    matchers: [m(/uuid4\(\)/, { message: "副作用重放可能换新操作 ID", confidence: "low" })],
  },

  // ── F 回退与伪成功 ────────────────────────────────────────────────────────
  {
    id: "F01", group: "F", title: "静默切换模式", detection: "static", severity: "error",
    description: "真设备失败转 mock、模型失败换算法而仍报完成。",
    suggestion: "显式标注最终模式与能力差异；恢复结果不得冒充原请求成功。",
    matchers: [
      m(/mock\s*=\s*True|fallback_to_mock|use_mock\s*=\s*True|simulate\s*=\s*True/, { message: "失败路径静默切到 mock/仿真" }),
    ],
  },
  { id: "F02", group: "F", title: "旧缓存或回退冒充新成功", detection: "manual", severity: "error", description: "恢复旧设置被说成新设置已应用。", suggestion: "原请求结果与恢复结果分别报告。" },
  {
    id: "F03", group: "F", title: "删除失败分母", detection: "static", severity: "warning",
    description: "坏样本、失败请求直接跳过，报表只剩成功。",
    suggestion: "保留失败、超时、跳过与不完整样本的分母。",
    matchers: [m(/except[^:\n]*:\s*continue\s*#.*(?:skip|fail|失败|跳过)/i, { message: "异常路径直接 continue 并跳过统计" })],
  },
  {
    id: "F04", group: "F", title: "多层默认值洗掉根因", detection: "static", severity: "warning",
    description: "内层空值、中层补默认、外层报成功，根因丢失。",
    suggestion: "修复最初契约违约并维护状态，不在多层叠加默认值。",
    matchers: [m(/\bor\s+[^;\n]+?\s+or\s+/, { message: "链式默认值逐层洗掉根因" })],
  },
  {
    id: "F05", group: "F", title: "无需求的备用实现/框架", detection: "static", severity: "info",
    description: "每个函数都包“安全调用”，每项常量都可配置。",
    suggestion: "只引入当前需求所需机制，删除无需求的安全包装/配置框架。",
    matchers: [
      m(/def\s+safe_\w+\s*\(/, { message: "无需求的 safe_* 包装函数" }),
      m(/class\s+Safe\w*\s*[(:]/, { message: "无需求的安全包装类" }),
    ],
  },

  // ── G 参数与缩水 ──────────────────────────────────────────────────────────
  {
    id: "G01", group: "G", title: "无依据的极端保守值", detection: "static", severity: "warning",
    description: "动作小到看不出、超时短到总失败、阈值高到无效。",
    suggestion: "参数必须同时满足任务与真实边界，并说明来源与验证方式。",
    matchers: [
      m(/timeout\s*=\s*(?:0|0\.\d+|[1-4])\b/, { message: "超时值极端保守，可能导致任务总失败" }),
      m(/max_(?:retries|attempts)\s*=\s*1\b/, { message: "重试上限 1，疑似用保守值掩盖问题" }),
      m(/threshold\s*=\s*0\.(?:9[5-9]|99)/, { message: "阈值极端保守，可能使功能失效" }),
    ],
  },
  {
    id: "G02", group: "G", title: "擅自减少任务规模/质量", detection: "text", severity: "warning",
    description: "降分辨率、缩数据、降低精度或覆盖，偷换用户验收。",
    suggestion: "不得擅自缩小任务参数；需要变更时明确说明并取得授权。",
    textMatchers: [
      t(/(?:为了(?:简化|保险|安全|稳定|避免风险)|先(?:只|暂时)|暂时(?:降级|关闭)|降级处理|简化处理|缩小(?:范围|规模)|降低(?:精度|分辨率)|样本数?(?:减|缩))/, {
        message: "回复中以“简化/保险/暂时”为由缩小任务规模",
        suggestion: "回到原任务参数；若确有冲突，说明证据并请求授权。",
      }),
    ],
  },
  {
    id: "G03", group: "G", title: "静默限幅与截断", detection: "static", severity: "warning",
    description: "请求动作被裁剪，仍报告原任务成功。",
    suggestion: "明确拒绝或报告实际生效值；限幅必须是已定义的安全机制并可追踪。",
    matchers: [
      m(/\.clip\(|\bclamp\(|np\.clip\(|\bmin\(\s*max\(/, { message: "静默 clamp/clip 可能改变请求值" }),
    ],
  },
  {
    id: "G04", group: "G", title: "经验值伪装硬限制", detection: "static", severity: "warning",
    description: "示例/初始值/单次试验变成“硬件只能如此”。",
    suggestion: "注明来源和适用条件；经验值不得冒充硬限制。",
    matchers: [m(/#.*(?:只能|最多|上限|最大支持|hardware limit).*\d/i, { message: "注释把经验值声明为硬限制" })],
  },
  { id: "G05", group: "G", title: "各层门限叠加使功能失效", detection: "manual", severity: "warning", description: "局部门限合理，组合后无可行路径。", suggestion: "检查端到端可达性与时间预算。" },

  // ── H 验收与流程 ──────────────────────────────────────────────────────────
  {
    id: "H01", group: "H", title: "为绿灯改变测试标准", detection: "static", severity: "error",
    description: "放宽断言、删难例、随意 skip、只测启动。",
    suggestion: "测试必须覆盖真实症状；不得删除断言或跳过失败样例。",
    matchers: [
      m(/assert\s+True\b|assert\s+1\s*==\s*1/, { message: "伪造恒真断言" }),
      m(/pytest\.mark\.skip|test\.skip|it\.skip|describe\.skip|\.skip\(|xfail/, { message: "跳过测试而非修复" }),
      m(/#\s*type:\s*ignore/, { message: "用 type: ignore 掩盖类型错误" }),
    ],
  },
  {
    id: "H02", group: "H", title: "模拟证据升级为实机证据", detection: "text", severity: "warning",
    description: "mock 反馈被称作实机到位/夹持成功。",
    suggestion: "标明设备、版本与证据层级；模拟通过只证明软件链路。",
    textMatchers: [
      t(/(?:mock|模拟|仿真).{0,24}(?:已验证|实机|到位|成功|通过)|(?:验证通过|已到位|已完成).{0,16}(?:mock|模拟|仿真)/, {
        message: "把模拟/mock 证据升级为实机完成",
      }),
    ],
  },
  {
    id: "H03", group: "H", title: "补丁代替根因修复", detection: "heuristic", severity: "warning",
    description: "多处加判断仍保留错误状态模型，未消除根因。",
    suggestion: "做消除根因的最小闭合改动；必要时允许跨文件重构。",
    matchers: [],
  },
  {
    id: "H04", group: "H", title: "未核实就编造限制或 API", detection: "text", severity: "warning",
    description: "用“可能不支持”当事实，再削减需求。",
    suggestion: "先读源码/文档/实测；不得以未核实的限制削减需求。",
    textMatchers: [
      t(/(?:可能|应该|大概)(?:不|未)(?:支持|兼容)|probably not supported|might not support|may not be supported/i, {
        message: "以未核实的“可能不支持”限制任务",
      }),
    ],
  },
  {
    id: "H05", group: "H", title: "流程上的过度防御 / 畏缩", detection: "text", severity: "warning",
    description: "常规可逆工作反复求确认，堆无关审批/日志/计划，或“带着镣铐”式谨慎。",
    suggestion: "授权内的常规可逆工作直接推进；只澄清会实质改变结果的未知条件。允许必要重构，用验证闭环管理风险。",
    textMatchers: [
      t(/(?:为了安全起见|保险起见|以防万一|谨慎起见|风险较大|可能不安全|建议先备份|先备份|建议先小步|小步试探|要不要我|需要我|是否需要我|是否要我|如果你希望|如果你需要|为了稳妥|稳妥起见|避免风险|should I|do you want me to|would you like me to|for safety|to be safe|let me know if|before (?:making changes|proceeding)|be careful|conservative approach|I can also)/, {
        message: "回复出现畏缩/过度确认行为",
      }),
    ],
  },
];

export const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export const RULE_IDS = RULES.map((rule) => rule.id);

export function validateCatalog(rules = RULES) {
  const ids = new Set();
  const expectedPrefix = { A: "A", B: "B", C: "C", D: "D", E: "E", F: "F", G: "G", H: "H" };
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
    if (!/^[A-H]\d{2}$/.test(rule.id)) throw new Error(`invalid rule id: ${rule.id}`);
    if (rule.id[0] !== rule.group) throw new Error(`rule ${rule.id} group mismatch: ${rule.group}`);
    if (!GROUPS[rule.group]) throw new Error(`unknown group for ${rule.id}`);
    if (!rule.title || !rule.description) throw new Error(`rule ${rule.id} missing title/description`);
    if (!["static", "text", "heuristic", "manual"].includes(rule.detection)) {
      throw new Error(`rule ${rule.id} has invalid detection: ${rule.detection}`);
    }
    if (rule.detection === "static" && rule.id !== "D04" && !(rule.matchers?.length)) {
      throw new Error(`static rule ${rule.id} has no matchers`);
    }
    if (rule.detection === "text" && !(rule.textMatchers?.length)) {
      throw new Error(`text rule ${rule.id} has no textMatchers`);
    }
  }
  for (const [prefix] of Object.entries(expectedPrefix)) {
    const count = rules.filter((rule) => rule.id.startsWith(prefix)).length;
    if (count !== 5) throw new Error(`group ${prefix} expected 5 rules, got ${count}`);
  }
  return { total: rules.length, groups: Object.keys(GROUPS).length };
}
