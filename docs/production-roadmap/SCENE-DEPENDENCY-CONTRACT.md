# 场景实例、继承与引用迁移（T16）

当前增量只面向 Windows / Godot 4.7.2 的可信本机原生子集，尚不是整个生产路线的资格。静态 `parseSceneResourceGraph` / `get_scene_tree` 明确 `analysisLevel: heuristic, authoritative: false`；根 instance 的 ExtResource ID 决定继承预览，普通子实例不会被误报继承。静态树中的未知继承/override 类型为 null，不伪造或丢掉节点。

原生编辑器使用公开 [SceneState](https://docs.godotengine.org/en/stable/classes/class_scenestate.html) 的 base/instance 状态与 [Node](https://docs.godotengine.org/en/stable/classes/class_node.html) 的 editable-instance API。桥接版本 `0.2.0` 增加 `scene.dependencies/v1`、`scene.overrides/v1`；未独立 write opt-in 的插件先返回 FORBIDDEN，已 opt-in 但缺依赖能力的旧插件返回 PROTOCOL_MISMATCH，拒绝批处理和保存。不是自动升级插件，也不改变用户授权配置。

## 声明的操作与边界

- 保留原 `instantiate: policy=preserve` 和普通 `set` 对实例的只读保护。`override` 必须显式指定，支持 position/rotation/scale/visible，不改外部源文件，不将实例展开成当地节点。
- 继承文档只接受 `override` / `editable_children`，拒绝结构性删除、重命名、重挂及普通 set；这不宣称支持所有继承编辑。
- `editable_children` 改动指定实例根的原生标记，是同批 Undo/Redo 的一部分。深层覆盖要求每个祖先实例的标记明确开启；只开启最深层会丢失保存的覆盖，因此 fail-closed。
- 保存前原生 PackedScene 重新实例化核对节点类别、owner、transform/visibility 和 editable 标记；可能丢失覆盖时拒绝，不仅检查文件存在。原有资源/信号安全边界继续适用。
- 依赖 grammar 是脚本无关的本地 .tscn：Node/Node2D/Node3D/Marker2D/Marker3D/MeshInstance3D，原生标量/Vector2/Vector3 transform/visible、PackedScene 外部引用、继承、override、editable 路径和引擎 unique_id。每文件 64 KiB/32 声明，合并图最多 32 文件、深度 16，环/缺文件/UID 已映射到不同路径拒绝；脚本、表达式、信号、资源子图、placeholder/导入资产仍 UNSUPPORTED。既有当前文档材质等受 T13 规则管理，不因此进入实例依赖白名单。
- 全图先检查后加载；使用 IGNORE_DEEP 获取新鲜资源。比较活 PackedScene 的 base/instance SceneState 与新鲜磁盘状态，已变更依赖要求明确重开，不能用缓存旧状态覆盖新文件。编辑器脏依赖冲突。计划/hash/批准绑定所有传递文件 SHA-256，提交和保存前再次核对；宿主补路径/符号链接/硬链接检查。

## 场景移动

`move_project_scene` 需要 read/write/run、批准的 Godot 可执行文件及精确主机表单批准。from/to 必须是安全 .tscn、目标目录已存在且目标文件不存在，拒绝大小写别名移动。

预览仅迁移可靠的 PackedScene `ext_resource path` 和 `project.godot` 的路径型 `run/main_scene`。保留文件 UID。代码、动态/模糊/UID-only/binary 引用不能安全定位时 CONFLICT，不做全局替换。引用扫描声明上限 1000 文件/64 MiB；复杂场景请人工处理，不把当前语法扫描称为语义重构。批准包含引用文件/行、确切文件变化及验证意图。

项目存在动态 load/preload、C# 或 GDExtension 时，该保守迁移入口冲突；动态插件代码也不自动豁免。未知动态目标不能以“未搜索到旧路径”当成安全迁移证据。关闭编辑器不会使不支持的引用自动变为支持。

必须先关闭编辑器；事务前再次检查，避免活文档绑定旧路径。候选在隔离项目中真正移除旧文件，更新引用及配置，再进行 Godot 导入、加载/实例化，原项目尚未写入。批准/校验后完整项目 CAS，T10 多文件 journal 提交与字节读回；异常沿用事务恢复，不宣称多文件是操作系统原子替换。完成后明确 `editorReload: REQUIRED`。

超时结果不自动重放。再次请求时源不存在/冲突明确拒绝；通过返回的 operationId 和私有 journal 检查事务/恢复，不发明新的“成功移动”。这不保证任意动态引用、未知插件或不可信文件系统进程可安全迁移。

## 验收

`inherited-scene-roundtrip.test.ts` 实际 SDK/native editor 验证三层继承、三层实例、显式覆盖、Undo/Redo、原生保存/同项目重开、未覆盖基础属性传播、新旧依赖冲突及循环/缺失/脚本拒绝。`scene-move.test.ts` 实测 MCP 精确批准、移动/引用/UID 与无旧文件候选验证，并覆盖拒绝批准、run 权限缺失及人工并发修改。批准回复是明确 MOCK，不是桌面真人体验；测试仅启用临时 fixture 插件。
