# T12 原生场景操作与受控 MCP 写入

本页描述有限能力子集，不是完整 Godot authoring API。`apply_editor_scene` 与 `get_editor_scene_operation` 已注册；只有已启用编辑器插件且配置独立 `writeClients` 秘钥的调用方可写。默认只读，不自动安装、启用插件。T12–T15 的声明子集与当前源码 G2 已通过，G3–G6 NOT_RUN，生产资格 NOT_QUALIFIED；证据及源码身份以任务清单为准。

## 已实现与真实验证

`godot-plugin/addons/wheel_mcp/scene_service.gd` 在实际 EditorPlugin 主线程内预检和修改当前文档。临时 fixture 的测试专用控制器加载实际核心，使用真实 `EditorUndoRedoManager`，不是生成 tscn 文本或模拟 Undo。

- 一个逻辑批次 1–32 个操作，文档最多 100 个节点；字段严格校验，拒绝未知策略、类型和额外 `approved` 字段。
- 当前能力子集：Node、Node2D/3D、Marker2D/3D、MeshInstance3D、StaticBody2D/3D、CollisionShape2D/3D、Control、Label、Camera3D；资源限 T13 明确声明的类型。创建、删除、重命名、重父级、位置/旋转/缩放/可见性设置、受限信号连接/断开。UI 布局、文本编辑、灯光等完整能力不在本子集。
- 先在独立影子树预检全部操作和最终引用图，再修改原节点；不替换整棵真实树，既有 instance ID 保持。所有普通子节点 owner 必须为当前场景根；新节点亦如此。重父级明确保持局部变换，不接受 `keepGlobalTransform` 等未经验证选项。
- 原生历史版本、编辑根身份、完整支持范围内的文档 hash 和场景磁盘 hash 在提交前重新检查；人工修改、换场景、外部文本修改产生 CONFLICT，不覆盖用户的新状态。
- 执行后精确读回成功才登记一个原生撤销动作（`commit_action(false)`）；失败先反向恢复，不生成可重放的失败 Redo。返回 rolledBack 取实际比较结果，不能把未知状态声称为已恢复。写 RPC 另有独立权限、准备/提交与状态查询层，见下文。
- 原生历史持有回调、创建节点的 do 引用和删除节点的 undo 引用。丢弃尚未提交的预检会释放脱离树的新节点；Undo 后换历史分支由原生引用机制释放不能再 Redo 的创建节点。
- 3D 分量修改的撤销保存完整 Transform3D，不从 Euler/scale 反推旧基矩阵。当前严格读回会拒绝引擎归一化的值；更宽浮点能力须另行定义容差并测试，不暗中放宽。

## 引用与副作用边界

仅支持本地 `Node3D.visibility_parent` NodePath，目标必须为当前树中的 GeometryInstance3D。以解析后的节点身份重算相对路径，包含祖先重命名/移动；不做字符串替换。拒绝未解析、绝对、外部、子属性、unique-name、错类型及循环引用。删除仍被引用的目标前须先显式清空引用。结构变化期间先清空该已证明子集的引用，全部结构操作后恢复最终路径，避免中间状态触发引擎错误；Undo 同理。

持久信号只支持无 binds/unbinds、即时 `visibility_changed -> hide/show`。连接身份保留，重命名不按文本重写 Callable。删除被其他节点连接的目标先要求断开；可能触发可见性回调的设置、移动和删除在仍有相关连接时提前拒绝。先断开、修改、最后重连可以作为同一批次，但尚未支持任意脚本方法/任意信号、副作用自动回滚、deferred 或 one-shot 回调。

继承状态通过对活文档 `PackedScene.pack()` 后读取公开 `SceneState.get_base_scene_state()` 判断，不使用不存在/未公开的 Node 继承接口，也不用磁盘内容替代编辑器的真实继承身份。继承、脚本、unique-name、未声明资源/对象及未保存/无法指纹化的来源拒绝；声明资源按 [资源契约](RESOURCE-CONTRACT.md) 校验。实例化只支持不超过 64 KiB、1–32 个已声明原生节点的本地无脚本 `.tscn`，先检查严格文本语法，再调用原生 PackedScene；拒绝 ext/subresource、嵌套实例和表达式。明确 `policy:preserve`，实例根及内部节点只读，owner 保留；不展开实例或导入资源。来源 hash 提交前再次核验。更完整的实例/继承/依赖图留待 T16。

