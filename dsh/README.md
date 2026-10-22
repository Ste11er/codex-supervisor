# DeepSeek Harness 集成

本目录将包含 config-only bundle，用于通过 DSH 自带的 `@deepseek-ai/dsh-mcp-client` 挂载 codex-supervisor 的 MCP server。

## 目标形态

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

挂载后模型侧工具名为：

```text
mcp__codex_supervisor__codex_ask
mcp__codex_supervisor__audit_change
mcp__codex_supervisor__supervise
...
```

## 安装

Phase 1 完成后提供：

- `dsh/cordis.patch.yml`（插入 MCP client 条目）
- `dsh/package.json`（bundle 清单）
- `scripts/install-dsh.sh`（把条目写入 DSH profile 的 patch 层，或提示手动步骤）

安装需要写 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，属于用户本机配置变更，脚本会先打印 diff 再写入。
