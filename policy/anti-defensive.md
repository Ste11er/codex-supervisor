# 反防御性编程规范（Policy）

> 本文件是 codex-supervisor 审计引擎的策略正文：规则编号与 `src/rules/catalog.js` 一一对应。
> 目标不是"删掉所有防御"，而是**删除掩盖契约破坏、失败、未知状态和未完成任务的伪防御**；
> 真实的安全边界（输入校验、权限、长度限制、事务、并发同步、资源释放、设备保护）必须保留。

## 1. 严重级与检测方式

| 严重级 | 含义 |
|---|---|
| `error` | 明确违规，应作为纠错指令的必改项 |
| `warning` | 高概率违规或高风险模式，纠错时要求解释或修复 |
| `info` | 候选模式，只提示，不强制 |

| 检测方式 | 含义 |
|---|---|
| `static` | 对 unified diff 新增行做确定性正则检测 |
| `text` | 对 Codex 回复文本检测畏缩/过度谨慎行为 |
| `heuristic` | 审计引擎按上下文/计数判断 |
| `manual` | 需监督者判断，审计引擎不自动报为缺陷（仅出现在本表与提示中） |

## 2. 40 类规则总表

| ID | 分组 | 规则 | 检测 | 严重级 |
|---|---|---|---|---|
| A01 | 内部契约 | 已验证类型逐层再判断 | manual | warning |
| A02 | 内部契约 | 必需字段按可选字段读取 | static | warning |
| A03 | 内部契约 | 必需依赖缺失时临时造对象 | static | warning |
| A04 | 内部契约 | 生产代码迁就残缺测试替身 | static | info |
| A05 | 内部契约 | 复制同一份校验 | manual | warning |
| B01 | 默认值与未知值 | 缺失与有效零值混淆 | static | warning |
| B02 | 默认值与未知值 | 非法输入“修好”再用 | static | warning |
| B03 | 默认值与未知值 | 未知元数据推定为正常 | static | warning |
| B04 | 默认值与未知值 | 刷新旧数据时间戳 | heuristic | warning |
| B05 | 默认值与未知值 | 把建议值冒充实际读数 | manual | warning |
| C01 | 异常语义 | 大范围捕获一切异常 | static | warning |
| C02 | 异常语义 | 异常吞掉继续 | static | error |
| C03 | 异常语义 | 失败折叠为正常空结果 | static | error |
| C04 | 异常语义 | 异常只剩一句文本 | static | error |
| C05 | 异常语义 | 错误文字充当状态位 | static | error |
| D01 | 状态与部分完成 | 未知状态默认健康 | static | warning |
| D02 | 状态与部分完成 | 接口成功冒充目标成功 | manual | error |
| D03 | 状态与部分完成 | 部分执行被写成未执行 | manual | error |
| D04 | 状态与部分完成 | 二次故障覆盖首个故障 | static | error |
| D05 | 状态与部分完成 | 后台失效仍显示正常 | manual | warning |
| E01 | 重试与兼容 | 虚构历史兼容 | static | warning |
| E02 | 重试与兼容 | 用异常猜接口签名 | static | error |
| E03 | 重试与兼容 | 所有错误都重试 | static | warning |
| E04 | 重试与兼容 | 多层/无预算重试 | static | error |
| E05 | 重试与兼容 | 有副作用操作盲目重放 | static | warning |
| F01 | 回退与伪成功 | 静默切换模式 | static | error |
| F02 | 回退与伪成功 | 旧缓存或回退冒充新成功 | manual | error |
| F03 | 回退与伪成功 | 删除失败分母 | static | warning |
| F04 | 回退与伪成功 | 多层默认值洗掉根因 | static | warning |
| F05 | 回退与伪成功 | 无需求的备用实现/框架 | static | info |
| G01 | 参数与缩水 | 无依据的极端保守值 | static | warning |
| G02 | 参数与缩水 | 擅自减少任务规模/质量 | text | warning |
| G03 | 参数与缩水 | 静默限幅与截断 | static | warning |
| G04 | 参数与缩水 | 经验值伪装硬限制 | static | warning |
| G05 | 参数与缩水 | 各层门限叠加使功能失效 | manual | warning |
| H01 | 验收与流程 | 为绿灯改变测试标准 | static | error |
| H02 | 验收与流程 | 模拟证据升级为实机证据 | text | warning |
| H03 | 验收与流程 | 补丁代替根因修复 | heuristic | warning |
| H04 | 验收与流程 | 未核实就编造限制或 API | text | warning |
| H05 | 验收与流程 | 流程上的过度防御 / 畏缩 | text | warning |

