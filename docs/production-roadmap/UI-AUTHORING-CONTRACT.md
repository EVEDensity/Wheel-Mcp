# T17 有界 UI 布局与主题

本页描述 Windows / Godot 4.7.2 上的可信本机声明子集，不是任意 UI、任意字体或跨平台资格。main 开发分支的插件私有桥接版本为 `0.3.6`，沿用 `scene.ui/v1`、`scene.line_edit/v1`、`scene.scroll/v1`、`scene.rich_text/v1`、`scene.texture/v1`，新增 `scene.png_texture/v1`；后续 Sprite2D 扩展另见 [精灵契约](SPRITE-2D-CONTRACT.md)，公告同时含 `scene.sprite2d/v1`；新节点创建/专用字段缺能力返回 PROTOCOL_MISMATCH，缺独立写授权仍优先 FORBIDDEN。宿主和插件须配套显式升级，旧客户端的 20–25 项能力上限不能解析新插件的 26 项写入能力公告；新版保留 26 项及原帧/文件字节边界。不会自动替换或启用用户项目插件。T17 原有冻结验收与本轮新增回归分开；生产仍 NOT_QUALIFIED。

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

本批未扩展 Theme 类型槽、文本信号连接、任意脚本、IME、字符输入注入、剪贴板或屏幕阅读器资格；RichTextLabel 与 TextureRect 的后续子集见下节。现有公开 v0.2.8 包不包含这些 main 开发改动。

## ScrollContainer 首批声明子集（main 开发源码）

新增创建 `ScrollContainer`，同样走精确批准、CAS、一批一次原生 Undo/Redo 和单独保存；不增加隐式脚本或运行时生成器。

- `ui_set` 新增 `horizontal_scroll_mode`、`vertical_scroll_mode`：整数 0..4，分别为 Disabled、Auto、Always Show、Never Show、Reserve；`follow_focus` 为 bool。这些字段只对 ScrollContainer 开放。Maximize First (5)、滚动提示纹理、自定义步长及触摸配置不在本批声明范围。
- 内容应使用直接子 Control/Container 的 minimum size、size flags 布局。直接子节点的 anchors/offsets 和跨 Container reparent 仍拒绝；内部滚动条、焦点装饰不进入 authored 节点遍历，也不能通过已知名称删除、改值或作为创建父节点。
- `scroll_horizontal` / `scroll_vertical` 是受当前布局和输入影响的位置，不开放为 `ui_set` 字段，也不进入 authored CAS/保存一致性比较。不将预览影子树的滚动位置冒充实际布局或保证非零初始滚动位置保存重开。
- 拒绝 `scroll_started` / `scroll_ended` 用户连接、内部滚动条的 `changed` 或外部 `value_changed` 连接，以及移出的/带脚本的内部滚动条。每根内部滚动条必须恰好保留一个固定 Godot 4.7.2 构造的同接收者原生 `ScrollContainer::_scroll_moved` 无 bind/flags 连接，缺失也拒绝；不是放行任意同类节点回调。实时文档快照在 commit 前再次检查，审批期间新接入回调也会冲突拒绝。该规则不是所有 UI 信号或任意脚本的安全契约。

`ui-scroll-native.test.ts` 使用真实 Godot、官方 SDK stdio 和 MOCK 批准，检查只读/缺能力/超能力预算拒绝、控件类型与内部路径拒绝、整批失败无残留、准确 Undo/Redo、实际 ResourceSaver 保存重开并按路径归一化身份后比较全部声明存储。运行时通过真实 Tab 键事件将焦点从首按钮移至末按钮，读取自动滚动及末按钮垂直几何；关闭 follow_focus 后再 Tab，焦点改变但滚动位置不变。

这是 headless 原生 GUI 行为和存储验收，不是鼠标滚轮、触屏拖拽、桌面焦点、像素裁剪、无障碍或不同 viewport/renderer 的资格。没有用直接设置 scroll_vertical 冒充输入后的自动滚动；直接设置仅用于关闭 follow_focus 的对照组复位。

### 后续新增：有界原生滚轮输入

main 的运行桥 0.3.1 新增 `input.mouse_wheel/v1`，不是编辑器桥版本变化。
使用 `call_runtime_bridge` 的 `method:"inject_input"`，参数例如：

