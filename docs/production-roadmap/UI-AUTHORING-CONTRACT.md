# T17 有界 UI 布局与主题

本页描述 Windows / Godot 4.7.2 上的可信本机声明子集，不是任意 UI、任意字体或跨平台资格。main 开发分支的插件私有桥接版本为 `0.3.3`，沿用 `scene.ui/v1`、`scene.line_edit/v1`、`scene.scroll/v1`，新增 `scene.rich_text/v1`；新节点创建/专用字段缺能力返回 PROTOCOL_MISMATCH，缺独立写授权仍优先 FORBIDDEN。宿主和插件须配套显式升级，旧客户端的 20/21/22 项能力上限不能解析新插件的 23 项写入能力公告；新版保留 23 项及原帧/文件字节边界。不会自动替换或启用用户项目插件。T17 原有冻结验收与本轮新增回归分开；生产仍 NOT_QUALIFIED。

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

## LineEdit 首批声明子集（main 开发源码）

新增创建 `LineEdit`，使用相同的 `ui_set`、批准、CAS、Undo/Redo 和单独保存流程：

- `text` 与 `placeholder_text`：≤512 的文本预算；LineEdit 拒绝换行、制表和其他 C0/DEL 控制字符，Label 的多行文本行为不变。
- `editable`：bool；`max_length`：0..512 整数。0 是引擎“不限输入长度”，但服务写入的文本仍受 512 预算约束。最终文本不能超过非零上限；不允许自动截断来通过验证。
- 文本和最大长度成对捕获、应用和撤销。临时放开长度后设置准确文本，最后恢复目标长度，不依赖请求字段顺序。
- 原生编辑期间临时屏蔽 LineEdit 信号并恢复原阻塞状态，避免审批后新加的临时回调在 commit/Undo/Redo 中执行。预检检查真实节点而非只查影子副本；已有 text_changed、text_change_rejected、text_submitted、editing_toggled 回调的场景拒绝编辑。

`ui-line-edit-native.test.ts` 使用真实 Godot 和官方 SDK stdio，批准为 MOCK：只读拒绝、缺新能力及超能力预算拒绝、非法输入保持场景/磁盘不变、准确 Undo/Redo、实际 ResourceSaver 保存重开，以及聚焦/编辑模式/光标定位后的 GUI Backspace 和只读文本不变。不会把直接赋值冒充键盘输入。

本批未扩展 Theme 类型槽、文本信号连接、任意脚本、IME、字符输入注入、剪贴板或屏幕阅读器资格；RichTextLabel 的后续纯文本子集见下节，TextureRect 尚未实现。现有公开 v0.2.8 包不包含这些 main 开发改动。

## ScrollContainer 首批声明子集（main 开发源码）

新增创建 `ScrollContainer`，同样走精确批准、CAS、一批一次原生 Undo/Redo 和单独保存；不增加隐式脚本或运行时生成器。

- `ui_set` 新增 `horizontal_scroll_mode`、`vertical_scroll_mode`：整数 0..4，分别为 Disabled、Auto、Always Show、Never Show、Reserve；`follow_focus` 为 bool。这些字段只对 ScrollContainer 开放。Maximize First (5)、滚动提示纹理、自定义步长及触摸配置不在本批声明范围。
- 内容应使用直接子 Control/Container 的 minimum size、size flags 布局。直接子节点的 anchors/offsets 和跨 Container reparent 仍拒绝；内部滚动条、焦点装饰不进入 authored 节点遍历，也不能通过已知名称删除、改值或作为创建父节点。
- `scroll_horizontal` / `scroll_vertical` 是受当前布局和输入影响的位置，不开放为 `ui_set` 字段，也不进入 authored CAS/保存一致性比较。不将预览影子树的滚动位置冒充实际布局或保证非零初始滚动位置保存重开。
- 拒绝 `scroll_started` / `scroll_ended` 用户连接、内部滚动条的 `changed` 或外部 `value_changed` 连接，以及移出的/带脚本的内部滚动条。每根内部滚动条必须恰好保留一个固定 Godot 4.7.2 构造的同接收者原生 `ScrollContainer::_scroll_moved` 无 bind/flags 连接，缺失也拒绝；不是放行任意同类节点回调。实时文档快照在 commit 前再次检查，审批期间新接入回调也会冲突拒绝。该规则不是所有 UI 信号或任意脚本的安全契约。

