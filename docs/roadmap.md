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
- [x] 单元测试：JSONL 解析、隔离目录、MCP 冒烟
- [x] 真实两轮 Codex 调用验证（isolated `CODEX_HOME`）

## Phase 2 — 审计与策略

- [ ] 规则引擎：A–H 共 40 类，支持 Python/TS/JS/Shell 的 diff 扫描
- [ ] 回复文本的畏缩行为检测
- [ ] `policy/anti-defensive.md`：规则正文、正例/反例回归集
- [ ] `audit_change` 工具
- [ ] 单元测试：TP/FP 样例 ≥ 20 条

## Phase 3 — 监督闭环

- [ ] `codex_correct`：把 findings 转成带证据的纠正指令
- [ ] `supervise`：任务→审计→纠正→复验→报告（≤3 轮）
- [ ] 结构化报告（已修复 / 未解决 / 未验证）
- [ ] 审计与纠错的历史记录

## Phase 4 — 实机验证与发布

- [ ] 真实项目 diff 的审计演示
- [ ] 故意防御性样例的纠正闭环演示
- [ ] 发布 v1.0.0
