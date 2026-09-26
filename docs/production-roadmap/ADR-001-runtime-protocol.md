# ADR-001：运行时桥接与错误契约

状态：T02 实施中（2026-09-25）。此 ADR 约束新会话；公开 MCP 工具名称和已存在的成功业务字段保持兼容。

## 协议边界

- MCP 仍使用官方 SDK 协商的协议；Godot TCP 桥接另用 `wheel-runtime/1`，不可混为一谈。
- Godot `runtime/ready` 必须声明桥接协议版本、bridge 版本、Godot 精确版本、`runtime` plane、项目标识、run ID 和已实现能力。Node 启动端验证这些字段，不匹配则拒绝会话，不能把 TCP 连通视为功能就绪。
- JSON-RPC 响应必须有 `jsonrpc: "2.0"`、匹配的数字 ID，以及恰好一个 `result` 或 `error`。业务方法按方法校验必要字段；未知形状返回 `PROTOCOL_MISMATCH`，不得作为空成功。
- 现有成功包装的 `schema_version: "0.1"` 暂保留；新增字段只能增量附加。需要改变旧字段含义时另开版本，不静默重解释。
- 桥接调用注明 `lifetime: persistent`；one-shot 工具在后续 T07 明确生命周期。G0 的 10 个 `EXPECTED_DEFECT` 不因包装兼容而被抹除。

## 错误映射

公共失败体：`status: FAIL`、稳定 `code`、`message`、`retryable`、`timed_out`、`details`；MCP 设置 `isError: true`，CLI 在 stderr 输出同一失败体并以非零退出。可用码：`INVALID_ARGUMENT`、`NOT_FOUND`、`UNSUPPORTED`、`FORBIDDEN`、`CONFLICT`、`ENGINE_UNAVAILABLE`、`PROTOCOL_MISMATCH`、`VALIDATION_FAILED`、`TIMEOUT`、`CANCELLED`、`INTERNAL_ERROR`。历史 `FAILED` 保留作无法细分的兼容兜底，不给已知错误使用。

桥接以 JSON-RPC 数字码表达类别：`-32602` 参数错误、`-32601` 不支持的方法、`-32004` 未找到对象、`-32009` 冲突、`-32050` 运行时不可用。Node 依据数字码映射，不通过错误文本猜测；原始数字码、方法、session ID 与节点参数作为 `details` 保留。断链、缺少字段或协议不匹配分别归类，不把异常结果包装成成功。

成功空集只在能力已支持、对象有效且业务确实为空时成立；不支持的节点族返回 `UNSUPPORTED`。T18 扩充 3D 专用能力前，不能把空 `camera` 字段解释为已验证的 Camera3D 状态。`compact` 必须在错误判断之后执行，且不能改变业务成功/失败语义；具体预算与投影规则由 T05 定义。

## 验证与回退

T02 用真实 Godot + 官方 SDK stdio 校验缺失节点、属性、断开的会话和非法响应；相同失败路径对比 CLI/MCP 稳定码。版本不匹配必须拒绝握手。发布前保留 G0 可重放证据；若新握手破坏已支持引擎，应回退候选代码而不是静默降级。
