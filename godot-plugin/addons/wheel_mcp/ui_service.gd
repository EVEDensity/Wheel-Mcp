@tool
extends RefCounted
const UITheme = preload("res://addons/wheel_mcp/ui_theme.gd")
const Textures = preload("res://addons/wheel_mcp/texture_service.gd")

const CLASSES := ["Button", "CheckButton", "HSlider", "LineEdit", "ScrollContainer", "RichTextLabel", "TextureRect", "PanelContainer", "MarginContainer", "VBoxContainer", "HBoxContainer", "GridContainer"]
const FIELDS := ["anchor_left", "anchor_top", "anchor_right", "anchor_bottom", "offset_left", "offset_top", "offset_right", "offset_bottom", "grow_horizontal", "grow_vertical", "custom_minimum_size", "size_flags_horizontal", "size_flags_vertical", "size_flags_stretch_ratio", "text", "placeholder_text", "editable", "max_length", "horizontal_scroll_mode", "vertical_scroll_mode", "follow_focus", "fit_content", "scroll_active", "expand_mode", "stretch_mode", "flip_h", "flip_v", "accessibility_name", "accessibility_description", "tooltip_text", "focus_mode", "mouse_filter", "autowrap_mode", "columns", "min_value", "max_value", "step", "value", "disabled", "button_pressed"]
const LAYOUT := ["anchor_left", "anchor_top", "anchor_right", "anchor_bottom", "offset_left", "offset_top", "offset_right", "offset_bottom"]

static func managed(node: Node) -> bool:
	return node is Control and node.get_parent() is Container

# This first texture subset has no external image/dependency CAS grammar.
# Embed an explicit unique copy rather than saving a live external reference.
static func inline_texture(node: TextureRect, root: Node) -> bool:
	if node.texture == null: return true
	if not node.texture is GradientTexture2D or node.texture.get_script() != null: return false
	for resource in [node.texture, node.texture.gradient]:
		if resource == null or resource.get_script() != null: return false
		if not resource.resource_path.is_empty() and not resource.resource_path.begins_with(root.scene_file_path + "::"): return false
	return true

# Container-owned geometry is derived, not a stable authored offset.
static func derived(node: Node, property: String) -> bool:
	return (managed(node) and (property.begins_with("offset_") or property == "layout_mode")) or (node is ScrollContainer and property in ["scroll_horizontal", "scroll_vertical"])

static func error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

static func line_edit_callbacks(node: LineEdit) -> bool:
	for signal_name in ["text_changed", "text_change_rejected", "text_submitted", "editing_toggled"]:
		if not node.get_signal_connection_list(signal_name).is_empty(): return true
	return false

static func scroll_callbacks(node: ScrollContainer) -> bool:
	for signal_name in ["scroll_started", "scroll_ended"]:
		if not node.get_signal_connection_list(signal_name).is_empty(): return true
	for bar in [node.get_h_scroll_bar(), node.get_v_scroll_bar()]:
		if not is_instance_valid(bar) or bar.get_parent() != node or bar.get_script() != null: return true
		if not bar.get_signal_connection_list("changed").is_empty(): return true
		var connections: Array = bar.get_signal_connection_list("value_changed")
		if connections.size() != 1: return true # Required constructor connection must still exist.
		for connection in connections:
			# Godot 4.7.2's constructor uses a native method-pointer callable to
			# this ScrollContainer. No user callback/bind/flags are part of it.
			var callback: Callable = connection.callable
			if callback.get_object() != node or not callback.is_custom() or str(callback.get_method()) != "ScrollContainer::_scroll_moved" or int(connection.flags) != 0 or callback.get_bound_arguments_count() != 0 or callback.get_unbound_arguments_count() != 0: return true
	return false

