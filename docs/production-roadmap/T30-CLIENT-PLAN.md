# T30 实际客户端与传输验收

状态：进行中，不是生产兼容性承诺。T29 的 30 条固定案例已完成；T30 stdio 与实际客户端分别记录，不相互替代。

2026-10-09范围更新：用户要求暂不考虑Cursor、只验收本机Codex，见 ADR-2026-10-09-LOCAL-CODEX.md。下方Cursor记录为历史观察，保留但不再作为本轮required；不得以SDK或范围变更把失败改成成功。当前源核心stdio重放和已安装Codex原生接口仍按原oracle验收，通过后才关闭T30。

本轮支持范围冻结为临时矩阵 evidence/T30-client-support-matrix.json，缺少Cursor实际操作及当前源码完整验收时保持 PROVISIONAL_NOT_QUALIFIED。用户已确认全局启动修复成功；隔离四步与审批不是由该口头确认替代。源d2fa01e1的已安装Codex探针再次通过，原生创建/保存/验证/独立读回完成，临时夹具已清理；依然无模型回合、无永久配置修改，审批为明确MOCK。

## 已完成的小步

- 官方 SDK 子进程 stdio 重放：首轮旧源码双轮 42/42，31 份案例记录包含 30 核心例和 X01；S05 实际已走 stdio，但标签遗漏，已修正并对新源码重验。资源/提示词既有补充单测仍包含内存/HTTP，不能统称全为 stdio。
- 新增 stdio 协议测试：Tools/Resources/Prompts 发现和读取、schema/business/permission 错误、旧资源身份拒绝、关闭重连、派发前取消。单独 4/4 通过；schema 错误按实际 `isError` + `MCP error -32602` 验证，不误认为必须抛异常。
- stdio 客户端不再静态导入本机 server/policy 模块；此前直接单测在连接前触发旧全局 registry 锁故障。只给子进程传测试根、许可、引擎/桥路径和独立登记，不接触用户登记，也不宣称 T31 旧锁已修复。
- Codex CLI 0.160.1 的真实 app-server 接口：71 工具/5 资源发现、读取、只读写入拒绝；代表性原生 create/save/validation/字节读回通过。使用临时会话和命令行配置覆盖；没有模型回合、登录、永久配置改动或实际项目修改。两次确认是严格限制在临时计划的 MOCK host，不是桌面人工 UI 录像。
- Codex 探针为 `node scripts/probe-codex-client.mjs`，需先构建并设置 GODOT_PATH。`approvalPolicy=never` 的初次试验安全拒绝；`on-request` 保留审批流程后通过，未弱化服务器校验。成功后只清除此探针新建且已停止的独立临时根，不删除被宿主策略拦截的历史目录。

## Cursor 尚待真实执行

最新回查见 evidence/T30-approval-timeout-checkpoint.json：真实Cursor已初始化、发现71工具、完成项目/脚本读取并发起dev_loop，不再是完全NOT_RUN。但审批等待耗尽20秒，未写入，清理成功，客户端decline在取消后才到达；人工表单可见性及是否主动拒绝尚待用户说明。服务器本地超时被SDK包装为FAILED的分类问题已在新源ff05b51f修复并双44/44定向回查；此前d2fa源全量408/408+独立110/110完整通过，不继承到新源。原失败及20秒预算保留，不自动重试写入或放宽.harness访问。

用户提供的真实Cursor日志定位到全局 user-wheel-mcp 初始化因registry旧主锁+旧空恢复guard退出；已在源d2fa01e1修复恢复guard归属/过期恢复，并正式双43/43回查，原registry SDK启动发现71工具成功，3917条记录保留。见 evidence/T30-cursor-startup-lock-fix.json。这里只修复了旧锁启动子问题，不代表T31完整锁/故障/长时间资格，也不能解释项目级wheel_t30为何缺席。Cursor原生重连与实际四步仍需单独验收。

已确认桌面 Cursor 3.23.23。当前 CLI 未提供可核验的已安装独立 agent 二进制；`cursor agent --help` 仍返回桌面通用帮助，不能作为 MCP 发现/调用成功证据。当前自动化不提供原生界面控制，未安装额外客户端，也未自动登录。

准备目录：`C:/Users/temp-admin/AppData/Local/Temp/wheel-t30-cursor-20261006`，不在实际 Git 项目中。目录有固定初始 main.gd（health=42）、场景、项目级 `.cursor/mcp.json` 和 `CURSOR-TEST.txt`。仅允许 MCP 将 health 改为 100，通过冻结检查、精确批准、原生验证和读回；不许模型改用 shell/直接文件编辑或自动重提未知写操作。

字节透传记录器只保存方法、工具、参数/响应摘要 SHA、状态及确认结果，10MiB 硬上限；不保存账户/API 密钥，不将环境凭据转发给被测服务。`proxy-selftest.jsonl` 的 SDK 自测与真实 `client-trace.jsonl` 分开，自测不计为 Cursor 通过。完成后需要实际工具记录与批准结果，核查原生证据及 main.gd 新哈希 `04c6feec2ce1fbf5feb65a5e1acb5158a3355cec8b4535e86fa44150eaa590af`。

## 完成前仍需回查

- 最新源 d6b177d3 定向双轮 46/46、31 例 oracle/stdio transport 与69项哈希已回查一致，见 evidence/T30-client-checkpoint.json；不可继承旧源码全量结果。
- 真实 Cursor 的配置、发现和代表性操作。缺证据标 NOT_RUN，而不是 SDK 代测通过。
- 等待精确审批时的在途取消、请求超时和断开，以及 loopback HTTP 安全对照已双轮22/22（新源0ec48114），见 evidence/T30-transport-checkpoint.json。审批为延迟后拒绝的 MOCK；不证明提交后取消或任意不合作工作终止，不代表公网HTTP兼容。
- 支持边界：SDK stdio/本机 HTTP 的已列契约通过；已安装 Codex CLI 0.160.1 原生接口代表性操作在旧源 d6b177d3 上通过，非桌面真人审批；Cursor 3.23.23 只有安装与隔离配置核对，真实操作尚未验收。完整支持矩阵须待 Cursor 结果和同源回归后冻结。
- 当前源码全量及 G4/G5/G6 分开；T31 的 8 小时/1000 循环不能用短测替代。

参考官方接口：[OpenAI MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Cursor MCP](https://cursor.com/docs)。兼容范围以实测安装版本为准，不依赖滚动文档的“最新”描述。
