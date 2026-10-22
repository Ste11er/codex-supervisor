# codex-supervisor

> 让 AI Agent 通过 [MCP](https://modelcontextprotocol.io) 驱动、审计并纠正 OpenAI Codex —— 专治**防御性编程**与**畏缩行为**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: initialization](https://img.shields.io/badge/status-initialization-orange.svg)](docs/roadmap.md)

## 背景

Codex / GPT 在工程任务中经常进入一种「带着镣铐工作」的状态：

- 用容错、默认值、兜底和兼容层掩盖契约破坏与未知状态；
- 该重构时只打补丁，该推进时反复请求确认；
- 把"不报错、测试变绿"当成任务完成，甚至擅自缩小目标或参数。

本项目把这种状态定义为可审计的违规模式，并提供一个监督闭环：一个 Agent（例如 DeepSeek Harness 中的主 Agent）通过 MCP 向 Codex 下任务，读取它的改动与回复，按规则审计，发现问题后把带证据的纠正指令发回 Codex，最多 N 轮后输出可信报告。

## 设计要点

| 层 | 方案 |
|---|---|
| **通道** | 官方 `codex` CLI：`codex exec --json` + `resume` 复用同一 thread；隔离 `CODEX_HOME`，不依赖网页版 |
| **审计** | 40 类反防御规则（A01–H05，按契约/错误语义/默认值/状态/兼容/参数/验收/流程分组）+ 行动偏好（Scrum 式推进、允许必要重构、不虚构风险） |
| **闭环** | 任务 → 采集 diff/回复 → 审计 → 纠正 → 复验 → 报告（默认 ≤3 轮） |
| **集成** | 标准 MCP stdio server；可挂载到 DeepSeek Harness（`@deepseek-ai/dsh-mcp-client`）或任意 MCP 客户端 |
| **策略** | 规则与正/反例独立成文件，便于项目级覆盖，避免"反防御"演变成删除真实边界校验 |

## 状态

**v0.0.1 — 初始化阶段。** 当前仓库只有项目骨架、设计文档与 CI；MCP server、审计器与监督闭环将在后续阶段实现（见 [Roadmap](docs/roadmap.md)）。

## 计划中的工具面（MCP）

| 工具 | 作用 |
|---|---|
| `codex_ask` | 向 Codex 发任务，返回最终回复、`thread_id`、事件摘要 |
| `codex_continue` | 在同一 thread 续聊 |
| `codex_status` | 登录态、额度、模型与版本 |
| `codex_diff` | 采集工作区 `git status` / `git diff` 作为证据 |
| `audit_change` | 按规则审计 diff 与回复文本，输出 `rule_id / 文件:行 / 证据 / 纠正建议` |
| `codex_correct` | 把审计结论转成纠正指令发回同一 thread |
| `supervise` | 自动执行"任务→审计→纠正→复验→报告"闭环 |

## 目录结构

```text
codex-supervisor/
├── bin/            # CLI 入口（初始化阶段为占位）
├── src/            # MCP server、runner、audit、supervise（后续实现）
├── policy/         # 反防御规则、行动偏好与正/反例
├── dsh/            # DeepSeek Harness 的 MCP 挂载配置
├── docs/           # 架构、路线图、安全说明
├── test/           # 单元测试与 fixtures
└── .github/        # CI
```

## 快速开始

尚未发布可用版本。初始化阶段可验证脚手架：

```bash
node bin/codex-supervisor.js --version
npm test
```

## 安全

- 本项目只在本机运行，不暴露网络服务。
- Codex 登录凭据不会被提交；如需隔离 `CODEX_HOME`，请使用 `600` 权限的副本并加入 `.gitignore`。详见 [docs/security.md](docs/security.md)。

## License

[MIT](LICENSE) © 2026 Ste11er
