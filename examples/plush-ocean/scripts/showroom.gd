extends Node3D

signal build_ready

const Creature = preload("res://scripts/plush_creature.gd")
const SPECIES: Array[String] = ["whale", "octopus", "clownfish", "pufferfish", "shark", "jellyfish"]
const HEIGHTS: Array[float] = [0.95, 0.75, 0.82, 1.14, 0.82, 1.22]
const YAWS: Array[float] = [0.35, 0.18, -0.44, 0.25, -0.78, -0.18]
const NAMES: Array[String] = ["小鲸鱼", "小章鱼", "小丑鱼", "小河豚", "小鲨鱼", "小水母"]
const TAGS: Array[String] = ["BUBBLE WHALE", "PEACH OCTOPUS", "TANGERINE CLOWN", "PUFFY PUFFER", "BABY SHARK", "DREAM JELLY"]
const NOTES: Array[String] = ["圆滚滚的海洋大胃王。\n蓝色毛绒身体、奶油肚皮，\n一摇尾巴就想让人抱住。", "八只软乎乎的小触手。\n蜜桃色身体、卷曲手臂，\n像刚刚睡醒的棉花糖。", "橘子汽水一样的小伙伴。\n圆润鱼鳍、奶油色条纹，\n游起来像一颗弹跳果冻。", "鼓鼓的身体藏着小脾气。\n柔软短刺、粉扑扑脸颊，\n生气也只是更想被捏一下。", "海里的淘气小宝宝。\n胖头短身、软软的小背鳍，\n露出笑容就一点也不凶了。", "一盏漂浮的梦幻小夜灯。\n软绒布丁帽、丝带触须，\n在水里轻轻呼吸、发光。"]
const CREAM: Color = Color("fff2d8")
const MUTED: Color = Color("a6c9cc")

var character_count: int = 6
var gallery_ready: bool = false
var selected_index: int = -1
var animation_enabled: bool = true
var plush_enabled: bool = true
var characters: Array[Node3D] = []
var pedestal_meshes: Array[MeshInstance3D] = []
var bubbles: Array[MeshInstance3D] = []
var bubble_origins: Array[Vector3] = []
var card_buttons: Array[Button] = []
var camera: Camera3D
var camera_target: Vector3 = Vector3(0, 0.75, 0)
var camera_tween: Tween
var animation_button: Button
var plush_button: Button
var status_label: Label
var detail_panel: PanelContainer
var detail_title: Label
var detail_tag: Label
var detail_body: Label
var drag_active: bool = false
var elapsed: float = 0.0
var ui_font: SystemFont

func _ready() -> void:
	_build_world()
	_build_characters()
	_build_ui()
	gallery_ready = true
	build_ready.emit()

func _build_world() -> void:
	var environment: Environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("092b37")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("7baab6")
	environment.ambient_light_energy = 0.29
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var world: WorldEnvironment = WorldEnvironment.new()
	world.environment = environment
	add_child(world)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -28, 0)
	sun.light_color = Color("fff0dc")
	sun.light_energy = 0.72
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 40.0
	add_child(sun)
	for light_position: Vector3 in [Vector3(-7, 6, 3), Vector3(6, 5, -4)]:
		var fill: OmniLight3D = OmniLight3D.new()
		fill.position = light_position
		fill.light_color = Color("b1dfdf")
		fill.light_energy = 0.45
		fill.omni_range = 18.0
		add_child(fill)
	var floor_mesh: PlaneMesh = PlaneMesh.new()
	floor_mesh.size = Vector2(80, 80)
	_add_mesh(floor_mesh, Vector3(0, -0.14, 0), Color("103038"))
	camera = Camera3D.new()
	camera.position = Vector3(0, 7.7, 17.0)
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 9.8
	camera.current = true
	add_child(camera)
	camera.look_at(camera_target)
	var bubble_material: StandardMaterial3D = StandardMaterial3D.new()
	bubble_material.albedo_color = Color(0.45, 0.79, 0.8, 0.18)
	bubble_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bubble_material.roughness = 0.3
	for i: int in range(17):
		var bubble: MeshInstance3D = MeshInstance3D.new()
		var sphere: SphereMesh = SphereMesh.new()
		sphere.radius = 0.045 + float(i % 4) * 0.018
		sphere.height = sphere.radius * 2.0
		sphere.radial_segments = 12
		sphere.rings = 6
		bubble.mesh = sphere
		bubble.material_override = bubble_material
		bubble.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var origin: Vector3 = Vector3(-9.0 + float(i) * 1.1, 0.7 + float(i % 5) * 0.9, -6.0 - float(i % 3))
		bubble.position = origin
		add_child(bubble)
		bubbles.append(bubble)
		bubble_origins.append(origin)

