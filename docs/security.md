# 安全说明

## 凭据

- 本工具复用本机 `codex` CLI 的登录态（ChatGPT 账号），**不读取、不打印、不提交**任何令牌。
- 如需隔离 `CODEX_HOME`，只复制 `auth.json` 到工作区的独立目录：
  - 目录权限 `700`，文件权限 `600`；
  - 目录必须加入 `.gitignore`（默认已忽略 `.codex-home/`）；
  - 不把副本复制到会被发布、同步或备份的位置。
- 日志与审计证据中禁止出现 token、cookie、完整认证头；只允许记录状态码与错误类别。

## 运行边界

- MCP server 默认 stdio、只在本机运行，不监听网络端口。
- 监督目标的工作目录必须是显式传入的；不默认扫描用户主目录。
- 运行 Codex 时使用最小必要沙箱策略（默认 `workspace-write`，只读审查用 `read-only`），不默认 `danger-full-access`。
- **嵌套沙箱注意**：当 codex-supervisor 本身已运行在受限环境（例如 DeepSeek Harness 的 bash 沙箱）时，Codex 自带的 workspace-write 沙箱可能无法写入工作区（表现为 `Failed to write file`）。此时可显式使用 `sandbox: "danger-full-access"`：外层边界仍由宿主沙箱提供。若在无外层沙箱的普通终端运行，请保持 `workspace-write` 并自行确认工作区可写。

## 信任模型

- 本工具监督的是 Codex 的**行为与代码产出**，不构成对第三方代码的安全审计。
- Codex 生成的代码仍需人工复核；「审计通过」只代表未命中已定义规则，不代表代码安全。
- 反防御规则不得删除真实的安全边界（输入校验、权限、长度限制、事务、并发同步、设备保护）；这些在规则文件中以正例形式保护。

## 上报

发现安全问题请勿公开 issue 中粘贴凭据；可用 GitHub 的 Private vulnerability reporting。
