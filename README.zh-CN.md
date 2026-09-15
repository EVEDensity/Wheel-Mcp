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

![Wheel-mcp 测试对比：载荷 Token 估算与 MCP 请求次数](assets/benchmark-efficiency.svg)

使用 `responseMode: "compact"` 获取精简结果，用 `dev_loop` 将动作、断言和截图组织为一次验证调用。

<details>
<summary>测试说明与复现</summary>

数据来自 2026-09-13 的 7 个受控案例，对比本项目的细粒度流程与 compact dev_loop：152 → 7 次请求，84,777 → 4,566 载荷 Token 估算值。估算采用序列化 JSON 字符数 ÷ 4，并非实际计费 Token；不含工具发现、Prompt、历史对话和推理，且客户端可能只使用文本或 structuredContent 中的一种表示。案例使用调用方提供的固定修复，并用于校准，不能外推为自主修复成功率。仅运行期诊断参与判定；平均自动运行耗时为 3.82 → 4.06 秒，未证明运行加速。本次引用历史记录，未重跑基准。

[完整报告](docs/REPAIR-BENCHMARK-2026-09-13.md) · [原始汇总](benchmarks/repair-results-2026-09-13.json) · [复现步骤](benchmarks/README.md)

</details>

## 为什么值得试

- 搜索场景、脚本和资源，减少在大型项目中翻文件的时间。
- 读取真实运行时属性，发送输入和事件，辅助验证 2D 游戏行为。
- 捕获诊断、日志、截图和断言结果，而不是只返回“看起来成功”。
- 为 Codex/Cursor 提供稳定的工具边界，让 AI 修改后能够立即验证。

## 当前状态

版本：`0.1.0-preview.2`。当前公开验证范围为 **Windows + Godot 4.7.2**；Linux/macOS 尚未完成真实引擎验证。需要 Node.js `>=20.19.0`，同时满足所安装开发工具链的版本要求。当前仍是预览版，不代表已达到生产级可用度。运行时修改不等于编辑器中的持久化 `.tscn` 保存；编辑器原生编辑、撤销和事务能力仍在路线图中。

## 快速开始

### 推荐：一键安装

先安装 Node.js **>=20.19.0** 和 Godot。克隆仓库后执行：

```powershell
git clone https://github.com/EVEDensity/Wheel-mcp.git
cd Wheel-mcp
npm run go
```

**Windows 也可以下载并解压仓库后，双击根目录的 [install.cmd](install.cmd)。** PowerShell 中可运行 `.\install.cmd`；若 npm 被执行策略拦截，可使用 `npm.cmd run go`。

脚本会安装依赖、编译、尝试发现 Godot，并写入当前仓库的 Cursor / VS Code MCP 配置。完成后用客户端打开此文件夹，启用并重载 wheel-mcp，调用 `get_godot_version` 验证。

- **已有配置请先备份：** 一键安装使用强制更新模式，会更新对应 MCP 配置项；检测到 Godot 时也会重写本仓库的 `.env`。
- 未发现 Godot 时，在仓库 `.env` 中设置 `GODOT_PATH=D:/tools/Godot_console.exe` 后重新运行一键安装；脚本不会安装 Godot 本身。
- 自动配置针对本仓库；用于其他游戏工作区或 Codex 时，请按下方示例合并配置。

<details>
<summary>其他启动入口</summary>

| 指令                       | 用途                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `npm run go:global`        | 配置 Codex、全局 Cursor、Claude Desktop 和 Windsurf（请先备份） |
| `node scripts/install.mjs` | 直接运行同一个一键安装脚本                                      |
| `npm run mcp`              | 安装后启动 stdio MCP 服务，供客户端连接；不是启动游戏           |

</details>

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
