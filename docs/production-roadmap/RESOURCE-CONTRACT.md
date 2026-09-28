# T13 有界原生资源服务

T13 声明子集已通过完整同源基线与原生资源专项；不等于任意资源生产能力。`manage_editor_resource` 仅管理会话内临时资源及引用，不改变节点；节点赋值和资源修改走 `apply_editor_scene` 的精确人工批准、CAS 和原生 Undo。`save_editor_resource` 原生 ResourceSaver 导出并加载读回后，经 T10 精确文件 diff 批准和事务写入 `.tres`。仅允许精确 float32 表示的数字转换，其他引擎归一化仍拒绝。

## 范围与身份

ResourceRef 含 type、随机 handle、resourceType、projectId、sessionId、ownerId、完整资源 fingerprint。最多 64 个句柄/原生导出，120 秒到期；释放、禁用插件、编辑器重启后不能借用旧句柄。类型、调用方、项目、会话和指纹必须完全一致。引用只从当前文档已声明的节点属性获得，不接受任意客户端系统路径。adopt 只允许该调用方本会话原生导出的精确 hash、项目内 `.tres`，先比字节再加载；不能绕过路径或加载任意脚本。

第一批：StandardMaterial3D（albedo_color/roughness/metallic），PhysicsMaterial（friction/bounce/rough/absorbent），Box/Sphere/Capsule/CylinderShape3D，Rectangle/Circle/CapsuleShape2D，以及 BoxMesh/SphereMesh 的基本尺寸。ShaderMaterial 只接受固定的内置 spatial shader（tint/roughness），不是任意 shader 作者或渲染编译能力；后者属于 T20。非声明属性、脚本、纹理、next_pass、复杂容器、资源环和不支持的依赖图明确拒绝，不递归展开对象图。

## 共享、批准与持久化

赋值与修改均要求 `shared` 或 `make_unique`。预检影子树先深复制资源且重建共享映射，不允许影子预检改变原资源。shared 只修改当前文档的本地/内嵌资源；外部或导入资源只读，make_unique 创建独立内嵌副本。原生 Undo 保留资源对象及共享关系，资源变化使旧句柄失效，重新 reference 后才可读。

导出只写随机内部 staging 路径，并清理自己的临时 `.tres`；不先覆盖目标。加载原生导出核对类型与受支持属性，再向客户端提供准确字节供独立表单批准。文件端检查 owner、operationId、预期 hash 与磁盘 CAS；无确认、批准拒绝、错 hash 都不能写用户文件。保存到已有 `.tres` 时保留原生 UID；提交后返回新外部 ref。写入已 COMMITTED 但后续引用失败时仍报告 persisted:true 和 referenceError，不谎称回滚。

非资源数据、未知图、任意脚本和不可信项目不能靠这条接口变成安全输入。句柄是内存生命周期，不是跨编辑器重启的持久授权。文件路径要求父目录已存在，不隐式创建目录。ResourceSaver roundtrip 的 PASS 不代表游戏行为、渲染或完整 G2 PASS；保存/重开端到端另由 T14–T15 验收。

## 验证

`resource-sharing.test.ts` 使用真实 EditorPlugin 检查共享/独立修改、原生撤销/重做、跨 owner/错类型/释放/陈旧引用。`resource-roundtrip.test.ts` 用官方 SDK 工具和明确 MOCK 表单批准，逐类原生导出保存 UID，实际关闭编辑器、重新启动隔离编辑器并读回外部/内嵌引用与共享关系。场景 pack 控制器是测试专用公开 API，不作为产品保存入口。未进行真人表单、跨平台或外部生产发布。

## API 依据

[ResourceSaver](https://docs.godotengine.org/en/stable/classes/class_resourcesaver.html)、[Resource](https://docs.godotengine.org/en/stable/classes/class_resource.html) 的复制、保存及 UID API。文档决定 API 选择，结果以本仓库固定 Godot 4.7.2 的实际测试为准。文档快照忽略 Godot 保留的下划线组，并排序非内部组；[Node.get_groups](https://docs.godotengine.org/en/stable/classes/class_node.html) 不保证组顺序，\_root_canvas 等内部组仅在入树后生成，不能当用户编辑差异。

## T17 UI 资源扩展

新增 Theme、StyleBoxFlat 共 14 种；主题 item 及完整 storage/native export/save-reopen 校验见 [UI 契约](UI-AUTHORING-CONTRACT.md)。需要插件 `scene.ui/v1`；StyleBoxFlat 为 Theme 子项而非节点材质。原资源逐类导出测试仍包含两种新类型，Theme 挂 Control.theme，样式的组合 Theme 同项目重开由 UI 专项验收，不将其错误地赋到 material_override。

## T20 Shader 资源扩展

上述固定 ShaderMaterial 描述是 T13 当时的范围；T20 新增两个精确文本模板、嵌入 2×2 纹理混合与有界 Color/Mix VisualShader 图，不放开任意 shader 程序。能力发现、资源哈希/原生重开、负例和真实 Vulkan 截图的详细边界见 [Shader 契约](SHADER-AUTHORING-CONTRACT.md)。
