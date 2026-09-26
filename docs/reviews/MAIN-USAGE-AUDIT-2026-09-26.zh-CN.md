# 最新 main 与锈环使用证据分析

分析日期：2026-09-26，北京时间。范围为获取最新远端、核验历史证据、只读诊断与修改建议；未合并本地业务改动、未提交、未推送、未部署。

## 1. 版本状态：三份内容不能混为一谈

- 原工作目录：`C:/Users/temp-admin/Desktop/game/Wheel-mcp`。本地 main 的 HEAD 为 `fc7dcef311bc622f7f6fa38349d148e317d5b087`，大量未提交的路线实现已保留。
- 已成功执行 `git fetch origin main`。最新远端为 **`735b9eac84088867de65f33c9631f52fce91cd85`**，合并时间 2026-09-26 10:00:32 +08:00。相对本地 HEAD 新增 2 个提交，涉及 4 个文件，增加 132 行、删除 15 行。
- 独立检出：`C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp`。本次远端代码分析和新增隔离探针在此完成，不以原目录未提交代码冒充 main。
- 远端只与本地已修改的 `src/godot-runtime.ts` 发生路径重叠。因此没有直接把远端合进原目录；后续应在保留本地身份校验、会话回收等实现的同时，整合远端退出信号和停止意图。
- 使用包：`C:/Users/temp-admin/Desktop/锈环-wheel-mcp使用记录-2026-09-25/wheel-usage-audit-2026-09-25`。运行发生于 9 月 23–24 日，早于本次远端修复。包内没有 Wheel commit、包版本、源代码 hash，不能独立核实它对应哪一份代码；应视为**历史真实使用线索，而非最新 main 的验收报告**。

远端新增提交 `b2ce070` 修复进程证据，`735b9ea` 是其合并提交；没有把本地 T00–T12 的未提交实现纳入 main。

## 2. 使用包核验结果

读取 README、runs.json、整理脚本和原始证据，并重新计算 evidence-manifest 中 80 个文件的 SHA-256：**80/80 与记录的 copied_sha256 一致**，记录中的 original_sha256 也与 copied_sha256 相同。原 Mac 文件未在当前机器上独立核验，因此这证明副本与清单相符，不等于证明版本来源或结果真实性的全部环节。

共有 **20 条进程记录**，分为 8 类任务；不是 20 次 MCP 调用，也不是完整调用轨迹。日志记录 Godot `4.7.2.stable.official.ed1daf0bf`，来自 macOS / Apple M5。

- 14 条 `EXITED / 0`：13 条没有该包列出的警告或错误，1 条仍有缺贴图警告。不能称为 14 次游戏/美术验收通过。
- 6 条 `FAILED`：05、06 缺少 `king-rage/6` 姿势而触发 GDScript 断言；13 是 `bridge_collapse()` 参数数量不符等编译/运行错误；09、16 为房间资源覆盖未完成；03 只有启动日志，没有足够信息归因。
- 4 条失败记录没有退出码和信号。这不妨碍从 05、06、13 的日志判断脚本错误，但无法完整还原其后如何被结束。
- 20 份旧 `PROCESS_EVIDENCE` 清单均引用不存在的 request/response/events，合计 60 个引用。这与旧清单实现吻合；对于纯进程启动，这些文件并不必然应该生成，正确修复是按 profile 列真实产物，而不是补造 MCP 证据。
- 捕获脚本、实际截图/录像、完整游戏工程、MCP 原始请求响应未包含在本包，不能用这些日志完成逐帧视觉复核、原游戏重放或工具调用总量统计。

### 历史过程有价值，但能力归属要准确

记录 07 的脚本报告覆盖缝合王三阶段与之前缺失姿势；20 的日志报告 30 个房间 painted/screenshot_ok 均为 true；10 报告 16 种武器组合、8 个瞄准方向和 301 帧；14、19 报告 17 类敌人机制 complete=true。可见这是一次“发现问题—改脚本/资源—再运行”的真实工作流。

但进入房间、机制触发、截图与姿势检查是捕获 GDScript 的工作，渲染来自 Godot，视觉判断需要代理或人看图。Wheel 在该包可直接证明的价值主要是**组织启动与保存进程/日志证据**，不能把游戏脚本或人工检查的能力全部归给 MCP。

### 不应从这里推出效率提升

20 条记录的开始到结束观测时差总计约 113.97 分钟。4 条无退出码记录占约 106.73 分钟，即 93.65%。这只是观测时差，可能包含等待、挂起和收集延迟，不能据此认定工具耗时或声称可节省 93.65%。没有同任务 CLI 对照、模型用量和思考时间，不能推出 Token、速度或费用提升。

`build_report.py` 写死 Mac 路径，写报告和压缩包，并非可直接在 Windows 运行的只读核验器；README 的 14/6 数量也是脚本内固定文本。其脱敏仅识别部分 `sk-...` 字符串，不能当通用敏感信息清理器。本次未运行该脚本，未修改审计包。