func _build_characters() -> void:
	for i: int in range(character_count):
		var spot: Vector3 = Vector3(float(i % 3 - 1) * 3.8, 0, 2.6 if i < 3 else -2.6)
		var pedestal: CylinderMesh = CylinderMesh.new()
		pedestal.top_radius = 1.42
		pedestal.bottom_radius = 1.47
		pedestal.height = 0.24
		pedestal.radial_segments = 64
		pedestal_meshes.append(_add_mesh(pedestal, spot, Color("6b9599")))
		var top: CylinderMesh = CylinderMesh.new()
		top.top_radius = 1.39
		top.bottom_radius = 1.4
		top.height = 0.045
		top.radial_segments = 64
		pedestal_meshes.append(_add_mesh(top, spot + Vector3(0, 0.14, 0), Color("e6e1c9")))
		var creature: Node3D = Creature.new()
		creature.set("species", SPECIES[i])
		creature.position = spot + Vector3(0, HEIGHTS[i], 0)
		creature.rotation.y = YAWS[i]
		if i == 2:
			creature.scale = Vector3.ONE * 1.15
		creature.name = SPECIES[i].capitalize()
		add_child(creature)
		creature.call("set_plush_amount", 1.0)
		characters.append(creature)

func _add_mesh(mesh: Mesh, at: Vector3, color: Color) -> MeshInstance3D:
	var instance: MeshInstance3D = MeshInstance3D.new()
	instance.mesh = mesh
	instance.position = at
	var material: StandardMaterial3D = StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.95
	instance.material_override = material
	add_child(instance)
	return instance

func _build_ui() -> void:
	ui_font = SystemFont.new()
	ui_font.font_names = PackedStringArray(["Microsoft YaHei", "Noto Sans CJK SC"])
	var layer: CanvasLayer = CanvasLayer.new()
	add_child(layer)
	var root: Control = Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)
	var header: Label = _label("毛绒海洋", 38, CREAM)
	header.position = Vector2(54, 30)
	root.add_child(header)
	var sub: Label = _label("P L U S H   O C E A N    /    六位软乎乎的海洋伙伴", 14, MUTED)
	sub.position = Vector2(56, 88)
	root.add_child(sub)
	status_label = _label("全体展示  ·  6 位海洋伙伴", 14, MUTED)
	status_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	status_label.position = Vector2(-365, 44)
	status_label.size = Vector2(310, 30)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(status_label)
	var actions: HBoxContainer = HBoxContainer.new()
	actions.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	actions.offset_left = 54
	actions.offset_right = -54
	actions.offset_top = -181
	actions.offset_bottom = -135
	actions.add_theme_constant_override("separation", 10)
	root.add_child(actions)
	var all_button: Button = _button("全体展示", Vector2(128, 42))
	all_button.pressed.connect(return_to_gallery)
	actions.add_child(all_button)
	animation_button = _button("暂停游动", Vector2(128, 42))
	animation_button.pressed.connect(toggle_animation)
	actions.add_child(animation_button)
	var squish_button: Button = _button("捏一下 ♡", Vector2(128, 42))
	squish_button.pressed.connect(trigger_squish)
	actions.add_child(squish_button)
	plush_button = _button("毛绒质感：开", Vector2(154, 42))
	plush_button.pressed.connect(toggle_plush)
	actions.add_child(plush_button)
	var spacer: Control = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	actions.add_child(spacer)
	var hint: Label = _label("选中角色后：拖动旋转  ·  滚轮缩放  ·  Esc 返回", 13, MUTED)
	actions.add_child(hint)
	var cards: HBoxContainer = HBoxContainer.new()
	cards.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	cards.offset_left = 54
	cards.offset_right = -54
	cards.offset_top = -117
	cards.offset_bottom = -37
	cards.add_theme_constant_override("separation", 12)
	root.add_child(cards)
	for i: int in range(character_count):
		var card: Button = _button("", Vector2(174, 78))
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.pressed.connect(select_character.bind(i))
		cards.add_child(card)
		card_buttons.append(card)
		var lines: VBoxContainer = VBoxContainer.new()
		lines.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		lines.offset_left = 17
		lines.offset_top = 14
		lines.mouse_filter = Control.MOUSE_FILTER_IGNORE
		card.add_child(lines)
		lines.add_child(_label("0%d  %s" % [i + 1, NAMES[i]], 18, CREAM))
		lines.add_child(_label(TAGS[i], 10, MUTED))
	detail_panel = PanelContainer.new()
	detail_panel.position = Vector2(54, 166)
	detail_panel.size = Vector2(275, 245)
	detail_panel.add_theme_stylebox_override("panel", _style(Color(0.035, 0.15, 0.19, 0.94), Color(0.55, 0.75, 0.74, 0.3)))
	root.add_child(detail_panel)
	var detail: VBoxContainer = VBoxContainer.new()
	detail.add_theme_constant_override("separation", 13)
	detail_panel.add_child(detail)
	detail_title = _label("", 30, CREAM)
	detail_tag = _label("", 11, MUTED)
	detail_body = _label("", 16, MUTED)
	detail.add_child(detail_title)
	detail.add_child(detail_tag)
	detail.add_child(detail_body)
	detail.add_child(_label("拖动看看它  ·  试着捏一下", 13, CREAM))
	detail_panel.hide()

