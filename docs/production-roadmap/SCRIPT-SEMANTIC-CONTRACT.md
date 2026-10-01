# T22 GDScript 语义服务：当前声明边界

当前有三种**只读**分析/预览，均不能授权重构写入。

- `analyze_script_semantics` 是逐行正则摘要，响应明确为 `analysisLevel: heuristic`、`safeRefactor: false`。它不提供可靠语法错误、定义或引用。
- `query_script_semantics` 连接**已经手动启用并授权**的本地 Godot 4.7.2 编辑器。Windows 上核验私有 EditorBridge 授权、项目根、版本、进程身份及 LSP 环回监听端口归属；不安装插件、不启动用户项目、不接受任意进程的同名端口。只允许有界 `.gd` 文件的 `symbols`、`references`、`definition`、`diagnostics`；请求有超时、取消、帧与结果预算、源码 SHA 一致性检查。只读响应标记 `analysisLevel: godot-lsp`、`refactorSafe: false`。
- `preview_script_rename` 使用同样的已授权后端。先整体拒绝字符串/注释等非代码编辑，再逐代码位置要求唯一且一致的后端定义，并核对全项目前后快照。返回精确文件 SHA、候选替换内容、定义检查和人工影响清单；compact 模式也保留这些内容。`status: PASS` 仅表示预览检查通过，`refactorSafe: false` 始终保留；不申请审批、不写入、不替代隔离引擎或运行验证。

预览参数为 `projectPath`、项目内 `scriptPath`、已授权编辑器的 `lspPort`、从 0 开始的 `line`/`character`、`oldName`、`newName`；可选 `timeoutMs` 和 `responseMode`。名称限 ASCII GDScript 标识符。光标必须命中精确旧标识符，项目外脚本和名称不匹配拒绝。调用需要 read 权限，不需要也不授予 write 权限。候选中的 `operations` 不是审批票据，后续写入不得绕过项目新鲜度、精确审批、未保存编辑器文档保护和真实引擎验证。

已授权编辑器现在通过公开 `ScriptEditor.get_unsaved_files()` 报告 `dirty.scriptsStatus` 和 `dirty.scripts`，最多 100 项。接口不可用或超预算为 UNKNOWN；旧插件缺字段仍可只读查询，但写入/受检查的重构预览拒绝。任何未保存脚本均使项目候选冲突，因为未保存依赖也可能影响目标文件；不自动保存、关闭或重载用户缓冲区。受检查预览在请求前后检查状态；已验证文件写入在审批前和事务落盘前检查。原生脏场景保存豁免只影响场景保护，不能绕过脚本保护。

`write_validated_project_files` 可传入预览返回的 `projectSha256` 作为 `expectedProjectSha256`。项目不匹配在审批前拒绝；哈希写入服务器审批意图，连同确切文件差异绑定 planHash。审批期间的依赖变更及验证后的项目变更仍拒绝。该可选字段不支持 raw 模式，也不是批准凭证；返回 `projectInputSha256` 供核对。引擎校验仍是导入/解析/加载，不等于玩法验收。

`npm.cmd run verify:production -- --focused-script-safety` 仅执行 T22 定向回归，使用既有独立测试注册表及归属暂存清理机制，证据位于 `runs/production-roadmap/T22/`。结果明确标为 focused，不能替代完整 baseline 或任何资格 Gate。

真实 Godot 4.7.2 原生测试发现：LSP `references` 和 `rename` 会把与 `class_name` 同名的字符串、注释列入跨文件位置与 `WorkspaceEdit`；`definition` 也把这两类非代码文本指向类声明。同一文件的局部变量 rename 同样包含字符串和注释。因此**绝不能直接应用原始 WorkspaceEdit，也不能把逐位置 definition 的相同目标当作充分证明**。内部 `preflightGodotRename` 只把局部候选转换为项目内 `.gd` 文件的精确 SHA 事务候选，遇到字符串/注释、范围越界、重叠、非完整标识符、越权路径或超预算就整体拒绝；它本身不提交，也不证明所有同名代码位置都属于同一符号。隔离夹具中的无混淆局部变量候选经 MOCK 批准、原生引擎验证和事务提交，仅证明有限安全路径，不是公开 rename 工具。

另一个真实探针确认：不同函数中的同名局部变量，Godot 只返回所选函数的声明和使用位置；这种无混淆候选可以通过内部预检，但不等于所有项目的重构均可公开。隔离引擎拒绝语法损坏候选时原脚本字节保持不变。