## 3. 最新 main 已经解决什么

1. `src/evidence.ts` 按 PROCESS/BRIDGE 分离清单字段，纯进程清单不再虚列 request/response/events。
2. `src/godot-runtime.ts` 的 launch 关闭处理保存 Node 提供的 `signal`，并记录同进程发出的 STOPPED/CANCELLED 意图，避免统一覆盖成 FAILED。
3. `schemas/process-result.schema.json` 增加可空 signal 字段。
4. 新增 5 个测试，但其中 4 个使用 POSIX shell 假进程，Windows 会跳过。

这些改动方向正确，建议保留并整合，不重新实现一套相同补丁。历史包不会因为当前修复而自动获得当时丢失的信号，不应回填未知值。

## 4. 本次验证与仍然存在的缺口

独立检出的 build、format:check、lint 均通过。仓库新增测试结果为 **1 PASS、0 FAIL、4 SKIP**，不是 5 个 Windows 测试通过。本次未运行完整发布门禁，也没有重跑锈环原工程。

另用真实 Windows Godot 4.7.2 创建隔离测试项目，验证 5 个进程场景：退出 0、退出 7、主动 stop、cancel、外部 SIGKILL，均通过预期断言。Windows 的 taskkill 场景观测到 exit_code=1、signal=null，而外部 child.kill 场景为 exit_code=null、signal=SIGKILL；所以不要用“signal 必须非空”替代跨平台终态规则。

探针与结果：[probe.mjs](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/runs/usage-audit-2026-09-26/probe.mjs)、[probe-results.json](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/runs/usage-audit-2026-09-26/probe-results.json)。仅操作本次生成的隔离进程，不操作用户游戏、服务或全局客户端配置。

### P0：HTTP 原始 RPC 的方法级权限仍缺失于远端

远端 [access-policy.ts](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/src/mcp/access-policy.ts:51) 把 `call_runtime_bridge` 整体当作 run 权限，没有按里面的 method 限制写入。只读政策探针确认：拥有该会话、只有 run 权限的策略仍接受 `delete_node` 参数；未实际发送 RPC 或删除节点。

这不是由锈环 6 条失败记录推断的原因，而是另行代码检查发现的上线阻碍。本地 T08 已有对应收紧，必须整合并重新验证，不能说当前远端已包含它。公网运行前还必须核验路径、所有权、取消和租户隔离；TLS/鉴权不能代替方法授权。

### P1：桥接失败时，恰好丢失最需要的证据

远端 [queryRuntimeSceneTree](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/src/godot-runtime.ts:447) 先 `ensureProcessSuccess(result)`，之后才 `finalizeBridgeEvidence`。隔离探针让 Godot 退出 7，复现目录中只有 manifest/request，没有 process、stdout、stderr、response、events。其它同类一次性工具也采用相同顺序。

另有 [runProcess](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/src/godot-runtime.ts:764) 在非 OK 时主动把真实 exitCode 清成 null，并且不接收 close 的 signal。本次退出信号补丁只覆盖 launch 路径，不能理解为所有 Godot 执行路径均已修复。

### P1：长运行可观测性不足

[launchProject](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/src/godot-runtime.ts:323) 在内存积累输出，等 close 才写 stdout/stderr；MCP 自身异常结束可能丢输出，运行中也不能可靠读取已产生的日志。engine log 又使用项目共用 `.harness/godot.log`，存在并发串扰风险。

本地已有长会话分页等增量，但当前本地 launch 仍需核查实时落盘，不应把“支持分页”当作“可靠持续写日志”。

### P1：诊断可见错误，却不能定位 Mac 捕获脚本

[诊断位置正则](C:/Users/temp-admin/.codex/worktrees/main-usage-audit/Wheel-mcp/src/godot-development.ts:348) 支持 res:// 与 Windows 盘符，未支持 POSIX 绝对路径。用原始 evidence/05 调用远端诊断函数，结果含断言消息，但 stack=[] 且缺 file/line；原日志明确写有 `/Users/.../runtime/live.gd:65`。

这是把“错误可读”转为“代理可直接修复”的关键障碍。历史 Mac 证据可以成为解析回归样例，不代表本次已验证 Mac 运行平台。

### P1：进程成功与任务成功仍需分层

evidence/12 同时退出 0、输出 STATION_CAPTURE，但 stderr 缺 wall-organic.png。09、16 则截图成功但 painted=false。建议分离 process、engine diagnostics、scenario assertions、artifact checks、visual review；未执行的验证明确 NOT_RUN，不默认 PASS。不因普通警告一刀切判失败，由场景定义必需资产和警告策略。

### P1/P2：固定版本验收、Windows CI 与报告复现

