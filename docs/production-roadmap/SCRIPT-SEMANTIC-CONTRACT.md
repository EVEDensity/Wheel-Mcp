# T22 GDScript 语义服务：当前声明边界

当前仅有两种**只读**分析，均不能授权重构写入。

- `analyze_script_semantics` 是逐行正则摘要，响应明确为 `analysisLevel: heuristic`、`safeRefactor: false`。它不提供可靠语法错误、定义或引用。
- `query_script_semantics` 连接**已经手动启用并授权**的本地 Godot 4.7.2 编辑器。Windows 上核验私有 EditorBridge 授权、项目根、版本、进程身份及 LSP 环回监听端口归属；不安装插件、不启动用户项目、不接受任意进程的同名端口。只允许有界 `.gd` 文件的 `symbols`、`references`、`definition`、`diagnostics`；请求有超时、取消、帧与结果预算、源码 SHA 一致性检查。只读响应标记 `analysisLevel: godot-lsp`、`refactorSafe: false`。

真实 Godot 4.7.2 原生测试发现：LSP `references` 和 `rename` 会把与 `class_name` 同名的字符串、注释列入跨文件位置与 `WorkspaceEdit`；`definition` 也把这两类非代码文本指向类声明。同一文件的局部变量 rename 同样包含字符串和注释。因此**绝不能直接应用原始 WorkspaceEdit，也不能把逐位置 definition 的相同目标当作充分证明**。内部 `preflightGodotRename` 只把局部候选转换为项目内 `.gd` 文件的精确 SHA 事务候选，遇到字符串/注释、范围越界、重叠、非完整标识符、越权路径或超预算就整体拒绝；它本身不提交，也不证明所有同名代码位置都属于同一符号。隔离夹具中的无混淆局部变量候选经 MOCK 批准、原生引擎验证和事务提交，仅证明有限安全路径，不是公开 rename 工具。

另一个真实探针确认：不同函数中的同名局部变量，Godot 只返回所选函数的声明和使用位置；这种无混淆候选可以通过内部预检，但不等于所有项目的重构均可公开。隔离引擎拒绝语法损坏候选时原脚本字节保持不变。

内部 `GodotLspClient.previewRename` 现从已授权会话请求后端 WorkspaceEdit，核对光标标识符、源脚本 SHA，再调用上述保守预检，返回 `refactorSafe: false` 的候选；字符串/注释误定位及预览期间磁盘变更均拒绝。它不注册为 MCP 写工具、不申请审批、不提交文件，也不把通过词法预检解释成逐位置语义证明。

动态引用、场景脚本路径、NodePath、逐位置定义归属、跨文件版本一致性和可靠语义重构尚未完成。后端不可用时不从启发式摘要自动升级为“安全重构”。仅 Windows/Godot 4.7.2 隔离测试已验证；T22 仍 `in_progress`，生产资格 `NOT_QUALIFIED`。