# Plain declarative text only. BBCode/threads/effects/selection and live tag
# stacks have no resource, callback or persistence contract in this subset.
static func rich_text_unsafe(node: RichTextLabel) -> bool:
	if node.bbcode_enabled or node.threaded or not node.custom_effects.is_empty() or node.selection_enabled or node.context_menu_enabled or node.scroll_following or node.scroll_following_visible_characters: return true
	if node.text.length() > 512 or node.get_parsed_text() != node.text: return true
	for signal_name in ["finished", "meta_clicked", "meta_hover_started", "meta_hover_ended"]:
		if not node.get_signal_connection_list(signal_name).is_empty(): return true
	var bar := node.get_v_scroll_bar()
	if not is_instance_valid(bar) or bar.get_parent() != node or bar.get_script() != null or not bar.get_signal_connection_list("changed").is_empty(): return true
	var children := node.get_children(true)
	# Godot 4.7.2 constructs one native bar and a selection Timer. Neither is
	# authored content; no extra leaf children or substituted callbacks allowed.
	if children.size() != 2: return true
	for child in children:
		if child.get_script() != null: return true
		var signal_name := "value_changed" if child == bar else "timeout"
		var expected := "RichTextLabel::_scroll_changed" if child == bar else "RichTextLabel::_update_selection"
		if child != bar and not child is Timer: return true
		var connections: Array = child.get_signal_connection_list(signal_name)
		if connections.size() != 1: return true
		var callback: Callable = connections[0].callable
		if callback.get_object() != node or not callback.is_custom() or str(callback.get_method()) != expected or int(connections[0].flags) != 0 or callback.get_bound_arguments_count() != 0 or callback.get_unbound_arguments_count() != 0: return true
	return false

static func signature(node: Control) -> Dictionary:
	var result: Dictionary = {}
	for field in FIELDS:
		if field in node and not derived(node, field): result[field] = var_to_bytes(node.get(field)).hex_encode()
	if node.theme != null: result["theme"] = UITheme.storage(node.theme)
	if node is TextureRect and node.texture != null:
		result["texture"] = Textures.storage(node.texture) if node.texture is GradientTexture2D else {"code": "UNSUPPORTED"}
	return result

static func apply(node: Control, values: Dictionary) -> void:
	# Authoring is not user input. Prevent callbacks introduced after preview or
	# before Undo from running during the exact native document operation.
	var blocked := node.is_blocking_signals()
	if node is LineEdit or node is RichTextLabel: node.set_block_signals(true)
	var text_limit: int = node.max_length if node is LineEdit else 0
	if node is LineEdit and (values.has("text") or values.has("max_length")):
		node.max_length = 0
	# Native anchor setters must not silently move another authored offset.
	for index in range(4):
		var field: String = ["anchor_left", "anchor_top", "anchor_right", "anchor_bottom"][index]
		if values.has(field): node.set_anchor(index, values[field], false, false)
	for field in values:
		if node is LineEdit and field == "max_length": continue
		if not field.begins_with("anchor_"): node.set(field, values[field])
	if node is LineEdit:
		if values.has("text") or values.has("max_length"): node.max_length = values.get("max_length", text_limit)
	if node is LineEdit or node is RichTextLabel:
		node.set_block_signals(blocked)

