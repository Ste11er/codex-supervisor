# src/

初始化阶段仅保留目录说明。Phase 1–3 将实现以下模块：

| 文件 | 职责 |
|---|---|
| `server.js` | MCP stdio server、工具注册 |
| `runner.js` | `codex exec --json` 子进程调用、JSONL 解析、thread 续聊 |
| `codex-home.js` | 隔离 `CODEX_HOME` 的准备与清理 |
| `audit.js` | 规则引擎（diff + 回复文本） |
| `rules/` | 40 类规则的具体实现 |
| `policy.js` | 策略加载与提示词注入 |
| `supervise.js` | 监督闭环状态机 |
| `tools.js` | MCP 工具参数/结果 schema |

编码约定：纯 ESM、Node ≥ 20、零/极少三方依赖（MCP SDK 与 zod 除外）、所有外部命令通过结构化参数传递。
