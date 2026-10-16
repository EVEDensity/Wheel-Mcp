# 首次接入 Godot 项目

[English](GETTING-STARTED.md) · [文档中心](README.md)

本机稳定版使用 Windows、Godot 4.7.2 与 Node.js 24。
Wheel-mcp 通过 stdio 在本机运行；访问展示页不会安装或启动服务。
仅操作可信项目：Godot 会以本机权限执行项目代码。

## 安装固定版本源码

先安装 Git、Node.js 和 Godot，再在 PowerShell 中运行：

```powershell
git clone --branch v0.2.5 https://github.com/EVEDensity/Wheel-Mcp.git
cd Wheel-Mcp
npm.cmd ci
npm.cmd run build
```

固定标签可避免 main 后续更新影响复现。GitHub Release 也附预编译运行包、SBOM
和 SHA256SUMS。本次没有发布 npm 包，不要假设 `npx wheel-mcp` 会安装这一版本。

## 选择自动或手动配置

自动配置：先备份已有 MCP 客户端配置，再运行 `npm.cmd run go:global`。
它会安装依赖、编译、查找 Godot，并更新全局和仓库内的客户端条目。
仅需仓库级配置时使用 `npm.cmd run go`。更新时保留 JSON 环境变量和客户端设置，
改写 JSON/`.env` 前备份原文件，异常 JSON 保持不变。备份可能含密钥，请勿公开。
这里的项目级配置指 Wheel-Mcp 仓库，不会自动写入其他游戏文件夹。

手动配置：按客户端要求，将下面的**服务条目**合并到已有配置。这不是完整配置文件。
替换所有路径；客户端引用该目录期间，请勿移动或删除 Wheel-Mcp 仓库。

```json
{
  "command": "node",
  "args": ["D:/tools/Wheel-Mcp/build/src/mcp-server-sdk.js"],
  "env": {
    "GODOT_PATH": "D:/tools/Godot_v4.7.2-stable_win64_console.exe",
    "MCP_STDIO_PROJECT_ROOTS": "D:/games/MyGame",
    "MCP_STDIO_EVIDENCE_ROOTS": "D:/wheel-evidence/MyGame",
    "MCP_STDIO_SCOPES": "read"
  }
}
```

先创建项目和证据目录；`MyGame` 必须含有 `project.godot`。
自动安装后也应在客户端服务环境中设置这些根目录。证据目录与项目分开，
不要授权整个磁盘；多个根目录用英文分号分隔。客户端找不到 Node 时，
将 `command` 改为 Node 可执行文件的绝对路径。

[客户端配置位置](../README.zh-CN.md#手动安装与客户端配置)与
[安装器覆盖范围](AGENT-COMPATIBILITY.md)说明现有适配方式。
能生成配置不等于特定客户端版本的所有工具、审批表单都已实测通过。

## 验证只读连接

重启客户端或重载 MCP 服务，先调用 `get_godot_version`，再调用
`get_project_info`，将 `projectPath` 设为 `D:/games/MyGame`。
确认引擎与项目均为预期对象后，再启用运行或写入。

遇到拒绝时检查精确的根目录与权限，不要直接放开整个磁盘。
见[常见问题](TROUBLESHOOTING.md)。

## 按需启用运行验证

将 `MCP_STDIO_SCOPES` 改为 `read,run`，重载服务，再按
[开发循环](DEV-LOOP.md)或[README 内置示例](../README.zh-CN.md#你可以这样使用)执行。
使用同一仓库随附的桥接脚本。`launch_project` 与 `open_runtime_bridge`
默认后台运行；复用返回的会话，不要每次查询重启引擎，完成后主动停止。

真实渲染截图需要有图形能力的运行方式，headless 没有截图帧缓冲。
README 内置示例请求了截图，因此不是纯后台检查。

## 单独启用写入

先备份游戏或提交 Git，再按需增加 `write`。普通写入要求客户端对精确事务
展示审批表单；参数中的 `approved: true` 不能代替批准。不支持表单的客户端
默认拒绝。本地预授权清单是另外的高级配置，不是通用的审批绕过开关。
编辑器创作还需[已授权的编辑器插件](production-roadmap/EDITOR-BRIDGE-CONTRACT.md)。

启用前阅读[权限策略](production-roadmap/AUTHORIZATION-POLICY.md)与
[事务契约](production-roadmap/TRANSACTION-CONTRACT.md)。
