# T20 有界 ShaderMaterial / VisualShader 契约

T20 只提供可信本机 Godot 4.7.2 的小型空间材质子集，不是任意 shader 编辑器。写侧仍需私有编辑器 `writeClients`、`resource.manage` 与新增 `scene.shader/v1` 能力；客户端可先用 `manage_editor_resource` 的 `shader_capabilities` 查询支持范围与实际编辑器 renderer。发现结果的 `renderValidation: NOT_RUN` 明确表示握手本身不构成 GPU 编译或视觉验证。

## 支持范围

- `shader` 请求的 `text` 格式只接受两个逐字匹配的安全模板：`spatial-unshaded-tint/v1` 和 `spatial-unshaded-texture-blend/v1`。前者有一个 `tint` Color uniform；后者有 `tint`、0–1 `blend`，以及两张由每张四个 Color 构成的 2×2 原生 ImageTexture。它是真实采样和混合，不是素材路径导入；项目文件导入留待 T21。任意 GLSL/Godot shader 文本、其他 render mode、代码片段均拒绝。
- `visual` 图只允许 fragment 的 ColorConstant 和 Vec3×scalar Mix，Color 的 RGB/alpha 输出分别为 vec3/float；Mix 的两个颜色输入为 vec3、权重为 float；输出只接空间 fragment ALBEDO 的 vec3 端口。最多 16 节点、32 边；ID、端口、类型、目标唯一性、无环和全部节点可达输出在创建与重开读回时受检。其他 VisualShaderNode、其他阶段/端口/模式明确不支持。
- 目前支持 `forward_plus`、`mobile`、`gl_compatibility` 名称范围，未知 renderer 返回 `UNSUPPORTED`；自动原生渲染实证仅为 Windows/Godot 4.7.2 的 Vulkan Forward+，不借此宣称另外两种 renderer 已验收。

## 事务、失败与真实性

`ShaderMaterial` 仍使用 scoped ResourceRef。外部 `.tres` 先由 ResourceSaver 暂存、同类型/属性/嵌入纹理字节读回并哈希比较，再经现有精确批准/CAS 写入；`resource_assign`/`resource_set` 仍走原生场景预检、一个 Undo/Redo 历史与安全保存。`blend` 超过 0–1、错误模板、错误边/端口与不支持图返回失败；新 `shader-preflight` diagnostics 是本地预检诊断，**不是**虚构的 GPU 编译器原始报错。拒绝发生在修改原材质之前，既有 `.tres` 字节保持不变。

原生验收使用官方 MCP、隔离项目与明确 MOCK 表单批准：文本蓝色、VisualShader 红蓝混合紫色、两张真实纹理 0.5 混合黄绿色、场景中 `blend=1` 保存重开的绿色，均在固定相机/BoxMesh/灯光的 Vulkan Forward+ 运行态截图；自动读取中心像素、对比图像与无错误运行日志。固定预览相机/灯光及纹理像素是 **TEST-ONLY** 夹具，不是用户项目自动插入物。存在文件、读取参数或握手能力不单独算渲染通过。测试文件：`tests/shader-authoring-e2e.test.ts`，同时进入完整套件与 Godot 必需 smoke。

不支持任意源码的编译器逐行定位、外部图片导入、ShaderGraph 全节点库、跨平台/跨 renderer 视觉一致性、真人批准或线上生产资格。T21、T22–T35 和 G3–G6 仍需各自验收；T31 默认 registry 遗留锁恢复缺陷仍在。
