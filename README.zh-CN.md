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

另可在配置真实 `GODOT_PATH` 后运行 `npm run benchmark:comparison`，复现 3 组交替顺序的逐次启动/持久 SDK 会话对照。记录端到端耗时、引擎启动、工具调用与序列化字节，保留每组结果；不测量实际 Token、账单或完整开发工作流，不能与上述历史估算混用。

## 为什么值得试

- 搜索场景、脚本和资源，减少在大型项目中翻文件的时间。
- 读取真实运行时属性，发送输入和事件，辅助验证 2D 游戏行为。
- 捕获诊断、日志、截图和断言结果，而不是只返回“看起来成功”。
- 为 Codex/Cursor 提供稳定的工具边界，让 AI 修改后能够立即验证。

## 当前状态

**当前是源码同步快照，尚未通过稳定版验收。** 最终推送前的门禁因超时未取得完整通过结果。
维护者已明确允许先同步源码，不创建稳定版 Release。此前通过记录仅属于各自记录的源码
哈希，不授予当前提交稳定资格。详见[当前源码状态](docs/releases/0.2.0-source-push.json)。

候选版本：`0.2.0`，目标为 **Windows + Godot 4.7.2、可信本地项目、stdio 的限域发布**。
当前源码必须实际通过 `npm run release:gate` 和 `npm run release:check` 才能接受发布，
版本号本身不是验收结果。详见[本机稳定版范围](docs/LOCAL-STABLE-RELEASE.md)。
长时间与高负载性能、线上 HTTP、其他平台/客户端及高级创作能力不属于此次稳定承诺。
自动化验收的审批为明确的测试替身，不代表真人桌面审批体验已认证。完整生产资格仍为
**NOT_QUALIFIED**，T31–T35/G4–G6 保留为后续工作，不标记完成。GitHub CI/CD 继续停用，
不会自动发布。

Godot 会以本机权限执行项目代码，后台无窗口不是安全沙箱。应显式限制项目与证据
目录，仅操作受信任项目。当前 HTTP 禁止非 loopback 监听。应用代码的 MIT 不自动
覆盖网站视频和复制的 UI 源码，整站再分发前请查看[第三方许可说明](THIRD-PARTY-NOTICES.md)。

可选编辑器通道读取已人工启用、私有授权的编辑器。独立 write opt-in 后，支持精确批准的 `apply_editor_scene`、有界资源、原生 Undo/Redo 和 `save_editor_scene`。文件候选先在隔离项目内经引擎校验再落盘；显式 raw 写入返回 NOT_RUN。原生保存保留脏标志和历史，不自动重载用户文档。T17 新增有界 UI 布局和平面主题，要求显式插件能力 `scene.ui/v1`；用户已于 2026-09-27 确认单独人工视觉验收通过。T18 新增有界 3D 物理查询与编辑。T19 新增有界动画片段、状态机与两源 Blend2，要求 `scene.animation/v1`。T20 新增受控 shader 文本/纹理混合与 VisualShader Color/Mix 图，要求 `scene.shader/v1`，并通过 Vulkan 真实像素验收；不支持任意 shader。T21 新增有界 PNG 导入、二进制精确事务，以及隔离项目中的 2D/3D 内容切片；后续源码改动不能沿用旧资格。支持类型有限，不代表完整创作或线上生产资格。见 [UI 边界](docs/production-roadmap/UI-AUTHORING-CONTRACT.md)、[3D 物理边界](docs/production-roadmap/PHYSICS-3D-CONTRACT.md)、[动画边界](docs/production-roadmap/ANIMATION-AUTHORING-CONTRACT.md)、[Shader 边界](docs/production-roadmap/SHADER-AUTHORING-CONTRACT.md)、[内容工作流边界](docs/production-roadmap/CONTENT-WORKFLOWS-CONTRACT.md)、[编辑器连接契约](docs/production-roadmap/EDITOR-BRIDGE-CONTRACT.md) 与 [保存/迁移契约](docs/production-roadmap/SAFE-SAVE-CONTRACT.md)。

`analyze_script_semantics` 明确为启发式摘要；`query_script_semantics` 仅从已授权本地 Godot 编辑器/LSP 读取有界的符号、引用、定义和诊断。原生 LSP 引用可能包含同名字符串与注释，两个工具都不能授权 rename。见[语义服务边界](docs/production-roadmap/SCRIPT-SEMANTIC-CONTRACT.md)。

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

### 后台运行，不反复弹出游戏窗口

MCP 的 `launch_project` 和 `open_runtime_bridge` 默认 `headless: true`，逻辑、
物理、输入和状态检查不显示游戏窗口。只打开一次运行时桥接，后续将返回的
`session_id` 作为 `sessionId` 传给 `call_runtime_bridge`，完成后再停止；不要每次
查询都重新打开。编辑器工具只连接已经授权的编辑器，不会自动另开编辑器。

需要试玩或真实渲染截图时，显式设置 `headless: false`。headless 没有可截图的
帧缓冲；`dev_loop` 在没有截图或截图基线需求时已自动后台运行，旧的一次性截图
工具仍会启动独立渲染进程。CLI/底层 API 的默认值不变，CLI 后台启动请使用
`--headless true`。

截至 2026-10-14，按维护者要求暂停 GitHub CI/CD：远端现有三个工作流均为
`disabled_manually`，暂停检查时没有运行中或排队任务。本地 `ci.yml` 只保留手动
触发入口，不再因 PR 或推送自动运行。开源后需明确重新启用远端工作流；如需
自动触发，再单独恢复 PR / push 配置。

保留的 Windows 工作流执行 `npm run check`，
只构建一次，检查格式/lint、MCP 通信、审批与事务安全以及展示页。依赖清单、
锁文件变化或无法确定改动范围时才做依赖审计；手动触发时也审计当前漏洞。
旧的排队运行自动取消。在 Actions 手动勾选 `engine`，才追加小规模后台 Godot
冒烟检查。没有自动三平台引擎矩阵、发布门禁、全量回归或长负载；失败诊断只
保留七天。CI 通过不代表发布资格。

日常开发使用 `npm run check`；完整回归显式使用 `npm run check:full` 或
`npm test`；小规模真实引擎检查使用 `npm run test:godot-ci`。发布准备留在本机，
`npm run release:gate -- --plan` 可查看去重后的步骤，不执行验证或发布。

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

- 运行时属性修改不等于保存编辑器场景。编辑器保存需独立授权与精确批准，仅支持声明的原生类型；保存后 Undo 的文档/磁盘冲突会阻止普通文件覆盖。
- 持久会话与单次运行使用不同实例，不能假设状态共享。
- 仅运行可信项目。项目脚本能够执行代码，本服务器不是操作系统沙箱。
- 复杂 3D、动画和 Shader 工作流尚不能视为完整支持。

## 主要路线图

以下按声明子集区分已验收与待完成方向，不代表完整能力或生产资格承诺。详细验收标准见 [实施路线图](docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md) 与 [任务状态](docs/production-roadmap/tasks.json)。

- [x] **受控可靠执行子集**：类型、错误、事件、生命周期、权限和新进程验证已验收；长时间与跨平台资格另行验证。
- [x] **受控编辑器原生子集**：场景/节点持久化、原生撤销、声明资源、事务和安全保存，含 20 轮同项目关闭重开验收。
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