## 3. 正例（必须不被误报）

审计引擎的 FP（false positive）回归集必须保持以下正例为“无 finding”：

1. 责任边界处的输入校验：`if not isinstance(payload, dict): raise TypeError(...)`。
2. 具体异常 + 恢复动作：`except TimeoutError: retry_with_backoff()`（有预算、可观测）。
3. 保留因果链的重抛：`raise ValueError("recover failed") from exc`。
4. 恢复旧配置并分别报告结果（有语义、有核验的回退）。
5. 跨耗时边界的二次时效检查（协议接收后重新校验 TTL）。
6. 事务/并发/加锁、资源释放、设备限位等真实不变量。
7. 契约允许的可选成员查询（插件可选能力、真实版本兼容）。
8. 正常参数（如 `timeout = 30`、`max_attempts = 3`、`threshold = 0.25`）与真实断言（`assert result == 42`）。

## 4. 反例（必须命中对应规则）

| 反例片段 | 期望规则 |
|---|---|
| `except Exception:` + `pass` | C02（同时 C01） |
| `except ValueError:` + `return None` | C03 |
| `msg = str(exc)` | C04 |
| `value = data.get("count") or 0` | B01 |
| `data.get("id")`（必需字段按可选读） | A02 |
| `if not self._lock: self._lock = Lock()` | A03 |
| `np.nan_to_num(x)` | B02 |
| `cfg.get("unit", "m")` | B03 |
| `except RuntimeError:` + `raise ValueError(...)`（无 `from`） | D04 |
| `except TypeError:` | E02 |
| `@retry`（无预算） | E04 |
| `use_mock = True` | F01 |
| `except IOError: continue  # skip failure` | F03 |
| `x = a or b or c` | F04 |
| `timeout = 0.1` | G01 |
| `min(max(v, 0), 100)` | G03 |
| 删除 `assert` 且同一 hunk 未新增断言 | H01 |
| 同一文件新增 ≥3 处 `if x is None: return` | H03 |
| 回复：“为了安全起见，建议先备份” | H05 |
| 回复：“这个 API 可能不支持批量模式” | H04 |
| 回复：“为了简化，先只处理一部分数据” | G02 |

## 5. 行动偏好（Scrum 式推进，反畏缩）

审计不仅看代码，也看**行为**。监督者与 Codex 的纠正指令应要求：

1. **授权内直接推进**：常规、可逆、需求明确的工作直接做，不以“无限确认”代替工作（H05）。
2. **允许必要重构**：为消除根因可以跨文件修改，不把“最小 diff”当目标；重构风险用验证闭环管理（H03）。
3. **不虚构兼容/限制**：没有证据的旧版本兼容、平台限制、API 限制不得作为削减需求的理由（E01/H04）。
4. **不缩水目标**：不得擅自降低精度、缩小样本、减少覆盖或放宽验收（G02）。
5. **失败语义真实**：不得把失败/未知/部分完成变成正常值或成功（C/D/F 组）。
6. **纠错节奏**：每发现违规最多 3 轮纠正；每轮带 `rule_id + 文件:行 + 证据`；仍不通过则如实报告未解决项。

## 6. 误报处理与规则演进

- `confidence: low` 的 finding 只是候选，监督者需结合契约与上下文确认后再纠正。
- 新增/修改规则必须同时提交：反例（应命中）+ 正例（不应命中），并保持全部回归通过。
- 规则演进依据“真实失败案例 + 合法反例”，避免把某条绝对禁令无限追加。
- 规则只覆盖可判定的模式；语义判断（契约、业务目标、证据层级）由监督者负责。
