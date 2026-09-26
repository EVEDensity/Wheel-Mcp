# T10 项目事务

`src/project/transactions.ts` 已接管 `ProjectEdits`、`dev_loop`、客户端修复、通用文本/场景写入及受限 Git 反向补丁；T10 最终验收结果以 `tasks.json` 为准，G2 仍需 T11–T15。此文记录可验证边界，不代表生产资格。

事务请求支持对现存文本文件替换/删除、在现存父目录创建新文件、重命名（内部拆为目标创建与源删除）。每批最多 16 个操作、单文件 8 MiB；`prepareExactEdits` 还可把多个精确查找/替换合并成同一文件的一个受输入 hash 约束的计划。`prepare` 检查目标、去重、输入 SHA-256 和路径策略，产出目标影响清单与有上限的前后文本预览；不改目标文件，但会把私有备份、stage 和 journal 写到项目 `.harness/transactions/<operationId>/`。重复 operation ID 以原始请求 hash 判断，即使已提交仍可幂等重放；同 ID 的不同内容拒绝。

调用方不能通过 `approved: true` 授权。只有服务端配置的 `verifyApproval(plan, signal)` 回调可把 PREPARED 转为 APPROVED；回执必须含 actor、receipt 和与操作集/目标/输入 hash 一致的 `planHash`。MCP 使用 SDK 的独立 `elicitation/create` 表单请求，展示完整前后文本、目标、输入/输出哈希和计划哈希；默认确认值为 false，只有 accept 且 confirm=true 可批准。客户端没有声明 form 能力、拒绝、取消、超时或预览超过 32 KiB 均拒绝写入。审批结束在锁内重读 journal，不能覆盖已经开始执行的状态。执行前及每个文件写前再检查输入，提交前检查输出；journal 的 planHash 会按内容重算，不能仅凭字符串相等批准被改过的清单。

这是一条**受信任客户端承载的人工确认渠道**，不是服务器能证明响应者是人的身份认证。真实 Godot 测试使用隔离 fixture 和显式 MOCK 表单响应，不能称为真人批准测试；客户端是否能正确显示表单及由人确认，仍需客户端版本矩阵验收。不支持表单的客户端没有自动绕过方式。直接库调用默认不配置审批回调，同样拒绝写入；测试批准只存在于 `tests/helpers/`，产品模块不导入。

## 兼容入口与迁移

等待人工审批期间不占用项目锁，但执行时会在同一项目锁内重新检查所有者无关的恢复屏障。即使计划早已批准，另一笔事务在此期间进入未收敛或 CONFLICT 状态，也不能绕过恢复流程去提交新写入；只读预览与已终结事务的幂等重放不执行新修改。

Journal schema v2 将由传输认证确定的 client owner 纳入请求/计划哈希。所有者不是工具参数，另一个客户端不能查询、批准、恢复或重放同一 operationId；即使知道全部补丁内容和输入哈希也不能借用旧批准。已完成的其他所有者记录不妨碍新的独立操作；其他所有者未收敛/冲突的记录会阻止写入，必须由原所有者或受监督的操作者先处理。早期开发阶段 schema v1 的实验 journal 不会被自动认领或覆盖；升级前需用生成它的开发版本恢复未收敛事务，保留备份，升级迁移留待 T34 验收。

- `ProjectEdits.apply()` 现在只在内存组合精确候选，内部写入必须经 `validate()`；旧的直接写入/内存备份路径已移除。每次候选验证单独生成完整计划并请求批准，持有磁盘项目锁直到运行时清理及 commit/rollback 完成。失败后先恢复原始文件，再基于上一候选的虚拟内容组合下一份修复；下一次批准展示的是原始文件到累计候选的变化，而非仅最后一个补丁。
- `dev_loop` 和客户端修复仍使用原验证条件、新鲜 Godot 进程和前后输入快照。含修改时 `rollbackOnFailure=false` 明确报 INVALID_ARGUMENT；没有修改的验证仍可使用该旧选项。原 `approved:true` 是兼容意图字段，不是写权限或批准回执。每次候选的 operationId、planHash 和最终状态返回在 `transactions`。
- `write_project_file` / `write_scene_file` 保留工具名及原参数，新增可选 `operationId` / `expectedSha256`。显式 operationId 必须搭配原输入 SHA-256，创建则传 null；重放不会重新批准或重新写入。同 ID 不同内容冲突。未提供 ID 的兼容调用会捕获当前输入并生成新 ID，不能把重复调用当作同一次事务。返回 saved/COMMITTED 只表示字节写入及读回，`validation: NOT_RUN` 明确表示未做 Godot 引擎合法性验证，D07 留待 T14。
- `git_recovery` 只支持最多 16 个普通 UTF-8 文本目标和 1 MiB 补丁，先在私有临时镜像执行 Git 反向补丁，再把创建/替换/删除转换为同一事务计划。不会直接在真实项目执行 `git apply`。二进制、符号链接、权限模式修改、复制或 Git 重命名补丁明确 UNSUPPORTED；独立事务核心的 rename 仍可用。临时镜像禁用全局 CRLF 转换，批准失败不修改目标，镜像在结束后清理。

MCP 会话关闭、stdio EOF/信号和 HTTP 会话结束先取消并等待正在执行的操作收敛，再清理资源或退出进程。它是协作式关闭；SIGKILL/强制进程终止无法执行清理，后续写入入口会先调用 `recoverPending()`。已有 CONFLICT 会阻止新写入，需要操作者保留用户版本并处理 journal，不会自动删掉冲突记录。可通过库的 `inspect/list/recover` 查询和恢复；当前尚无独立 CLI 事务管理命令。

准备与执行持有项目级跨进程锁：`APPROVED → APPLYING → VALIDATING → COMMITTED`；校验失败或协作式取消则 `ROLLING_BACK → ROLLED_BACK`，外部改动导致无法安全恢复时标 `CONFLICT` 并保留用户改动。每步使用同目录临时文件替换并持久记录进度，备份和 journal 尝试文件级 fsync。准备中断、尚未写 journal 时，保留原 staging 目录为 `.orphan-*` 供审计，不删除用户数据，并允许同 ID 重试。多文件 **不是文件系统原子提交**；Windows 目录项/电源故障持久性不能由当前 Node API 证明。服务进程死亡后只在验证锁拥有者 PID 和进程创建身份不再匹配时回收遗留锁；新进程的 `recoverPending()` 按 journal 与目标 hash 判断已应用、未应用或冲突，反序恢复，不盲目覆盖用户新编辑。校验回调必须协作响应传入的 AbortSignal；任意不响应取消的回调不受此保证。

专项测试覆盖准备/审批/幂等、旧输入冲突、并发提交、创建/删除/重命名、验证失败、第二文件 I/O 注入、Windows 实际只读文件替换失败、各持久执行/回滚检查点重启恢复、真实子进程强制终止、用户后续编辑冲突、journal 哈希损坏拒绝、SDK 确认拒绝与重放、真实 Godot 修复/渲染和验证期间 MCP 断连后的回滚。ENOSPC 可注入，不会把注入说成实际把用户磁盘填满；掉电和存储硬件持久性未验证。审计仅记录路径、哈希和状态，不将 repair source/find/replace 文本自动写入公共证据；事务私有 before/after 备份用于恢复，受本地可信项目边界约束。远程 HTTP 仍禁用。
