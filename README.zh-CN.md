<p align="center"><img src="assets/logo.png" alt="Wheel-mcp logo" width="100%"></p>

# Wheel-mcp

**简体中文** | [English](README.md)

> 让 AI 不只写 Godot 代码，还能运行游戏、检查结果。

Wheel-mcp 是面向 **Codex、Cursor 及其他 MCP 客户端** 的 Godot 工具服务器。它把真实的 Godot 项目、运行时状态、日志、截图和可复现证据暴露给 AI，帮助开发者更快地定位问题、验证改动和迭代游戏。

**定位边界：** 客户端负责理解需求、规划和编写代码；本项目负责受控执行 Godot 操作、采集结果并报告证据。它不是自动生成整款游戏的 Agent，也不是官方 Godot、Codex 或 Cursor 产品。

[![Godot 4](https://img.shields.io/badge/Godot-4-blue)](https://godotengine.org/) [![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io/) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![Status](https://img.shields.io/badge/status-preview-orange)](#当前状态)

[快速开始](#快速开始) · [使用示例](#你可以这样使用) · [路线图](#主要路线图) · [参与贡献](#贡献)

如果它对你的 Godot 工作流有帮助，欢迎点一个 **Star**，也欢迎提交问题、测试报告和 PR。

## Token 与交互效率

**更少的工具往返，更精简的上下文。** 通过 7 个案例的测试实验，`dev_loop` 相比细粒度调用流程，载荷 Token 估算减少 **94.61%**，MCP 请求减少 **95.39%**。

![Wheel-mcp 测试对比：载荷 Token 估算与 MCP 请求次数](assets/benchmark-efficiency.zh-CN.svg)

使用 `responseMode: "compact"` 获取精简结果，用 `dev_loop` 将动作、断言和截图组织为一次验证调用。

统计口径：2026-09-13 的 7 个受控案例，以 JSON 字符数 ÷ 4 估算载荷 Token，不代表实际账单或运行加速。

[测试报告](docs/REPAIR-BENCHMARK-2026-09-13.md) · [复现步骤](benchmarks/README.md)

## 为什么值得试

- 搜索场景、脚本和资源，减少在大型项目中翻文件的时间。
- 读取真实运行时属性，发送输入和事件，辅助验证 2D 游戏行为。
- 捕获诊断、日志、截图和断言结果，而不是只返回“看起来成功”。
- 为 Codex/Cursor 提供稳定的工具边界，让 AI 修改后能够立即验证。

## 当前状态

版本：`0.1.0-preview.2`，仍处于预览阶段。真实引擎验证范围为 **Windows + Godot 4.7.2**；macOS/Linux 尚待验证。编辑器持久化、撤销与事务能力仍在路线图中。

## 快速开始

### 一键安装

先安装 Node.js **>=20.19.0** 和 Godot，再克隆仓库：

```bash
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm run go:global
```

全局安装也包含项目级配置。脚本自动安装依赖、编译并查找 Godot；修改已有 Codex 配置前自动备份，**无需手动备份**。

安装后重启客户端，调用 `get_godot_version` 验证连接。

- **Windows 快捷入口：** 双击 [install.cmd](install.cmd) 安装项目级配置；Codex 使用上表的全局命令。PowerShell 若拦截 npm，改用 `npm.cmd`。
- **未找到 Godot：** 在仓库 `.env` 中设置 `GODOT_PATH=你的Godot可执行文件绝对路径` 后重试。检测到 Godot 时安装器会更新该文件。
- **仅启动服务：** 安装后运行 `npm run mcp`，启动的是 MCP 服务，不是游戏。

### 手动安装与客户端配置

以下是不用一键脚本时的替代步骤。

#### 1. 安装并构建

```powershell
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm.cmd ci
npm.cmd run build
```

#### 2. 配置 Godot

设置 Godot 命令行路径：

```powershell
$env:GODOT_PATH = 'D:/tools/Godot_console.exe'
```

#### 3. 接入 MCP 客户端

<details><summary>Cursor</summary>

将以下内容合并到项目的 `.cursor/mcp.json`，替换路径并重载客户端：

```json
{
  "mcpServers": {
    "wheel-mcp": {
      "command": "node",
      "args": ["D:/tools/Wheel-mcp/build/src/mcp-server-sdk.js"],
      "env": { "GODOT_PATH": "D:/tools/Godot_console.exe" }
    }
  }
}
```

</details>

<details><summary>Codex</summary>

将以下内容合并到 `~/.codex/config.toml`，替换路径并重载客户端：

```toml
[mcp_servers.wheel-mcp]
command = "node"
args = ["D:/tools/Wheel-mcp/build/src/mcp-server-sdk.js"]

[mcp_servers.wheel-mcp.env]
GODOT_PATH = "D:/tools/Godot_console.exe"
```

</details>

所有示例路径均需替换为本机绝对路径。若客户端找不到 Node，请将 `command` 改为 Node 可执行文件的绝对路径。

先调用 `get_godot_version` 检查连接，再让客户端执行具体操作。安装脚本可能覆盖已有配置，请先备份。

## 你可以这样使用

- “检查这个场景的节点树，并说明 Camera2D 为什么没有生效。”
- “运行测试场景，发送输入，收集日志和截图；如果断言失败，给出证据。”
- “扫描最近修改的 GDScript，指出诊断错误，并提出最小修复。”

这些是客户端工作流示例，不代表所有客户端版本都已完成兼容性验证。

<details>
<summary>运行内置验证示例</summary>

在仓库根目录先导入测试项目：

```powershell
$env:GODOT_PATH = 'D:/tools/Godot_console.exe'
$repo = (Get-Location).Path
& $env:GODOT_PATH --headless --path "$repo/tests/fixtures/runtime-behavior" --editor --import
```

随后通过已连接的客户端调用 `dev_loop`，使用下列参数并替换仓库路径前缀。

下面的参数由 README 回归测试直接读取；它验证一个最小物理帧状态，而不是展示级 Demo：

```json
{
  "projectPath": "D:/games/Wheel-mcp/tests/fixtures/runtime-behavior",
  "bridgePath": "D:/games/Wheel-mcp/godot-plugin/runtime_bridge.gd",
  "evidenceDir": "D:/games/Wheel-mcp/runs/readme-smoke",
  "scenePath": "res://main.tscn",
  "actions": [{ "method": "wait_physics_frames", "params": { "frames": 12 } }],
  "checks": [
    {
      "id": "camera-enabled",
      "method": "get_property",
      "params": { "nodePath": "Camera2D", "property": "enabled" },
      "path": "value",
      "op": "equals",
      "expected": true
    }
  ],
  "screenshot": true,
  "maxRetries": 0,
  "timeoutMs": 30000,
  "responseMode": "compact"
}
```

预期结果：PASS、零诊断错误以及 320 × 180 截图。测试被跳过不等于真实引擎验证通过。

</details>

## 使用边界

- 运行时属性修改不等于保存编辑器场景；持久化与保存后重开验证仍需补齐。
- 持久会话与单次运行使用不同实例，不能假设状态共享。
- 仅运行可信项目。项目脚本能够执行代码，本服务器不是操作系统沙箱。
- 复杂 3D、动画和 Shader 工作流尚不能视为完整支持。

## 主要路线图

以下均为待完成的大方向，不是已交付能力承诺。详细验收标准见 [实施路线图](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md) 与 [任务状态](docs/production-roadmap/tasks.json)。

- [ ] **可靠执行层**：完善类型、错误、事件、超时和新代码生效验证。
- [ ] **编辑器原生能力**：支持场景/节点持久化、撤销、事务和安全保存。
- [ ] **更完整的 Godot 覆盖**：逐步覆盖 UI、3D、动画、材质、Shader 与物理工作流。
- [ ] **语义与上下文能力**：建立资源索引、结构化 Resources/Prompts 和可控上下文预算。
- [ ] **客户端兼容与证据链**：提升 Codex/Cursor 兼容性、固定操作链、补丁验证和回归报告。
- [ ] **生产运维与安全**：跨平台、安装升级、恢复、权限边界和长时间稳定性。

## 贡献

欢迎先提交 Issue 描述场景、Godot 版本、客户端版本和脱敏日志，再提交聚焦的 PR。引擎相关改动请附可复现测试；提交前运行：

```powershell
npm.cmd run check
```

欢迎贡献文档、翻译、真实客户端/平台测试和有授权的演示项目。引擎相关改动还需设置 `GODOT_PATH` 运行真实 Godot 测试，不能以跳过代替通过。

请不要提交密钥、私有项目内容或未经授权的游戏资源。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文档

- [工具目录](docs/TOOL-CATALOG.md)
- [开发循环](docs/DEV-LOOP.md)
- [客户端修复协议](docs/CLIENT-REPAIR.md)
- [生产路线图](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md)

## License

采用 [MIT](LICENSE) 许可。独立社区项目，与 Godot、OpenAI 或 Cursor 无官方隶属关系。

欢迎 Star、Fork 和 PR，一起把 Godot 的 AI 辅助开发做得更可靠。

## 项目网站（本地预览）

静态官网和浏览器游戏试玩厅位于 `docs/`。运行 `npm run site:serve`，
访问 `http://127.0.0.1:4173/Wheel-mcp/`；运行 `npm run site:test` 检查站内链接与游戏逻辑。
详见[网站部署与游戏接入说明](docs/WEBSITE.md)。
