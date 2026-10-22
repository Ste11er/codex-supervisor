# codex-supervisor

> 让 AI Agent 通过 [MCP](https://modelcontextprotocol.io) 驱动、审计并纠正 OpenAI Codex —— 专治**防御性编程**与**畏缩行为**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: phase 2](https://img.shields.io/badge/status-phase%202-blue.svg)](docs/roadmap.md)

## 背景

Codex / GPT 在工程任务中经常进入一种「带着镣铐工作」的状态：

- 用容错、默认值、兜底和兼容层掩盖契约破坏与未知状态；
- 该重构时只打补丁，该推进时反复请求确认；
- 把"不报错、测试变绿"当成任务完成，甚至擅自缩小目标或参数。

本项目把这种状态定义为可审计的违规模式，并提供一个监督闭环：一个 Agent（例如 DeepSeek Harness 中的主 Agent）通过 MCP 向 Codex 下任务，读取它的改动与回复，按规则审计，发现问题后把带证据的纠正指令发回 Codex，最多 N 轮后输出可信报告。

## 当前状态（v0.2.0 / Phase 2）

已实现：

- **通道**：隔离 `CODEX_HOME`（只复制 `auth.json` + 最小 model 配置，`600`）、`codex exec --json` + `resume` 同一 thread。
- **MCP 工具**：
  - `codex_status` — CLI 版本、登录态、隔离目录、模型配置
  - `codex_ask` — 发任务；带 `thread_id` 则续聊
  - `codex_continue` — 同一 thread 追问
  - `codex_diff` — 采集 `git status` / `git diff` 作为审计证据
  - `audit_change` — 对 unified diff 的新增行与 Codex 回复文本做 **40 类反防御规则**审计，返回 `rule_id / 文件:行 / 证据 / 建议 / summary`
- **规则与策略**：[policy/anti-defensive.md](policy/anti-defensive.md)（40 类规则表、正例/反例、行动偏好、误报处理）；[src/rules/catalog.js](src/rules/catalog.js)（规则数据）。
- **测试**：JSONL 解析、隔离目录、MCP 工具、40 类目录校验、反例 TP、正例 FP 回归。
- **DSH 集成**：config-only bundle 模板与安装脚本。

**尚未实现（Phase 3）**：`codex_correct`、`supervise` 闭环与审计历史。

## 快速开始

```bash
npm install
npm test                # 离线测试（MCP 冒烟测试需要本机 codex CLI）
node bin/server.js      # 启动 MCP stdio server
npm run audit-check     # 真实 git diff / 回复文本的 audit_change 验证（不耗 Codex 额度）
npm run live-check      # 真实两轮 Codex 调用 + diff 采集（消耗额度）
```

首次使用需要本机已 `codex login`（ChatGPT 账号）。隔离目录默认在 `./.state/`，可用 `CODEX_SUPERVISOR_STATE_DIR` 覆盖；也可用 `CODEX_HOME` 显式指定外部目录。

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

挂载后工具名为 `mcp__codex_supervisor__codex_ask` 等。

## 工具说明

| 工具 | 参数 | 说明 |
|---|---|---|
| `codex_status` | — | 版本、登录态、隔离目录、模型配置 |
| `codex_ask` | `prompt`, `cwd?`, `thread_id?`, `model?`, `sandbox?`, `timeout_ms?` | 发任务；返回 `reply` / `thread_id` / `usage` |
| `codex_continue` | `thread_id`, `prompt`, `cwd?`, `model?`, `timeout_ms?` | 同一 thread 续聊 |
| `codex_diff` | `cwd`, `max_bytes?` | 采集 git 状态与 diff |
| `audit_change` | `cwd?`, `diff?`, `reply?`, `max_bytes?` | 40 类规则审计；返回 findings + summary |

### 审计用法示例

```text
audit_change(cwd="/path/to/repo")                         # 采集当前 diff 并审计
audit_change(diff="<unified diff>")                       # 直接审计给定 diff
audit_change(reply="为了安全起见，建议先备份再改……")        # 审计回复中的畏缩行为
```

输出示例：

```json
{
  "ok": true,
  "findings": [
    { "rule_id": "C02", "severity": "error", "file": "app.py", "line": 6,
      "evidence": "except Exception: / pass", "suggestion": "保留失败传播或设置明确失败状态" }
  ],
  "summary": { "total": 1, "by_severity": { "error": 1 } }
}
```

安全语义：失败、额度耗尽、超时都会以 `isError` + 结构化错误返回，**不会**伪装成空结果或成功。

## 安全

- 只在本机运行，不暴露网络服务。
- Codex 登录凭据不会被提交；隔离副本为 `600` 权限并默认被 `.gitignore` 忽略。详见 [docs/security.md](docs/security.md)。
- 审计通过只代表未命中已定义规则，不代表代码安全；真实边界校验、事务、并发同步不会因为「反防御」而被删除。误报处理见 [policy/anti-defensive.md](policy/anti-defensive.md#6-误报处理与规则演进)。

## License

[MIT](LICENSE) © 2026 Ste11er