```json
{"type":"mouse_wheel","direction":"down","position":{"x":80,"y":80},"factor":1}
```

方向只限 up/down/left/right，viewport 坐标 x/y 为有限 0..16384，factor 为有限
大于 0 且不超过 8，省略默认为 1；其他字段拒绝。一次调用是一个原生
InputEventMouseButton 按下/释放对，不移动系统鼠标，不指定目标节点、不通过
直接设置滚动值冒充 GUI 事件。超出控件命中范围的有效坐标也可能被接受但无人消费。
`accepted:true` 仅表示注入，必须读取状态或像素证明实际响应。没有操作系统 GUI 权限要求。

宿主在分发前检查参数和运行桥能力，旧桥未声明能力则 UNSUPPORTED；原生再次校验
输入边界。保留 write/run scope、会话归属和准确 operationId；相同请求重复 ID 不会
再次注入，未知结果先查状态而非另起 ID 重试。运行时交互不代表编辑器落盘。

`mouse-wheel-native.test.ts` 从 MCP 创作保存的 ScrollContainer 验证双轴、逆向、
窗口内外命中、隐藏控件、边界限制、参数拒绝、重复 ID 及磁盘字节不变；在托管
headless smoke 中运行。`mouse-wheel-render.test.ts` 另在本机真实渲染检查滚动像素改变
且恢复零差异；不声称托管 GPU、系统硬件鼠标、触控板平移、触摸、桌面焦点或 IME 资格。

## RichTextLabel 首批纯文本子集（main 开发源码）

新增创建 `RichTextLabel`；这一步是该控件的纯文本展示能力，不是完整富文本格式、BBCode 或资源图支持。继续使用精确批准、CAS、原生 Undo/Redo 和独立保存。

- `text` ≤512，支持多行；`autowrap_mode` 0..3 沿用既有字段。`[img]`、`[url]` 等字符串按字面显示，不解析为资源或链接。`fit_content`、`scroll_active` 为 bool，仅对 RichTextLabel 开放。没有开放 `bbcode_enabled`（包括 false）、threaded、可见字符计数、选择/剪贴板、菜单、滚动跟随或任意字体/图片配置。
- 当前节点必须保持 BBCode/线程/选择/菜单/滚动跟随关闭，custom_effects 为空，parsed text 与声明 text 相同且在预算内；不隐式清除或转换不符合条件的已有内容。拒绝 finished/meta_* 回调。内部原生 VScrollBar 和选择 Timer 不纳入 authored 节点，必须保留固定 Godot 4.7.2 的单一原生 `_scroll_changed` / `_update_selection` 无 bind/flags 连接；额外叶子子节点、滚动条脚本和外部回调拒绝。实时快照在提交前再次检查。
- 此契约仅针对可信、无脚本、声明式纯文本场景。`push_*`/`append_text` 等非持久手动 tag stack 不属于可编辑文档；parsed-text 不一致可检测并拒绝，但不能据此声称能识别每种“文字相同、格式不同”的内存栈。没有开放上述方法为编辑器操作，也没有对任意手动栈提供格式保存或撤销保证。
- 不排除 text、fit_content、scroll_active 或布局边界来让保存通过；引擎改变声明存储时仍拒绝。Theme 的类型槽保持原有白名单，不因新增控件而自动扩展字体/纹理资源权限。

`ui-rich-text-native.test.ts` 通过真实 Godot、官方 SDK stdio 和 MOCK 批准验收：只读/缺能力/超预算拒绝、字面标签与 512/空文本、类型与内部路径边界、整批失败无残留、审批期间增加回调拒绝、原生创建/删除/编辑 Undo/Redo、实际 ResourceSaver 保存重开并比较全部声明存储。headless 运行时读取原生 parsed text、行数和内容高度，缩窄控件后必须实际重新换行；这不是像素排版、CJK 字体、链接交互或人工视觉验收。

## TextureRect 与原生渐变纹理（main 开发源码）

新增创建 `TextureRect`，继续使用精确批准、CAS、原生 Undo/Redo 和独立保存：

