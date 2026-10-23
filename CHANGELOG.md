# Changelog

## v1.0.0 — 2026-10-22

首个可用版本：通过 MCP 驱动 Codex、按 40 类反防御规则审计、并在监督闭环中把带证据的纠正指令发回 Codex。

### Added

- **MCP 通道**：`codex_ask` / `codex_continue` / `codex_status` / `codex_diff`；隔离 `CODEX_HOME`（auth 副本 600 + 最小 model 配置），不写用户 `~/.codex`。
- **40 类审计**：`src/rules/catalog.js`（A01–H05，8 组）、`src/audit.js`（diff 新增行 + 跨行模式 + 回复文本畏缩检测 + 汇总）、`audit_change` 工具。
- **监督闭环**：`codex_correct`（findings → 带 rule_id/文件:行/证据/行动偏好的纠正指令）与 `supervise`（任务→审计→纠正→复验→结构化报告，≤3 轮，`clean`/`unresolved`/`error`）。
- **审计历史**：每次闭环追加 `history.jsonl`。
- **策略正文**：[policy/anti-defensive.md](policy/anti-defensive.md)，含 40 类规则表、正例/反例、行动偏好（Scrum 式推进/允许必要重构）与误报处理。
- **DSH 集成**：config-only bundle（`dsh/`）与 `scripts/install-dsh.sh`。
- **测试**：67 个用例（TP/FP 回归、状态机四种结局、MCP 冒烟、untracked diff 审计）。
- **离线端到端演示**：`scripts/supervise-check.js --fake`（额度不可用时用确定性 shim 走完整闭环）。

### Verified

- 真实 Codex 闭环演示：真实 `supervise` 任务 → 审计 → 纠正 → 复验，161s / 2 轮；首轮 4 findings（3 可行动：A02/B01/C01/C02）→ 发出纠正 → 第二轮 0 可行动，`status=clean`。
- 真实项目只读审计：`rebot_remote_grasp`（24 个改动文件，diff 69,703 字节）→ 32 findings（1 error / 31 warning，A02×11、E05×11、C01×5、F04×3、B01、C04）。
- DSH 挂载：隔离 `DSH_HOME` 测试 profile 中 `dsh --profile web --dump-config` 成功合入 `mcp-codex-supervisor` 条目（`toolCallTimeoutMs: 600000`）。
- surface：GitHub `Ste11er/codex-supervisor`，MIT。

### Notes

- 真实 Codex 闭环演示曾因账号额度上限暂缓；额度恢复后已完成真实验证（2026-10-23）。
- 嵌套沙箱环境下 Codex 自身 workspace-write 可能无法写文件；此时用 `sandbox: "danger-full-access"`，由外层沙箱提供边界（见 docs/security.md）。
- `supervise` 单次调用可能持续数分钟，MCP 客户端需将请求超时设置到 ≥600000 ms（dsh bundle 已默认）。