本次 5 个真实进程探针有效，但未进入 CI。应将其转成必需平台测试；增加桥接非零退出、超时、错误路径、停止竞争、服务重启后的身份校验，覆盖失败时的落盘保证。清单还应记录 Wheel 版本/commit/sourceHash、Godot 版本、项目与捕获脚本 hash，并保持真实缺失值，避免下次又无法绑定证据与代码。

## 5. 建议执行顺序与每一步的回头自查

### 第一步：安全整合最新版 main 与本地已验证实现

保留现有工作，准备可回退的整合版本；重点处理 godot-runtime.ts 的远端 signal/终止意图与本地身份校验、会话回收的重叠。保留远端新测试，并使 Windows 也能实测。不要把原目录整份覆盖到远端检出。

验收：相关差异逐项复核；build/format/lint、进程证据、会话隔离、取消回收与缺陷回放通过；为整合后的准确 sourceHash 重跑基线。旧 hash 的 PASS 不自动继承。

### 第二步：先关闭线上权限风险，再闭合失败证据

整合 T08 方法级授权、未知方法拒绝和 owner 隔离；之后统一 launch/一次性 bridge/持久 bridge 的退出记录与 finally 落盘。保留真实 exit_code、signal 与终止原因；失败时保留请求、实际日志、进程结果，将未生成产物明确标为缺失，不伪造成功响应或事件。

验收：run-only 的原始写 RPC 被拒绝；退出 7、外部 kill、超时、取消、启动失败、响应未生成均有可解析证据与一致终态；仅列已存在或明确状态的产物；不会把 STOPPED/CANCELLED 改成 FAILED。

### 第三步：缩短“发现失败到下一次有效运行”的距离

支持有界实时日志、每 run 独立 engine log、增量游标、可选 heartbeat/任务截止时间；支持 POSIX/res:// /Windows 诊断位置。将使用包中 05/06/12/13 的错误格式与房间覆盖结果提炼成脱敏回归 fixture，不把用户游戏或 Mac 私有路径硬编码进产品。

验收：运行中可查输出；断言能定位 live.gd:65；编译错误能定位 game_view.gd:803；服务异常后保留已写日志；并发日志不会互相覆盖；资源失败给出缺失项而非只有 FAILED。

### 第四步：把常用捕获任务变成明确的验证工作流

优先复用现有场景执行/验证入口，而非先增加大量工具。让捕获脚本输出结构化 result 与必要资产列表；Wheel 负责安全调度、引擎诊断、assertion/产物检查、结果归档。截图文件存在、可解码与哈希校验和视觉判断分开，测试专用血量/帧数/触发条件明确披露。

验收：同一任务可重复执行；坏脚本、缺贴图、覆盖不足、成功四类结果可区分；退出 0 不遮盖关键校验失败；图像未人工/视觉审查时明确 NOT_RUN。

### 第五步：继续原有 T12–T15，而不是重新从 T00 开始

本地 tasks.json 为 12 done、T12 in_progress、23 todo；远端仍是 36 todo，且没有当前本地实现。本地 T12 是内部场景操作核心，尚无正式 MCP 写入口、受控实例化与完整批准/断连结果查询，不能宣称完成。

随后继续 T13 资源持久化、T14 引擎校验与安全保存、T15 编辑—撤销—保存—重开；每次小步核对代码、真实读回、权限边界、sourceHash 与证据。不要只依赖任务状态文本或历史测试数量。

验收：经真实 MCP 授权入口执行，不依靠测试控制器；拒绝/并发冲突/断连/未知结果正确处理；owner、Undo/Redo、保存后重开与资源依赖由真实 Godot 验证。

### 第六步：再进行限定范围发布与效率评估

先提供本地开发者 preview；线上版本必须额外通过权限、隔离、长时间运行、故障注入、干净安装与运维门禁。此次 Mac 使用日志不能直接扩展当前 Windows 发布支持范围。

效率比较固定同一工程、任务、环境、版本和验收标准，比较 Wheel 与 CLI 的重复结果、失败恢复时间、实际调用数、输出量；能获取模型真实用量再记录 tokens，否则标不可得。不得用日志时差或 JSON 字符数代替费用/模型耗时。

## 6. 总体判断

**项目已有真实使用价值，最新 main 的修复值得吸收，但当前最需要补的是“权限安全、失败证据闭合、可直接定位的问题反馈”，不是继续增加展示页效果或工具数量。**

最新 main 可用于受控本地 preview；本次证据不足以认定可作为公网/多租户生产版本。当前本地资格仍为 NOT_QUALIFIED，G2–G6 NOT_RUN；本地历史 229 测试/47 smoke 的结果不能当作这次整合版本的新验收。

本次没有修改用户审计包、现有业务代码或任务状态。新增内容仅为这份分析报告、独立检出的忽略目录探针及单独 Canvas 分析文件。
