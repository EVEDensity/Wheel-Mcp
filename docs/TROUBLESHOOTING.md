# 常见问题与反馈 Troubleshooting

[文档中心 / Documentation](README.md) · [中文接入](GETTING-STARTED.zh-CN.md) · [English setup](GETTING-STARTED.md)

## 客户端没有 wheel-mcp 工具 Server missing

确认配置写入了正在使用的客户端与工作区，而不是另一个项目。
全局配置使用绝对路径；检查 Node、服务脚本和 Godot 文件均存在，构建完成后
重载 MCP 服务。查看该客户端的 MCP 启动错误，不要重复启动多个服务来碰运气。

Check the active client/workspace, absolute executable/script paths and completed
build. Reload the MCP server and inspect its startup error. Installer-generated
configuration does not guarantee discovery by every client version.

## 找不到 Godot Engine not found

将 `GODOT_PATH` 指向 Godot 可执行文件，不是文件夹；Windows 推荐使用 console
可执行文件。在客户端的服务环境中显式传值，不要假设终端环境会传入桌面客户端。
手动配置使用 `build/src/mcp-server-sdk.js` 时不会自动运行安装器。

Set `GODOT_PATH` to the executable, preferably the Windows console binary, in the
client's server environment. A terminal environment may not reach a desktop
client. The direct built entry does not run setup for you.

## FORBIDDEN 或项目不在允许范围 Access denied

检查 `MCP_STDIO_PROJECT_ROOTS`、`MCP_STDIO_EVIDENCE_ROOTS` 和
`MCP_STDIO_SCOPES`，多个根目录用英文分号分隔。只读配置不能运行或写入。
路径解析后仍须在允许范围内，junction/符号链接不能用于绕过检查。

Check explicit roots and scopes. Separate multiple roots with semicolons.
Read-only scope cannot run or write. Correct the narrow allowlist instead of
granting a whole drive or bypassing checks through links.

## 写入未批准或超时 Write approval failed

先确认客户端支持 MCP 表单审批，并在期限内操作。拒绝、取消或超时都不算批准。
不要通过重提请求、`approved: true` 或其他写文件方式绕过拒绝。
启用了精确本地预授权时，必须匹配对应清单，不能据此宣称真人审批已通过。

Confirm form elicitation support and respond before the deadline. Denial,
cancellation and timeout are not approval. Do not bypass them with retries,
`approved: true` or an alternative writer. Exact local preauthorization is a
separate policy and does not certify human approval UX.

## 为什么出现 Godot 窗口 Why a window opens

纯逻辑与状态检查使用 headless；同一任务复用运行时桥接的 `sessionId`。
截图需要渲染实例，headless 无截图帧缓冲。一次性截图与 `dev_loop` 截图默认
屏幕外启动并最小化窗口，仍可能出现任务栏图标。连续截图打开桥接时使用
`headless:false, background:true`，可见试玩才使用 `background:false`。
更新后重启 MCP；已打开的旧会话不会自动套用新窗口策略。显卡/系统错误弹窗
或项目代码在启动时主动切焦点，不属于这里的完全静默保证。
编辑器插件只连接已经打开且授权的编辑器。

Use headless for logic/state. Screenshots default to an off-screen startup and a
minimized render window; a taskbar entry may remain. For persistent screenshots
use `headless:false, background:true`; use `background:false` for a visible preview.
Restart the MCP server after updating; existing sessions keep their old policy.
OS/driver dialogs and startup focus changes requested by project code are not
fully suppressed. Editor tools connect to an already authorized editor.

## 展示页能玩是否代表 MCP 已连接 Website versus local service

不是。GitHub Pages 只托管静态页面；浏览器示意与小游戏不是远端 Godot 验证结果。
通过客户端调用 `get_godot_version` 和项目检查工具确认本机连接。

No. Pages is a static showcase, not a hosted MCP endpoint. Verify the local
connection through actual client tool calls, not browser demo animations.

## 该提交是否具有发布资格 Release versus main

v0.2.0 的验收记录绑定固定源码和发布包。main 的后续提交与短 CI 通过，不自动获得
完整生产资格。准备另一个发布版本时需重新执行对应门禁；不支持公网部署或其他平台
的稳定性承诺。详见[范围](LOCAL-STABLE-RELEASE.md)。

The v0.2.0 receipt binds to its frozen source/artifacts. Later main commits and
short CI do not inherit full release qualification. A new release needs its own
gate; public HTTP and other platforms are outside the accepted profile.

## 如何报告问题 Report an issue

普通问题使用 [GitHub Issues](https://github.com/EVEDensity/Wheel-Mcp/issues)，附：

- Wheel-mcp 标签或 commit、Windows / Node / Godot / 客户端版本。
- 最小复现步骤、工具名、脱敏参数、预期和实际结果。
- 错误码与必要的少量日志；删去密钥、用户名、私人路径和项目源码。

For ordinary bugs, include the tag/commit, environment, minimal steps, tool/error
names and a small sanitized log excerpt. Do not upload entire `.harness` or
`runs` directories. For vulnerabilities, follow [SECURITY.md](../SECURITY.md)
instead of posting exploit details or secrets publicly.
