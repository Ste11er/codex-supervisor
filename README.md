# codex-supervisor

> 让 AI Agent 通过 [MCP](https://modelcontextprotocol.io) 驱动、审计并纠正 OpenAI Codex —— 专治**防御性编程**与**畏缩行为**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: v1.1.0](https://img.shields.io/badge/status-v1.1.0-brightgreen.svg)](docs/roadmap.md)

## 背景

Codex / GPT 在工程任务中经常进入一种「带着镣铐工作」的状态：

- 用容错、默认值、兜底和兼容层掩盖契约破坏与未知状态；
- 该重构时只打补丁，该推进时反复请求确认；
- 把"不报错、测试变绿"当成任务完成，甚至擅自缩小目标或参数。

本项目把这种状态定义为可审计的违规模式，并提供一个监督闭环：一个 Agent（例如 DeepSeek Harness 中的主 Agent）通过 MCP 向 Codex 下任务，读取它的改动与回复，按规则审计，发现问题后把带证据的纠正指令发回 Codex，最多 N 轮后输出可信报告。

## 当前状态（v1.0.0 / 全部阶段完成）

Phase 0–5 已完成：通道、40 类 + 5 条会话级审计、监督闭环、审计历史、真实项目只读审计演示、DSH 挂载验证与 v1.1.0 发布。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

已实现：

- **通道**：隔离 `CODEX_HOME`（只复制 `auth.json` + 最小 model 配置，`600`）、`codex exec --json` + `resume` 同一 thread。
- **审计**：40 类反防御规则（A01–H05）+ 5 条会话级反防御（X01–X05，识别“吃了吗→仍待事实核查/先把定义钉死”式对冲）；[policy/anti-defensive.md](policy/anti-defensive.md) 为策略正文。
- **监督闭环**：`supervise` 一次调用完成 任务 → 采集 diff → 审计 → 纠正 → 复验 → 结构化报告（默认 ≤3 轮，状态 `clean` / `unresolved` / `error`）。
- **MCP 工具**：
  - `codex_status` / `codex_ask` / `codex_continue` / `codex_diff`
  - `audit_change` — 45 条规则审计（diff 或回复文本），返回 `rule_id / 文件:行 / 证据 / 建议 / summary`
  - `codex_correct` — 把 findings 转成带证据的纠正指令发回同一 thread
  - `supervise` — 闭环监督并返回逐轮 findings 与最终状态
- **审计历史**：每次闭环写入 `$CODEX_SUPERVISOR_STATE_DIR/history.jsonl`。
- **测试**：67+ 用例覆盖通道、隔离、45 条规则目录、TP/FP 回归、纠正提示、状态机三种结局。
- **DSH 集成**：config-only bundle 模板与安装脚本。

## 快速开始

```bash
npm install
npm test                  # 离线测试（MCP 冒烟测试需要本机 codex CLI）
node bin/server.js        # 启动 MCP stdio server
npm run audit-check       # 真实 git diff / 回复文本审计验证（不耗额度）
npm run supervise-check   # 真实 Codex 防御式任务 → 完整闭环演示（消耗额度）
npm run supervise-check:fake  # 额度不可用时的确定性 shim 端到端演示（不耗额度）
```

首次使用需要本机已 `codex login`（ChatGPT 账号）。隔离目录默认在 `./.state/`，可用 `CODEX_SUPERVISOR_STATE_DIR` 覆盖；也可用 `CODEX_HOME` 显式指定外部目录。

> **嵌套沙箱注意**：如果本工具已经运行在受限环境（如 DeepSeek Harness 的 bash 沙箱），Codex 自带的 `workspace-write` 沙箱可能无法写文件（`Failed to write file`）。此时给 `supervise`/`codex_ask` 传 `sandbox: "danger-full-access"`，由外层沙箱提供边界；在普通终端运行时请保持 `workspace-write`。

### MCP 客户端配置

```json
{
  "mcpServers": {
    "codex-supervisor": {
      "command": "node",
      "args": ["/path/to/codex-supervisor/bin/server.js"],
      "env": {
        "CODEX_SUPERVISOR_STATE_DIR": "/path/to/codex-supervisor/.state"
      }
    }
  }
}
```

### DeepSeek Harness

```bash
./scripts/install-dsh.sh web          # 打印渲染后的 patch（dry-run）
./scripts/install-dsh.sh web --write  # 追加到 profile patch（需写在沙箱外，重启/重载后生效）
```

挂载后工具名为 `mcp__codex_supervisor__supervise` 等。

## 工具说明

| 工具 | 参数 | 说明 |
|---|---|---|
| `codex_status` | — | 版本、登录态、隔离目录、模型配置 |
| `codex_ask` | `prompt`, `cwd?`, `thread_id?`, `model?`, `sandbox?`, `timeout_ms?` | 发任务；返回 `reply` / `thread_id` / `usage` |
| `codex_continue` | `thread_id`, `prompt`, `cwd?`, `model?`, `timeout_ms?` | 同一 thread 续聊 |
| `codex_diff` | `cwd`, `max_bytes?` | 采集 git 状态与 diff |
| `audit_change` | `cwd?`, `diff?`, `reply?`, `max_bytes?` | 45 条规则审计；返回 findings + summary |
| `codex_correct` | `thread_id`, `findings[]`, `task?`, `cwd?`, `model?`, `timeout_ms?` | 带证据的纠正指令发回同一 thread |
| `supervise` | `task`, `cwd`, `max_rounds?`, `thread_id?`, `model?`, `sandbox?`, `timeout_ms?` | 完整监督闭环 + 结构化报告 |

### 监督闭环示例

```text
supervise(task="实现 load_count(data)", cwd="/path/to/repo", max_rounds=3)
```

返回摘要：

```json
{
  "ok": true,
  "status": "clean",
  "thread_id": "01a16…",
  "rounds": [
    { "round": 1, "findings": 4, "actionable": 3, "corrected": true,
      "findings_detail": [{ "rule_id": "C02", "file": "count.py", "line": 6 }] },
    { "round": 2, "findings": 0, "actionable": 0, "corrected": false }
  ],
  "final_findings": [],
  "history_file": ".state/history.jsonl"
}
```

低置信候选（`confidence: low`）只作为提示，不触发自动纠正；`error` 与普通 `warning` 才会进入纠正指令。失败、额度耗尽、超时都会以 `isError` + 结构化错误返回，**不会**伪装成空结果或成功。

> **长任务超时**：`supervise` 一次调用可能持续数分钟（真实 Codex 两轮约 1–3 分钟），MCP 客户端需把 `toolCallTimeoutMs` 调到 `≥600000`；`dsh/` bundle 已默认设置为 `600000`。SDK 客户端示例：`client.callTool({...}, undefined, { timeout: 600000 })`。

## 安全

- 只在本机运行，不暴露网络服务。
- Codex 登录凭据不会被提交；隔离副本为 `600` 权限并默认被 `.gitignore` 忽略。详见 [docs/security.md](docs/security.md)。
- 审计通过只代表未命中已定义规则，不代表代码安全；真实边界校验、事务、并发同步不会因为「反防御」而被删除。误报处理见 [policy/anti-defensive.md](policy/anti-defensive.md#6-误报处理与规则演进)。

## License

[MIT](LICENSE) © 2026 Ste11er
