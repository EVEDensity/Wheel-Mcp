@tool
extends RefCounted
const Textures = preload("res://addons/wheel_mcp/texture_service.gd")
const FIELDS := ["centered", "offset", "flip_h", "flip_v"]
const STORED := ["centered", "offset", "flip_h", "flip_v", "hframes", "vframes", "frame", "region_enabled", "region_rect", "region_filter_clip_enabled", "modulate", "self_modulate", "texture_filter", "texture_repeat", "show_behind_parent", "z_index", "z_as_relative"]

static func error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

static func validate(node: Sprite2D, root: Node) -> Dictionary:
	if node.get_script() != null or node.hframes != 1 or node.vframes != 1 or node.frame != 0 or node.region_enabled or node.region_rect != Rect2() or node.region_filter_clip_enabled or node.material != null or node.use_parent_material: return error("UNSUPPORTED", "Sprite requires a single frame without region/material dependencies")
	if not node.offset.is_finite() or node.offset.abs().x > 100000 or node.offset.abs().y > 100000: return error("UNSUPPORTED", "Sprite offset outside declared budget")
	for signal_name in ["texture_changed", "frame_changed", "item_rect_changed", "draw"]:
		if not node.get_signal_connection_list(signal_name).is_empty(): return error("CONFLICT", "Sprite drawing/texture callbacks require a separate policy")
	if not Textures.inline_texture(node.texture, root): return error("CONFLICT", "Sprite requires inline native texture pixels/gradient")
	if node.texture != null:
		var texture := Textures.storage(node.texture)
		if texture.has("code"): return texture
	return {}

static func signature(node: Sprite2D) -> Dictionary:
	var result: Dictionary = {}
	for field in STORED: result[field] = var_to_bytes(node.get(field)).hex_encode()
	if node.texture != null: result["texture"] = Textures.storage(node.texture)
	return result

static func apply(node: Sprite2D, values: Dictionary) -> void:
	var blocked := node.is_blocking_signals()
	node.set_block_signals(true)
	for field in values: node.set(field, values[field])
	node.set_block_signals(blocked)

static func prepare(node: Node, values: Variant) -> Dictionary:
	if not node is Sprite2D: return error("UNSUPPORTED", "Sprite properties require Sprite2D")
	if not values is Dictionary or values.is_empty() or values.size() > 4: return error("INVALID_ARGUMENT", "Expected 1..4 sprite fields")
	var before: Dictionary = {}
	var after: Dictionary = {}
	for field in values:
		if field not in FIELDS: return error("UNSUPPORTED", "Undeclared sprite property")
		var value: Variant = values[field]
		if field == "offset":
			if not value is Dictionary or value.size() != 3 or value.get("type") != "Vector2" or not value.get("x") is float or not value.get("y") is float: return error("INVALID_ARGUMENT", "Sprite offset requires finite Vector2")
			value = Vector2(value.x, value.y)
			if not value.is_finite() or value.abs().x > 100000 or value.abs().y > 100000: return error("INVALID_ARGUMENT", "Sprite offset exceeds budget")
		elif not value is bool: return error("INVALID_ARGUMENT", "Sprite flags require boolean values")
		before[field] = node.get(field)
		after[field] = value
	apply(node, after)
	return {"before": before, "after": after}