static func prepare(node: Node, values: Variant) -> Dictionary:
	if not node is Control or not values is Dictionary or values.is_empty() or values.size() > 16: return error("INVALID_ARGUMENT", "UI batch requires a Control and 1..16 properties")
	var decoded: Dictionary = {}
	var before: Dictionary = {}
	for field in values:
		if field not in FIELDS or field not in node: return error("UNSUPPORTED", "UI property not available for declared class")
		if field in ["placeholder_text", "editable", "max_length"] and not node is LineEdit: return error("UNSUPPORTED", "Text input fields require LineEdit")
		if field in ["horizontal_scroll_mode", "vertical_scroll_mode", "follow_focus"] and not node is ScrollContainer: return error("UNSUPPORTED", "Scroll fields require ScrollContainer")
		if field in ["fit_content", "scroll_active"] and not node is RichTextLabel: return error("UNSUPPORTED", "Plain display fields require RichTextLabel")
		if field in ["expand_mode", "stretch_mode", "flip_h", "flip_v"] and not node is TextureRect: return error("UNSUPPORTED", "Texture layout fields require TextureRect")
		if managed(node) and field in LAYOUT: return error("CONFLICT", "Container owns child anchors/offsets; use minimum sizes and size flags")
		if field.begins_with("anchor_") and values[field] != 0 and node.get_parent() is CanvasItem and not node.get_parent() is Control: return error("CONFLICT", "Responsive UI anchors require a Control parent or top-level UI root, not Node2D")
		var expected: Variant = node.get(field)
		var value: Variant = values[field]
		if expected is int and value is float and is_finite(value) and value == floor(value): value = int(value)
		if value is Dictionary and value.size() == 3 and value.get("type") == "Vector2" and value.get("x") is float and value.get("y") is float: value = Vector2(value.x, value.y)
		if typeof(value) != typeof(expected): return error("INVALID_ARGUMENT", "UI property type mismatch")
		if value is String and value.length() > (128 if field == "accessibility_name" else 512): return error("INVALID_ARGUMENT", "UI text exceeds budget")
		if node is LineEdit and field in ["text", "placeholder_text"]:
			for index in range(value.length()):
				if value.unicode_at(index) < 32 or value.unicode_at(index) == 127: return error("INVALID_ARGUMENT", "LineEdit text must be single-line without control characters")
		if field == "max_length" and (value < 0 or value > 512): return error("INVALID_ARGUMENT", "LineEdit maximum length must be 0..512")
		if field in ["horizontal_scroll_mode", "vertical_scroll_mode"] and (value < 0 or value > 4): return error("INVALID_ARGUMENT", "Declared scroll modes must be 0..4")
		if value is float and (not is_finite(value) or absf(value) > 100000): return error("INVALID_ARGUMENT", "UI coordinate outside budget")
		if field.begins_with("anchor_") and (value < 0 or value > 1): return error("INVALID_ARGUMENT", "Anchors must be 0..1")
		if value is Vector2 and (not value.is_finite() or value.x < 0 or value.y < 0 or value.x > 100000 or value.y > 100000): return error("INVALID_ARGUMENT", "Invalid minimum size")
		if field in ["size_flags_horizontal", "size_flags_vertical"] and (value < 0 or value > 15 or (value & 4 and value & 8)): return error("INVALID_ARGUMENT", "Invalid size flags")
		if field in ["focus_mode", "mouse_filter", "grow_horizontal", "grow_vertical"] and (value < 0 or value > 2): return error("INVALID_ARGUMENT", "Invalid UI mode")
		if field == "autowrap_mode" and (value < 0 or value > 3): return error("INVALID_ARGUMENT", "Invalid wrap mode")
		if field == "expand_mode" and (value < 0 or value > 1): return error("INVALID_ARGUMENT", "Only stable expand modes 0..1 declared")
		if field == "stretch_mode" and (value < 0 or value > 6): return error("INVALID_ARGUMENT", "Stretch modes must be 0..6")
		if field == "columns" and (value < 1 or value > 12): return error("INVALID_ARGUMENT", "Grid columns must be 1..12")
		if field in ["step", "size_flags_stretch_ratio"] and value <= 0: return error("INVALID_ARGUMENT", "Positive UI step/stretch required")
		if field == "size_flags_stretch_ratio" and value > 1000: return error("INVALID_ARGUMENT", "UI stretch exceeds budget")
		if field == "button_pressed" and (not node is CheckButton or not node.get_signal_connection_list("toggled").is_empty()): return error("CONFLICT", "Button state with callbacks needs a separate policy")
		if node is Range and field in ["min_value", "max_value", "step", "value"] and not node.get_signal_connection_list("value_changed").is_empty(): return error("CONFLICT", "Disconnect range callbacks before value authoring")
		before[field] = expected
		decoded[field] = value
	if not managed(node):
		for field in LAYOUT: before[field] = node.get(field)
	if node is Range and decoded.get("max_value", node.max_value) < decoded.get("min_value", node.min_value): return error("INVALID_ARGUMENT", "Range maximum is below minimum")
	if node is LineEdit:
		if line_edit_callbacks(node): return error("CONFLICT", "LineEdit callbacks require a separate policy")
		var limit: int = decoded.get("max_length", node.max_length)
		var final_text: String = decoded.get("text", node.text)
		if limit > 0 and final_text.length() > limit: return error("INVALID_ARGUMENT", "LineEdit text exceeds maximum length; truncation is not implicit")
		if decoded.has("text") or decoded.has("max_length"):
			before["text"] = node.text
			before["max_length"] = node.max_length
	apply(node, decoded)
	for field in decoded:
		if node.get(field) != decoded[field] and not (decoded[field] is float and node.get(field) == float(PackedFloat32Array([decoded[field]])[0])): return error("INVALID_ARGUMENT", "UI value normalized by engine")
	var after: Dictionary = {}
	for field in before: after[field] = node.get(field)
	return {"before": before, "after": after}