- `ui_set` 声明 `expand_mode` 整数 0..1（Keep Size / Ignore Size）、`stretch_mode` 整数 0..6、`flip_h` / `flip_v` bool，仅对 TextureRect 开放。扩展模式 2..5 在引擎文档中有 Container 稳定性警告，不在本批范围。Container 直接子节点仍不得改 anchors/offsets 或跨边界 reparent。
- `manage_editor_resource` 的 `request: {action:"texture", source:{format:"linear-gradient", width, height, colors:[Color,Color]}}` 创建原生 `GradientTexture2D` 句柄。宽高为整数 1..32，两个显式有限 0..1 Color；内部 Gradient 固定 0/1 两个位置、线性插值、sRGB、水平填充、不重复、非 HDR。普通 `create GradientTexture2D` 只接受空 properties，生成 16×16 黑白默认纹理。
- 新增第 15 类资源不是开放任意 Texture2D：渐变只允许无脚本 `GradientTexture2D -> Gradient` 闭合图，完整标量/PackedArray 存储参与指纹及保存读回。所有自定义元数据、对象/Array/Dictionary 或其他依赖拒绝，单层存储最多 24 项、字符串最多 512 字符。纹理通过 `resource_assign property:"texture"` 引用；`resource_set` 直接改纹理拒绝，应新建句柄并用准确计划替换。第 16 类有界 ImageTexture 见下节；没有开放任意路径加载、CompressedTexture2D、SVG、Atlas、材质纹理槽或自定义导入器。
- 句柄继承项目/会话/owner/fingerprint、64 个、120 秒约束。内存或当前场景内嵌纹理允许 shared / make_unique；导出的外部 `.tres` 必须明确 `make_unique` 后内嵌到 TextureRect，不允许 shared 外部引用。已有外部纹理依赖的 TextureRect 场景也拒绝进入本批编辑/保存，不能用旧资源缓存替代外部文件依赖 CAS。不会自动转存或改写原文件。
- 纹理本身仍可通过现有独立精确批准、T10 CAS 和原生 ResourceSaver 导出 `.tres`、按同 owner 原生导出哈希 adopt/read，再显式拷贝赋值。保存同时比较 TextureRect authored 字段和两层完整纹理存储，不忽略纹理内容来让重开通过。节点/资源身份在重开后的测试比较中归一化，但共享关系、外部路径和全部存储保留。

`ui-texture-native.test.ts` 使用真实 headless 编辑器和主要 stdio 客户端：权限/能力预算、共享与独占、第二 owner 拒绝、释放句柄后的拒绝、错误类型/伪造指纹、批次失败无残留、原生 Undo/Redo、审批期间修改渐变导致 CONFLICT、HDR/不透明元数据和外部引用拒绝、独立资源导出与场景实际保存重开。第二 owner 使用独立 SDK 内存传输，不冒充第二种已安装客户端。`resource-roundtrip.test.ts` 当前覆盖全部 16 类原生资源，按每批最多 32 操作拆分，TextureRect 外部纹理明确走 make_unique。

`ui-texture-render.test.ts` 是单独本机真实渲染验收：从 MCP 创建并保存的场景启动渲染运行桥，水平翻转后 PNG 至少 1000 像素改变，恢复后零像素差异。它不进入 GitHub headless 门禁，不将 headless 存储通过当成 GPU、全 stretch/flip 模式的像素布局或桌面焦点资格。无人工视觉答复不记为人工 PASS。

## PNG 来源快照（main 开发源码）

