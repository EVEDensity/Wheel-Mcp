# T17 有界 UI 布局与主题

本页描述 Windows / Godot 4.7.2 上的可信本机声明子集，不是任意 UI、任意字体或跨平台资格。插件私有桥接版本为 `0.3.0`，新增能力 `scene.ui/v1`；缺能力返回 PROTOCOL_MISMATCH，缺独立写授权仍优先 FORBIDDEN。升级/启用须由用户显式操作，不自动改变用户项目。T17 状态和人工复核以 [任务清单](tasks.json) 为准；生产仍 NOT_QUALIFIED。

## 可编辑的节点与操作

沿用 `apply_editor_scene` 的 1–32 操作、100 节点、准确预览、独立批准、CAS、一批一次原生 Undo/Redo 和单独 `save_editor_scene`。新增 Button、CheckButton、HSlider、PanelContainer、MarginContainer、VBoxContainer、HBoxContainer、GridContainer；既有 Control、Label 继续可用。模板生成普通可编辑节点/资源，没有运行时生成器或隐藏脚本。

`ui_set {path, properties}` 每次 1–16 个已声明字段：

- anchors：四边 0..1；offsets：四边有限值 ±100000。
- grow_horizontal/vertical：0..2；custom_minimum_size：非负 Vector2，每轴 ≤100000。
- size_flags_horizontal/vertical：0..15，禁止同时 shrink-center/shrink-end；stretch_ratio：(0,1000]。
- text/tooltip_text/accessibility_description：≤512 字符；accessibility_name：≤128 字符。
- focus_mode/mouse_filter：0..2；Label.autowrap_mode：0..3；GridContainer.columns：1..12。
- Range.min_value/max_value/value：±100000；step：(0,100000]；max 不得小于 min。引擎归一化若不是精确 float32 转换则拒绝，不声称已写入原请求。
- disabled：bool；button_pressed 仅用于没有 toggled 回调的 CheckButton。

字段必须实际属于声明的节点类。不存在的属性 UNSUPPORTED；类型/范围 INVALID_ARGUMENT。Range 有 value_changed 回调时先断开再修改；不把任意第三方回调副作用当成可自动撤销。

## 布局归属与保存

Container 管理的直接 Control 子节点不接受 anchors/offsets。其通用 position/rotation/scale 修改及移入/移出 Container 的 reparent 也返回 CONFLICT；应使用 minimum sizes/size flags，而不是暂时写入随后被布局覆盖的坐标。快照明确 `layoutOwner:Container`，不将运行派生 offsets/layout_mode 纳入 authored CAS。实际几何必须在运行树中另行读取，不能由编辑器影子树宣称稳定布局结果。

非零响应式锚点要求 Control 父节点或顶层 Control 根；Node2D 等 CanvasItem 父节点下的模糊布局拒绝。全尺寸推荐明确设定 anchor_right/bottom=1、grow_horizontal/vertical=2；Godot 的保存预设可能改变被省略的默认 grow 值。

锚点使用不隐式移动 offsets 的原生 setter。Undo 捕获全部受影响边。保存不只检查 pack 内存对象，还重新加载实际 ResourceSaver 暂存字节、实例化并比较声明的 authored UI/Theme storage、owner 和实例标记；重开会变样则 CONFLICT，原文件不写。持久信号另由同项目重开快照与真实按钮行为验收。不自动“修正”用户布局来使保存通过。

## Theme 与样式

`manage_editor_resource` 新增 Theme、StyleBoxFlat，总计 14 种受控资源。继承现有 ResourceRef 项目/会话/owner/fingerprint、64 句柄、120 秒 TTL 和共享外部资源只读约束。

StyleBoxFlat 支持 bg_color/border_color、四边 border_width、四角 corner_radius、四边 content_margin；整数边框/圆角 metric 0..128，浮点 content_margin 0..1000000（不开放 -1 自动边距），颜色采用显式 Color，单次普通属性最多 8 项。Theme 的普通属性仅 default_font_size 1..128。节点赋值使用 `resource_assign property:theme`，不能把 StyleBoxFlat 直接挂到 material_override。

`request.action:theme` 创建新 Theme，1..24 个显式 item：

- kind=color：Color；已声明 font_color、font_hover_color、font_pressed_color、font_disabled_color。
- kind=constant：0..128 整数；separation、h/v_separation、四边 margin。
- kind=font_size：1..128 整数，name 固定 font_size。
- kind=stylebox：已授权 StyleBoxFlat ref，policy 必须 make_unique；normal、hover、pressed、disabled、focus、panel。复制后不修改原外部样式。

themeType 限 Control、Label、Button、CheckButton、HSlider、PanelContainer、GridContainer、VBoxContainer、HBoxContainer、MarginContainer。这些是声明的存储槽，并不表示每一类控件都消费所有槽。未知/重复 item 拒绝。Theme 全部存储内容参与指纹及实际导出读回，只有无脚本平面样式依赖；字体、纹理、任意对象/Array/Dictionary 资源图 UNSUPPORTED。

外部 `.tres` 保存仍走原生导出、独立精确文件批准、T10 journal/CAS，保存后不是跨会话授权。Theme/StyleBoxFlat 比较完整 storage，不只检查标量属性或节点数量。

## 信号与真实输入

新增 Button/CheckButton 的持久即时 `pressed -> hide/show`，目标为当前场景可用本地节点。无 binds/unbinds，不支持 deferred、one-shot、任意脚本回调。与 visibility_changed 的旧约束一致：会触发未受控持久回调的可见性修改先拒绝。连接与 Theme 赋值可组成一批原生 Undo，保存重开后 Callable 仍有效。

`ui-authoring-e2e.test.ts` 从空 Control 场景通过官方 MCP 工具创建设置页与六格背包，真实原生 Undo/Redo、保存、关闭、同项目重开；以真实键盘 Enter 输入触发 GUI Button，而非直接 emit_signal。隐藏背包的节点状态和 PNG 像素变化同时验证。

固定三种 viewport：800×600、1280×720、1600×900；Godot 4.7.2 默认内置 Latin 字体、18px、德语长本地化文本、实际原生渲染。读取 global_position/size，并验证 rotation=0、scale=1 才作几何断言；当前 Variant codec 不支持 Rect2，不能伪造此类型。检查四边余量、控件非零尺寸、标题宽度随 viewport 改变及 PNG 实际尺寸。只验证 Latin 本地化；CJK 字体/其他 renderer/屏幕阅读器实际行为尚未资格化。

人工视觉复核与自动几何/代理图片检查分开记录；没有真人答复不得记为真人 PASS。表单批准测试是 MOCK，编辑器、ResourceSaver、输入、几何和渲染是 REAL。测试失败原件保留，不用后续 PASS 抹去早期裁切/默认值丢失问题。

## API 依据

[Control](https://docs.godotengine.org/en/stable/classes/class_control.html)、[Container](https://docs.godotengine.org/en/stable/classes/class_container.html)、[Theme](https://docs.godotengine.org/en/stable/classes/class_theme.html)、[StyleBoxFlat](https://docs.godotengine.org/en/stable/classes/class_styleboxflat.html)。使用公开 API；声明结果由固定版本真实测试确认，不从文档推断跨版本资格。
