# T08 工具、RPC 与会话授权边界

## 权限模型

- 当前 60 个已注册 MCP 工具逐一声明 `read`、`run`、`write` 或 `admin`；未分类工具即使持有 `admin` 也拒绝。注册清单与分类清单由测试比较。T11 新增 `get_editor_state` 属于 project/read，还需私有编辑器配置明确授权传输身份；工具参数不能指定或覆盖 token/owner。见 `EDITOR-BRIDGE-CONTRACT.md`。
- `call_runtime_bridge` 再按 RPC 方法分类。读取方法可用 `read`；订阅与停止需要 `run`；`call_method`、属性/节点更改、输入、场景重载、截图与推进帧需要同时有 `run` 和 `write`。未知方法拒绝。
- 会启动项目脚本的 one-shot 查询额外需要 `run`。客户端自选的非空 `extraArgs` 不被接受。
- `admin` 可执行管理动作，但不能跳过路径、桥接截图输出、可执行文件或脚本入口边界。

## HTTP 客户端

每个 bearer token 配置 `clientId`、权限、`projectRoots`、`evidenceRoots`。执行 Godot 时还须配置 `approvedGodotPaths`；使用桥接时须配置 `approvedBridgePaths`。两项路径均须指向现存的确切文件。单 token 环境变量模式支持 `MCP_HTTP_APPROVED_GODOT_PATHS` 和 `MCP_HTTP_APPROVED_BRIDGE_PATHS`，逗号分隔。缺少批准列表时，相应执行能力默认拒绝。

HTTP MCP 会话绑定其 token 的 `clientId`。run ID、PID、桥接 session ID、订阅 ID 均检查归属；run 与订阅列表过滤其他客户端对象。订阅记录持久保存 `owner_client_id`，同一客户端重新建立 MCP 会话后可继续轮询或 ACK，另一客户端即使知道 ID 也不能操作。客户端修复 ticket 由每个 MCP server/session 独立的协调器保存，不可跨 session 提交。

## 本地 stdio

stdio 默认权限为 `read,run,write`，不含 `admin`；默认项目与证据根为启动目录及系统临时目录，而非整个文件系统。部署时应通过 `MCP_STDIO_PROJECT_ROOTS`、`MCP_STDIO_EVIDENCE_ROOTS` 缩小至实际项目与证据目录；多个路径用分号分隔。`MCP_STDIO_SCOPES` 可进一步收紧权限。

Godot 执行文件取 `MCP_STDIO_APPROVED_GODOT_PATHS`，否则取启动环境 `GODOT_PATH`，再否则取本包 `.env` 中的 `GODOT_PATH`；均不存在时执行工具拒绝。桥接脚本默认须与随包 `runtime_bridge.gd` 的 SHA-256 一致；可通过 `MCP_STDIO_APPROVED_BRIDGE_PATHS` 或 `MCP_STDIO_APPROVED_BRIDGE_HASHES` 明确批准其他脚本。stdio 客户端若自行启动 server，SDK 默认只继承有限环境变量，需在 transport 配置中显式传递这些变量。

## 路径与残余风险

顶层项目/证据路径、截图与对比输出、桥接截图 `params.path`、嵌套场景项目路径和修复编辑路径均做边界校验；现存父目录的真实路径用于拒绝符号链接或 Windows junction 越界。桥接截图还必须位于该桥接 session 的证据目录内。相对场景路径仅用于静态场景工具，运行时场景路径必须是受限 `res://` 路径。

这不是操作系统沙箱。获准同时持有 `run` 与 `write` 的客户端可以通过 `call_method` 运行项目代码；不应把不可信客户端授予这两个权限。共享或重叠的 `evidenceRoots` 允许读取同一目录的原始证据，部署时应分别配置。T09 的项目文件路径策略见 `PATH-POLICY.md`；路径检查与使用之间仍有竞态，远程绑定被禁用，远程生产资格仍未取得。