func _label(content: String, font_size: int, color: Color) -> Label:
	var label: Label = Label.new()
	label.text = content
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_override("font", ui_font)
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	return label

func _style(color: Color, border: Color) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(16)
	style.content_margin_left = 20
	style.content_margin_right = 20
	style.content_margin_top = 17
	style.content_margin_bottom = 17
	return style

func _button(content: String, minimum: Vector2) -> Button:
	var button: Button = Button.new()
	button.text = content
	button.custom_minimum_size = minimum
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", ui_font)
	button.add_theme_font_size_override("font_size", 14)
	button.add_theme_color_override("font_color", CREAM)
	button.add_theme_stylebox_override("normal", _style(Color(0.08, 0.24, 0.28, 0.92), Color(0.53, 0.73, 0.72, 0.3)))
	button.add_theme_stylebox_override("hover", _style(Color(0.15, 0.34, 0.37, 0.97), Color(0.75, 0.87, 0.8, 0.7)))
	button.add_theme_stylebox_override("pressed", _style(Color(0.19, 0.39, 0.4, 0.98), Color("e6dbb9")))
	return button

func select_character(index: int) -> void:
	if index < 0 or index >= characters.size():
		return
	selected_index = index
	detail_title.text = NAMES[index]
	detail_tag.text = TAGS[index]
	detail_body.text = NOTES[index]
	detail_panel.show()
	status_label.text = "角色预览  ·  0%d / 06" % (index + 1)
	var target: Vector3 = characters[index].position + Vector3(0, 0.05, 0)
	_move_camera(target + Vector3(0, 1.7, 6.7), target, 4.5)
	for i: int in range(card_buttons.size()):
		card_buttons[i].modulate = Color.WHITE if i == index else Color(0.72, 0.83, 0.84, 1)
		characters[i].visible = i == index
	for i: int in range(pedestal_meshes.size()):
		pedestal_meshes[i].visible = (i >> 1) == index

func return_to_gallery() -> void:
	selected_index = -1
	drag_active = false
	detail_panel.hide()
	status_label.text = "全体展示  ·  6 位海洋伙伴"
	_move_camera(Vector3(0, 7.7, 17.0), Vector3(0, 0.75, 0), 9.8)
	for i: int in range(characters.size()):
		characters[i].rotation.y = YAWS[i]
		characters[i].visible = true
		card_buttons[i].modulate = Color.WHITE
	for pedestal: MeshInstance3D in pedestal_meshes:
		pedestal.visible = true

func _move_camera(at: Vector3, target: Vector3, size: float) -> void:
	if camera_tween != null and camera_tween.is_running():
		camera_tween.kill()
	camera_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	camera_tween.tween_property(camera, "position", at, 0.55)
	camera_tween.tween_property(camera, "size", size, 0.55)
	camera_tween.tween_property(self, "camera_target", target, 0.55)

func trigger_squish() -> void:
	if selected_index >= 0:
		characters[selected_index].call("squish")
	else:
		for creature: Node3D in characters:
			creature.call("squish")

func toggle_animation() -> void:
	animation_enabled = not animation_enabled
	animation_button.text = "暂停游动" if animation_enabled else "继续游动"
	for creature: Node3D in characters:
		creature.call("set_motion", animation_enabled)

func toggle_plush() -> void:
	plush_enabled = not plush_enabled
	plush_button.text = "毛绒质感：开" if plush_enabled else "毛绒质感：关"
	for creature: Node3D in characters:
		creature.call("set_plush_amount", 1.0 if plush_enabled else 0.0)

func _process(delta: float) -> void:
	if camera != null:
		camera.look_at(camera_target)
	if not animation_enabled:
		return
	elapsed += delta
	for i: int in range(bubbles.size()):
		var origin: Vector3 = bubble_origins[i]
		bubbles[i].position = Vector3(origin.x + sin(elapsed * 0.3 + i) * 0.15, fmod(origin.y + elapsed * 0.12, 6.0), origin.z)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			return_to_gallery()
		elif event.keycode >= KEY_1 and event.keycode <= KEY_6:
			select_character(int(event.keycode - KEY_1))
	if selected_index < 0:
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			drag_active = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.size = maxf(2.8, camera.size - 0.35)
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.size = minf(8.0, camera.size + 0.35)
	if event is InputEventMouseMotion and drag_active:
		characters[selected_index].rotation.y += event.relative.x * 0.012

func get_showroom_state() -> Dictionary:
	return {"character_count": character_count, "selected_index": selected_index, "animation_enabled": animation_enabled, "plush_enabled": plush_enabled, "gallery_ready": gallery_ready}