## 测试与未满足项

`tests/editor-scene-operations.test.ts` 使用 Windows/Godot 4.7.2 的真实 `--headless --editor` 进程。每个测试启动隔离项目并验证节点/属性/owner/连接及原生历史，检查原文件未被保存；不是桌面渲染或真人操作验收。读回失败注入仅修改测试中持有的计划 hash，不是公开故障开关。`scripts/test-godot-ci.mjs` 和完整基线的必需 Godot smoke 均包含此文件；必需运行不允许以 SKIP 代替。

测试控制文件同样先完整写入暂存文件再改名发布：编辑器按帧轮询，直接写公开命令文件会被读到半写 JSON。真实分段写入回归验证暂存期间没有公开命令，写完后才消费。此通道仅存在于临时测试项目，不是产品 RPC 或用户项目自动安装入口。

## 精确批准、幂等与不确定结果

`scene.prepare/commit/discard/status` 在编辑器主线程执行。服务器固定调用方法、注入私有 authority 与真实传输 owner，不提供任意 RPC 入口。预览绑定项目完整路径、会话、场景路径、准确操作集、文档与磁盘 hash、历史版本；受信任客户端独立表单默认拒绝，`approved:true` 不是批准。准备后超时 120 秒，最多 32 个计划；每会话最多保留 256 个结果，不通过淘汰结果允许旧 operationId 重复副作用。相同 owner/operationId/操作集返回既有结果，换操作集返回 CONFLICT。

提交报文已发送后的取消、断连或超时返回 UNKNOWN；调用者应先按原会话和 operationId 查询，不盲目重试。提交结果留在编辑器会话内，可跨连接查询；编辑器关闭或重启后的结果 UNKNOWN，不能假称已回滚。尚未执行的队列请求在断连时移除。原生单批读回失败返回实际恢复状态且不登记历史。

新增 `editor-scene-rpc.test.ts`、`editor-instance-rpc.test.ts`，与核心共 23 个真实编辑器测试。官方 SDK 真实工具入口与批准/拒绝、错 owner/hash、并发文档/磁盘变化、编辑器关闭、断连查询和原生 Undo/Redo 已验证；测试中的表单回复为明确的 MOCK，不是真人 UI 验收。当前支持可信本机项目，不是 OS 沙箱；第三方编辑器回调或恶意文件系统竞争不在已证明范围内。

## 公开 API 依据

- [EditorUndoRedoManager](https://docs.godotengine.org/en/stable/classes/class_editorundoredomanager.html)：场景上下文、原生动作与引用管理。
- [PackedScene](https://docs.godotengine.org/en/stable/classes/class_packedscene.html) 和 [SceneState](https://docs.godotengine.org/en/stable/classes/class_scenestate.html)：活文档 pack 和继承状态读取。
- [Node3D](https://docs.godotengine.org/en/stable/classes/class_node3d.html)：变换分量与 visibility_parent 的 GeometryInstance3D 约束。

文档用于选 API；可用性和行为以本仓库固定版本的真实测试为准。

## T16 显式扩展

上述 preserve/普通 set 的实例只读规则保留。新的依赖绑定批次、原生继承和显式 `override`/`editable_children` 按 [场景依赖契约](SCENE-DEPENDENCY-CONTRACT.md) 执行，不表示将所有实例节点改为可写。原生保存会额外核对实际打包后 owner/transform/visibility/editable 标记，依赖变更或丢覆盖拒绝。

## T17 显式扩展

有界 `ui_set`、Container 布局归属、Theme/StyleBoxFlat、可访问名称及 Button `pressed` 持久即时信号见 [UI 契约](UI-AUTHORING-CONTRACT.md)。本页前文为 T12 原始范围，不应用来声称新 UI 能力已完整资格化；T17 验收/人工视觉记录以任务清单为准。保存额外加载实际 ResourceSaver 暂存字节，拒绝预设默认值导致的重开属性变化。

## T18 显式扩展

新增 `physics_set`、Area3D/RayCast3D、受控物理配置与保存后的逐属性核对，见 [3D 物理观测契约](PHYSICS-3D-CONTRACT.md)。正均匀缩放、shape owners、native overlap 与几何相交语义有明确边界，不开放任意物理回调或导航编辑。
