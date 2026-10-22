# 架构设计

> 状态：初始化阶段的设计基线；实现阶段可能微调，变更需同步更新本文件。

## 1. 目标与非目标

**目标**：把 Codex 变成可被另一个 Agent（监督者）稳定对话、审计、纠正的对象，并内置"反防御性编程 / 反畏缩"规则与闭环。

**非目标**：

- 不做 chatgpt.com 网页自动化；
- 不复制 Codex 的编码能力，本工具只做监督与编排；
- 不发明新的工程规范：策略基线来自机器本地的 `AGENTS.md` 与 40 类违规分类；
- 不把"安全/边界"一刀切删除——真实边界校验、事务、并发同步、设备保护必须保留（规则中以正例回归）。

## 2. 组件

```
            ┌────────────────────────────────────────────┐
            │ 监督者 Agent（DeepSeek Harness / 任意 MCP） │
            └───────────────┬────────────────────────────┘
                            │ MCP (stdio)
            ┌───────────────▼────────────────────────────┐
            │ codex-supervisor MCP server                │
            │  ├─ tools: ask/continue/status/diff/...    │
            │  ├─ runner: codex exec --json + resume     │
            │  ├─ audit: 规则引擎（diff + 回复文本）      │
            │  ├─ supervise: 闭环状态机                  │
            │  └─ policy: 规则文件与注入模板             │
            └───────────────┬────────────────────────────┘
                            │ 子进程
            ┌───────────────▼────────────────────────────┐
            │ 官方 codex CLI（隔离的 CODEX_HOME）         │
            │  thread_id 复用；JSONL 事件流               │
            └────────────────────────────────────────────┘
```

### 2.1 runner

- 调用 `codex exec --json`，解析 JSONL 事件：`thread.started`、`item.completed`、`turn.completed`、`error`、`turn.failed`。
- 用 `codex exec resume <thread_id>` 延续同一会话。
- 隔离 `CODEX_HOME`：默认复制到工作区内的独立目录（权限 `600`），避免污染用户主目录；也可显式指定。
- 账号额度/登录失效/模型不可用时返回结构化错误，不吞成空结果。

### 2.2 audit

输入：`git status` / `git diff`（或显式文本）+ Codex 最终回复。

输出：findings 列表：

```json
{
  "rule_id": "C02",
  "severity": "error",
  "file": "src/x.py",
  "line": 42,
  "evidence": "except Exception: pass",
  "message": "异常被吞掉，调用方无法区分失败",
  "suggestion": "缩小捕获范围或向上传播；若必须处理，设置明确失败状态"
}
```

规则分组（与规范分类对齐）：

- A 内部契约（类型/必需字段/测试替身）
- B 默认值与未知值
- C 异常语义
- D 状态与部分完成
- E 重试/兼容
- F 回退与伪成功
- G 参数与缩水
- H 验收与流程（含"反复确认/畏缩"这类流程性防御）

同时覆盖**行为文本**：如"为了安全起见先备份""是否要我继续""建议小步试探"等可被标注为流程性畏缩，交由监督者判定。

### 2.3 supervise

状态机：`collect → audit → correct → re-audit → report`，默认最多 3 轮纠正：

1. 发送任务（注入策略前缀：授权内直接行动、允许必要重构、不做想象兼容）；
2. 采集 diff 与回复；
3. 审计；无违规 → 报告完成；
4. 有违规 → 生成带 `rule_id + 文件:行 + 证据` 的纠正消息发回同一 thread；
5. 重复 2–4，超轮次则如实报告未解决项。

### 2.4 policy

独立文件（`policy/anti-defensive.md` 等），包含：

- 规则正文与判定边界（什么算真实防御、什么算过度防御）；
- 正例/反例回归集（防止误报）；
- 行动偏好（Scrum 式迭代：可逆工作直接推进，重构风险靠验证闭环管理而非回避）。

## 3. MCP 工具面

| 工具 | 关键参数 | 返回 |
|---|---|---|
| `codex_ask` | `prompt`, `cwd?`, `thread_id?`, `model?`, `sandbox?` | `reply`, `thread_id`, `events_summary` |
| `codex_continue` | `thread_id`, `prompt` | 同上 |
| `codex_status` | — | 登录态、额度、模型、CLI 版本 |
| `codex_diff` | `cwd` | `status`, `diff` |
| `audit_change` | `cwd?` / `diff?` / `reply?` | `findings[]`, `summary` |
| `codex_correct` | `thread_id`, `findings[]` | 纠正后的 `reply`, `thread_id` |
| `supervise` | `task`, `cwd`, `max_rounds?` | 逐轮 findings、`status`、`history_file` |
| `audit_change` | `cwd?`, `diff?`, `text?` | `findings[]`, `summary` |
| `codex_correct` | `thread_id`, `findings[]`, `task?` | 纠正后的回复 |
| `supervise` | `task`, `cwd`, `max_rounds?`, `policy?` | 每轮审计、最终报告、遗留项 |

## 4. DeepSeek Harness 集成

使用 DSH 自带的 `@deepseek-ai/dsh-mcp-client`：

```yaml
- id: mcp-codex-supervisor
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codex_supervisor
    transport: stdio
    command: node
    args: ['<repo>/bin/server.js']
    cwd: '<repo>'
    failOnStartupError: true
```

模型侧工具名为 `mcp__codex_supervisor__codex_ask` 等。

## 5. 约束与风险

- **额度**：Codex/ChatGPT 账号有使用上限（滚动窗口），额度耗尽时 runner 必须结构化上报，不重试轰炸。
- **沙箱**：DSH 的 bash 沙箱只允许写工作区；MCP 挂载后的进程权限需实测。若同样受限，监督目标必须位于工作区内，或由用户在自有终端运行 CLI。
- **凭据**：`CODEX_HOME` 副本含登录令牌，必须 `600`、gitignore，绝不提交。
- **App IPC**：桌面 App 的私有 IPC 只能向已打开线程注入、协议未公开且随版本变化，仅作为可选的 Phase 2 增强，默认关闭。