- `manage_editor_resource` 接受 `request:{action:"png_texture",path:"res://icon.png",sourceHash:"<SHA-256>"}`。路径必须在授权项目内，拒绝绝对路径、逃逸、保护目录、符号链接/junction、硬链接；最多 16 KiB、宽高 1..32、非交错 8 位 RGB/RGBA，仅 IHDR/IDAT/IEND 块。拒绝色彩配置、文本、动画块、SVG、调色板等未声明格式。
- 宿主检查哈希、CRC、压缩数据和扫描行，内部传递准确字节；原生再次核对源文件、用 Image.load_png_from_buffer 解码并转换 RGBA8，宿主独立比较全部像素。此路径不使用 ResourceLoader 的 PNG 导入缓存或 `.import`，不宣称具备任意导入器来源认证。既有 `import_project_png` 的独立隔离导入限制不变；它不是必须前置步骤。
- 第 16 类 ImageTexture 只接受无脚本 `ImageTexture -> Image` 闭合图，RGBA8、无压缩/纹理尺寸覆盖/mipmap、全部像素参与指纹和实际保存重开比较。`create ImageTexture properties:{}` 只生成 1×1 白色默认图；不能通过公共请求注入任意原始字节。句柄不可原地修改。
- 新建/复制句柄临时绑定 sourceHashes，读取/计划准备重查来源；合并进原有最多 32 个场景/PNG 依赖的准确计划，宿主在审批前后及原生最终 commit 重查哈希。源文件改变返回 CONFLICT、不得提交。带来源句柄禁止直接导出，避免绕开赋值的来源审批；先批准赋值，再 reference 内嵌资源后独立导出。
- 成功赋值是**独立像素快照**，不是源 PNG 的动态引用：之后源文件改变或删除不影响已内嵌资源，也不要求保存时继续检查它。外部 `.tres` 仍须 make_unique，已有外部纹理场景仍拒绝，不因本功能开放外部依赖或热更新。
- `png-texture-contract.test.ts` 检查真实像素、格式/CRC/元数据、路径及 32 文件总预算；`png-texture-native.test.ts` 检查权限/能力、复制来源、拒绝审批、审批中变化、原生最终 CAS、准确 Undo/Redo、删除源后资源/场景保存及重开。审批为 MOCK；直接私有 RPC 仅作为原生最终 CAS 的授权测试控制，不算产品批准。
- `png-texture-render.test.ts` 本机走实际 MCP PNG 导入 → 快照赋值 → 原生保存 → 渲染运行桥，检查红蓝像素、翻转差异和恢复；与原有渐变真实渲染检查分开，不进入托管 headless 门禁，不认证 GPU 矩阵或人工 UX。

## Theme 与样式（原有子集）

原有 `manage_editor_resource` 的 Theme、StyleBoxFlat 位于此前 14 种受控资源中；main 新增 GradientTexture2D、ImageTexture 见上节。继承现有 ResourceRef 项目/会话/owner/fingerprint、64 句柄、120 秒 TTL 和共享外部资源只读约束，原 Theme 类型槽不扩大。

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

纹理子集另参考 [TextureRect](https://docs.godotengine.org/en/stable/classes/class_texturerect.html)、[GradientTexture2D](https://docs.godotengine.org/en/stable/classes/class_gradienttexture2d.html)、[Gradient](https://docs.godotengine.org/en/stable/classes/class_gradient.html) 与 [4.7.2 原生渐变实现](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/resources/gradient_texture.cpp)。渐变的 headless 存储比较不调用 get_image；ImageTexture 用原生 Image 的实际 RGBA8 数据比较，不伪造 GPU 输出。Godot 4.7.2 dummy 存储保存创建时的 Image，不能据此认证原地 update；产品纹理保持不可变。参考 [Image](https://docs.godotengine.org/en/stable/classes/class_image.html)、[ImageTexture](https://docs.godotengine.org/en/stable/classes/class_imagetexture.html) 与 [dummy 原生存储](https://github.com/godotengine/godot/blob/4.7.2-stable/servers/rendering/dummy/storage/texture_storage.h)。最终可见像素资格只来自单独实际渲染用例。扫描进度在插件端限定 0..1，不能代替真实扫描/导入/就绪判断；宿主仍严格拒绝越界值。

[Control](https://docs.godotengine.org/en/stable/classes/class_control.html)、[Container](https://docs.godotengine.org/en/stable/classes/class_container.html)、[ScrollContainer](https://docs.godotengine.org/en/stable/classes/class_scrollcontainer.html)、[RichTextLabel](https://docs.godotengine.org/en/stable/classes/class_richtextlabel.html) 与 [4.7.2 原生实现](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/rich_text_label.cpp)、[Theme](https://docs.godotengine.org/en/stable/classes/class_theme.html)、[StyleBoxFlat](https://docs.godotengine.org/en/stable/classes/class_styleboxflat.html)。使用公开 API；声明结果由固定版本真实测试确认，不从文档推断跨版本资格。
