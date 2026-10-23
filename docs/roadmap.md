# Roadmap

## Phase 0 — 初始化 ✅

- [x] 仓库骨架、MIT LICENSE、README、.gitignore
- [x] 架构 / 路线图 / 安全文档
- [x] CI（语法与骨架 smoke test）
- [x] 发布公开仓库

## Phase 1 — 通道（MCP 骨架）✅

- [x] `codex exec --json` runner（JSONL 解析、`thread_id`、`resume`）
- [x] 隔离 `CODEX_HOME`（auth 副本 600 + 最小 config，不写 `~/.codex`）
- [x] MCP stdio server：`codex_ask` / `codex_continue` / `codex_status` / `codex_diff`
- [x] DSH config-only bundle（`dsh/`）与安装脚本
- [x] 单元测试 + 真实两轮 Codex 调用验证

## Phase 2 — 审计与策略 ✅

- [x] 40 类规则目录（A01–H05，含检测方式/严重级/建议）
- [x] diff 新增行静态检测（≥20 类）+ 跨行模式（吞异常/覆盖因果/删断言）
- [x] 回复文本畏缩行为检测（H05/H04/G02/H02）
- [x] `policy/anti-defensive.md`：规则表、正例/反例、行动偏好、误报处理
- [x] `audit_change` MCP 工具
- [x] 测试：反例 ≥20 条、正例 FP 回归 ≥6 条

## Phase 3 — 监督闭环 ✅

- [x] `codex_correct`：findings → 带证据的纠正指令（rule_id / 文件:行 / 证据 / 行动偏好）
- [x] `supervise`：任务→审计→纠正→复验→结构化报告（≤N 轮，clean/unresolved/error）
- [x] 可行动 findings 过滤（低置信候选不触发自动纠正）
- [x] 审计历史 `history.jsonl`
- [x] 单元测试（提示词/状态机三种结局）+ 确定性 shim 端到端闭环演示

## Phase 4 — 实机验证与发布 ✅

- [x] 真实项目只读审计演示：`rebot_remote_grasp` 24 个改动文件 → 32 findings（1 error / 31 warning）
- [x] DSH 挂载验证：隔离 `DSH_HOME` 中 `dsh --profile web --dump-config` 合入 `mcp-codex-supervisor`（含 `toolCallTimeoutMs: 600000`）
- [x] 真实 Codex 闭环演示：额度恢复后通过 MCP `supervise` 跑完整闭环（若额度受限则保留阻塞证据，shim 演示保底）
- [x] 发布 v1.0.0（tag `v1.0.0`）

## Phase 5 — 会话级反防御 ✅

- [x] 新增 X01–X05 会话级规则（过度对冲、学究式定义、事实核查升级、追问让步循环、元讨论）
- [x] 纠正提示词加入“先直接回答，再补限定”的行动要求
- [x] 单元测试覆盖“吃了吗”反模式与合法技术不确定性的 FP 门禁
- [x] 发布 v1.1.0
