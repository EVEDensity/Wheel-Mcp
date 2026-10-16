# T11 受控编辑器连接契约

本阶段只提供 `get_editor_state`，不修改场景、资源或插件列表。`PASS` 代表成功读取编辑器状态，不代表保存、游戏行为验证或生产发布资格。返回明确包含 `plane:editor`、`runtime:false`、`persisted:false`、`validation:NOT_RUN`。

## 人工接入与授权

1. 经项目所有者同意，将本包 `godot-plugin/addons/wheel_mcp` 复制到目标项目的 `addons/wheel_mcp`；检查来源。不要覆盖已有同名插件。安装脚本不会自动安装或启用此插件。
2. 在项目根下创建普通目录 `.harness`，添加私有的 `editor-bridge.json`。不要提交配置、令牌、生成的端点或租约；将 `.harness/` 加入该项目的忽略规则，并用操作系统权限限制访问。Node 连接器拒绝链接目录、链接文件、硬链接文件和超出 8 KiB 的配置/端点。
3. 配置样例如下。`projectPath` 必须是项目根的绝对真实路径；`projectId` 是 1–80 字符的项目标识；`port:0` 由操作系统分配临时 loopback 端口。每个令牌必须是密码学随机的 32 字节、小写十六进制编码；下列占位符不能直接使用。

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "authorized": true,
  "protocolVersion": "wheel-editor/1",
  "projectId": "my-game",
  "projectPath": "C:/projects/my-game",
  "port": 0,
  "clients": {
    "stdio-local": "REPLACE_WITH_64_RANDOM_HEX_CHARACTERS"
  }
}
```

`stdio-local` 是当前正式 stdio 入口固定的传输身份；HTTP 身份由服务器受信任 token 配置的 `clientId` 决定。在私有配置中只列出允许读取此编辑器的身份，不能让模型通过工具参数选择身份。测试内部无 policy 的 SDK server 使用 `local-client`，不是正式部署身份。所有获准 editor 连接者在 T11 都只有读取能力，不能调用任意编辑器方法。

4. 在 Godot 项目设置的插件页手动启用 Wheel MCP Editor Bridge。打开场景后，调用：

```json
{
  "name": "get_editor_state",
  "arguments": { "projectPath": "C:/projects/my-game", "limit": 100 }
}
```

调用者须同时满足 MCP `read` 权限、服务器允许的项目根及私有编辑器客户端授权。T11 没有 CLI 入口；工具发现含只读、非破坏性注解。无编辑器、未启用插件、配置禁用或缺端点返回 `ENGINE_UNAVAILABLE`，授权关闭返回 `FORBIDDEN`，绝不另启游戏实例代替。

## 协议、身份与边界

- 独立 `wheel-editor/1` 协议，JSON-RPC 2.0、UTF-8 换行帧。只有 `127.0.0.1` 监听与连接；没有远程配置开关。
- HTTP 探测、非法 JSON/UTF-8、无效 Unicode 转义与非对象帧直接断开该连接，不将输入正文、令牌或解析噪声打印成引擎错误。首个坏帧之后的同包数据不再处理；不会把这个端口改成 HTTP 服务。合法分片 UTF-8、中文、emoji 与 Unicode 转义仍须正常通过身份校验。真实脚本/引擎错误的日志验收不放宽。
- `editor.hello` 校验令牌、传输客户端身份、协议/plane、项目 ID、真实项目路径和本次编辑器随机 session ID。响应确认版本、editor PID、端口、能力和授权状态，不能回显令牌。错误项目/令牌/会话为 `FORBIDDEN`，错误协议或 plane 为 `PROTOCOL_MISMATCH`。只验证了 Windows / Godot 4.7.2 stable；其他版本不冒充支持。
- `editor-endpoint.json` 只含连接身份，无令牌。插件用独占目录 `editor-lease` 防止两个编辑器争抢端点；在租约内写暂存端点再原子改名发布。停用只清理自己持有的租约和匹配 session 的端点。
- 不读取私有 Inspector，也不从磁盘场景推测编辑器状态。通过公开 `EditorInterface.get_edited_scene_root/get_unsaved_scenes/get_selection/get_resource_filesystem` 读取实际内存状态。缺公共脏状态 API 返回 `UNSUPPORTED`，不谎称干净。脏状态目前仅涵盖场景，不等于全部外部资源已保存。
- 状态包含当前场景、最多 100 个节点及 parent/owner、最多 100 项选择、未保存场景路径、资源文件系统扫描/导入状态。节点树裁剪显式 `truncated:true`；文档/选择超过预算或响应超 64 KiB 返回 `UNSUPPORTED`，不静默伪造完整结果。
- Node 每请求连接并在 `finally` 断开，不拥有编辑器进程，不关闭用户编辑器。禁用插件断开所有连接、丢弃未执行查询并停止监听。

## 主线程队列、取消与超时

编辑器 `_process` 每帧执行至多一个查询，队列上限 16；拥塞和重复排队 ID 返回 `CONFLICT`。最多 8 个 TCP 连接，未认证连接 5 秒超时，认证后 30 秒空闲断开；每帧接收至多 64 KiB + 1 字节/连接，异常或过大帧断开。

RPC 读取默认 5 秒，支持 1–120000 ms。到期但未执行的查询返回 `TIMEOUT`。`editor.cancel` 只取消同一连接的待执行查询；原请求返回 `CANCELLED`，取消 ACK 为 `CANCELLED` 或 `NOT_PENDING`。已经执行的只读查询没有回滚承诺。

Node 本地取消/超时会移除 pending 并发送取消通知，明确报告 `REQUESTED_NOT_CONFIRMED`；不会把“发出通知”当成编辑器确认。晚到结果不能复活已过期请求。传输断开将所有 pending 终结为不可用；连接器不会杀死编辑器。

## 停用与异常退出

通过 Godot 插件设置禁用时立即清理监听、队列、端点和自己的租约，私有授权配置保留。重新启用生成新 session，旧身份不能重用。配置只在启用时读取；更改或撤销授权后应禁用再启用，不能假设编辑文件立即撤销已有连接。

强制结束或崩溃可能留下端点/租约，插件选择拒绝接管而非猜测 PID 是否仍属于原编辑器。须由项目所有者核实对应编辑器已退出、没有其他实例使用后，移除本项目的陈旧 `editor-endpoint.json` 和 `editor-lease`，再手动启用。不要删除整个 `.harness`，其内还有事务恢复记录。

这不是 OS 沙箱，不能防御可修改插件/私有配置或调换文件路径的不可信本地进程。生产远程 HTTP 仍禁用。Linux/macOS 与真人桌面交互仍未验收；T12–T14 声明子集已增加独立写权限、原生 Undo/Redo、资源持久化与安全保存，见对应契约，不表示任意编辑能力。

## 验证方式与来源

`tests/editor-bridge-e2e.test.ts` 在独立临时项目复制实际插件、显式授权并启动真正的 `--headless --editor`，另一个仅测试使用的插件通过公开 API 标脏、选择节点和禁用/启用。没有产品测试 RPC、私有 Inspector 依赖或用户项目配置写入。真实引擎的本地认证、脏状态、队列及清理验证不等于真人批准或桌面渲染测试。

短发布门禁包含 `tests/editor-protocol-input.test.ts`：真实 TCP 输入验证异常报文断开、同包后续请求不执行、合法会话继续可用、场景字节/脏状态不变，以及编辑器日志没有解析 ERROR。完整桥接与创作专项需定向或在完整基线中另行运行；不能将日常短 CI 当作全量引擎验收，跳过也不是通过。

公开 API 依据：[EditorInterface](https://docs.godotengine.org/en/stable/classes/class_editorinterface.html)、[EditorPlugin](https://docs.godotengine.org/en/stable/classes/class_editorplugin.html)、[EditorFileSystem](https://docs.godotengine.org/en/stable/classes/class_editorfilesystem.html)、[TCPServer](https://docs.godotengine.org/en/stable/classes/class_tcpserver.html)；支持范围以本地 4.7.2 的实测为准，不根据新版文档推断支持。