`ui-scroll-native.test.ts` 使用真实 Godot、官方 SDK stdio 和 MOCK 批准，检查只读/缺能力/超能力预算拒绝、控件类型与内部路径拒绝、整批失败无残留、准确 Undo/Redo、实际 ResourceSaver 保存重开并按路径归一化身份后比较全部声明存储。运行时通过真实 Tab 键事件将焦点从首按钮移至末按钮，读取自动滚动及末按钮垂直几何；关闭 follow_focus 后再 Tab，焦点改变但滚动位置不变。

这是 headless 原生 GUI 行为和存储验收，不是鼠标滚轮、触屏拖拽、桌面焦点、像素裁剪、无障碍或不同 viewport/renderer 的资格。没有用直接设置 scroll_vertical 冒充输入后的自动滚动；直接设置仅用于关闭 follow_focus 的对照组复位。

## RichTextLabel 首批纯文本子集（main 开发源码）

新增创建 `RichTextLabel`；这一步是该控件的纯文本展示能力，不是完整富文本格式、BBCode 或资源图支持。继续使用精确批准、CAS、原生 Undo/Redo 和独立保存。

- `text` ≤512，支持多行；`autowrap_mode` 0..3 沿用既有字段。`[img]`、`[url]` 等字符串按字面显示，不解析为资源或链接。`fit_content`、`scroll_active` 为 bool，仅对 RichTextLabel 开放。没有开放 `bbcode_enabled`（包括 false）、threaded、可见字符计数、选择/剪贴板、菜单、滚动跟随或任意字体/图片配置。
- 当前节点必须保持 BBCode/线程/选择/菜单/滚动跟随关闭，custom_effects 为空，parsed text 与声明 text 相同且在预算内；不隐式清除或转换不符合条件的已有内容。拒绝 finished/meta_* 回调。内部原生 VScrollBar 和选择 Timer 不纳入 authored 节点，必须保留固定 Godot 4.7.2 的单一原生 `_scroll_changed` / `_update_selection` 无 bind/flags 连接；额外叶子子节点、滚动条脚本和外部回调拒绝。实时快照在提交前再次检查。
- 此契约仅针对可信、无脚本、声明式纯文本场景。`push_*`/`append_text` 等非持久手动 tag stack 不属于可编辑文档；parsed-text 不一致可检测并拒绝，但不能据此声称能识别每种“文字相同、格式不同”的内存栈。没有开放上述方法为编辑器操作，也没有对任意手动栈提供格式保存或撤销保证。
- 不排除 text、fit_content、scroll_active 或布局边界来让保存通过；引擎改变声明存储时仍拒绝。Theme 的类型槽保持原有白名单，不因新增控件而自动扩展字体/纹理资源权限。

`ui-rich-text-native.test.ts` 通过真实 Godot、官方 SDK stdio 和 MOCK 批准验收：只读/缺能力/超预算拒绝、字面标签与 512/空文本、类型与内部路径边界、整批失败无残留、审批期间增加回调拒绝、原生创建/删除/编辑 Undo/Redo、实际 ResourceSaver 保存重开并比较全部声明存储。headless 运行时读取原生 parsed text、行数和内容高度，缩窄控件后必须实际重新换行；这不是像素排版、CJK 字体、链接交互或人工视觉验收。

## Theme 与样式（原有子集）

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

[Control](https://docs.godotengine.org/en/stable/classes/class_control.html)、[Container](https://docs.godotengine.org/en/stable/classes/class_container.html)、[ScrollContainer](https://docs.godotengine.org/en/stable/classes/class_scrollcontainer.html)、[RichTextLabel](https://docs.godotengine.org/en/stable/classes/class_richtextlabel.html) 与 [4.7.2 原生实现](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/rich_text_label.cpp)、[Theme](https://docs.godotengine.org/en/stable/classes/class_theme.html)、[StyleBoxFlat](https://docs.godotengine.org/en/stable/classes/class_styleboxflat.html)。使用公开 API；声明结果由固定版本真实测试确认，不从文档推断跨版本资格。