内部 `reviewGodotRenameEdit` 新增**只读词法审阅**：对有界、项目内 `.gd` 的原始 WorkspaceEdit 逐项核对完整旧标识符、目标新标识符、范围、重叠与文件 SHA，并把代码位置列为候选、字符串和注释位置列为需人工审阅。纯非代码结果、越权路径和无效范围仍拒绝。返回值固定 `analysisLevel: lexical-review`、`refactorSafe: false`，不包含可提交文件内容或事务操作；它不证明代码候选之间的语义归属，也不允许“过滤非代码后自动写入”。原有 `preflightGodotRename` 的整体拒绝策略保持不变。

内部 `GodotLspClient.previewRename` 现从已授权会话请求后端 WorkspaceEdit，核对光标标识符、源脚本 SHA，再调用上述保守预检，返回 `refactorSafe: false` 的候选；字符串/注释误定位及预览期间磁盘变更均拒绝。它不注册为 MCP 写工具、不申请审批、不提交文件，也不把通过词法预检解释成逐位置语义证明。

内部 `GodotLspClient.reviewRename` 复用同一已授权会话、光标检查和请求前后源脚本 SHA 检查，但调用只读逐项审阅，因此可以展示被严格预检拒绝的非代码误定位。它仍不是公开 MCP 重构工具，不能从 `codeLocations` 直接生成获准写入；其他文件仅附各自读取时的 SHA，尚无全项目原子快照。

内部 `reviewRenameImpact` / `GodotLspClient.reviewRenameImpact` 在此基础上进行有界的**只读全项目影响扫描**：前后两次项目快照需相同，逐文件 SHA 必须吻合；`.gd` 中未被 LSP 编辑覆盖的同名代码、字符串和注释，以及 `.tscn/.tres` 内的同名文本都列为人工检查。对 `.tscn/.tres` 中明确为 `type="Script"` 的外部 `res://...gd` 声明，逐一核对项目内脚本路径；缺失或不支持的路径拒绝。扫描限制为 1000 文件 / 64 MiB，单个相关文本文件不超过 1 MiB，超限或中途变更就拒绝。场景文本命中只是风险线索；该有限路径核对不覆盖 UID、内嵌脚本、动态加载或 NodePath，前后快照也不是原子锁，不允许据此直接写入。

`GodotLspClient.previewDefinitionCheckedRename` 将严格词法预检、逐位置定义一致性和项目快照检查串接为上述只读候选。定义一致不是充分安全证明，仍保留严格非代码拒绝和人工清单。跨文件 class_name/extends/类型声明隔离案例由真实引擎导入、运行场景、读取结果 42 和显式 NodePath("Marker")，并用错误运行预期复现双文件原子回滚；审批是明确的 TEST-ONLY MOCK。这只证明该固定场景的路径保持，不是任意 NodePath 重写能力。

本轮把只读预览接入现有获准候选写入链路：官方 MCP 测试将后端候选和精确项目哈希送入 `write_validated_project_files`，错误哈希在审批前拒绝，正确哈希出现在审批请求中；真实引擎验证后提交，再运行场景确认跨文件类名/继承/类型声明、返回值 42 与 NodePath("Marker")。审批仍为隔离测试 MOCK。失败运行的原子回滚由同一 ProjectTransactions 实现及真实引擎 oracle 单独验证，不把文件工具的加载检查描述为自动玩法验收或自动玩法回滚。

声明支持的 NodePath 范围是**纯 GDScript 标识符候选对既有场景字节的保持**，不是路径重写：候选仅修改 `.gd`，显式外部 Script 声明需存在且保持，固定场景实例化后确认显式路径可解析。Node 名称/路径改名、UID 重写、内嵌脚本及任意动态反射并不因此获得自动重构资格；相关文本命中列为人工检查，不能过滤风险后自行增加编辑。`refactorSafe:false` 表示预览检查不是批准，后端不可用时也不从启发式摘要自动升级为“安全重构”。仅 Windows/Godot 4.7.2 隔离测试已验证。T22 在此声明范围完成，证据为 `evidence/T22-semantic-service.json`（全量 305/305、独立 Godot 109/109，零失败/跳过）；G4–G6 尚未通过，生产资格仍 `NOT_QUALIFIED`。
