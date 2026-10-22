# Roadmap

## Phase 0 — 初始化

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

## Phase 3 — 监督闭环

- [ ] `codex_correct`：把 findings 转成带证据的纠正指令
- [ ] `supervise`：任务→审计→纠正→复验→报告（≤3 轮）
- [ ] 结构化报告（已修复 / 未解决 / 未验证）
- [ ] 审计与纠错的历史记录

## Phase 4 — 实机验证与发布

- [ ] 真实项目 diff 的审计演示
- [ ] 故意防御性样例的纠正闭环演示
- [ ] 发布 v1.0.0
