@tool
extends RefCounted
const FIELDS := ["collision_layer", "collision_mask", "motion_mode", "safe_margin", "max_slides", "floor_snap_length"]
const STORED := ["collision_layer", "collision_mask", "motion_mode", "safe_margin", "max_slides", "floor_snap_length", "up_direction", "floor_stop_on_slope", "floor_constant_speed", "floor_block_on_wall", "floor_max_angle", "slide_on_ceiling", "wall_min_slide_angle", "platform_floor_layers", "platform_wall_layers", "platform_on_leave"]

static func error(code: String, message: String) -> Dictionary:
	return {"status":"FAIL", "code":code, "message":message, "persisted":false}

static func validate(node: CharacterBody2D) -> Dictionary:
	if node.get_script() != null or node.material != null or node.use_parent_material: return error("UNSUPPORTED", "Character requires native script-free configuration without material")
	# A zero authored velocity cannot silently become an autonomous controller.
	if node.velocity != Vector2.ZERO: return error("CONFLICT", "Character velocity is runtime state, not an authored movement command")
	for field in FIELDS:
		var checked := check_value(field, node.get(field))
		if checked.has("code"): return checked
	for signal_name in ["item_rect_changed", "draw"]:
		if not node.get_signal_connection_list(signal_name).is_empty(): return error("CONFLICT", "Character drawing/geometry callbacks require a separate policy")
	return {}

static func signature(node: CharacterBody2D) -> Dictionary:
	var result: Dictionary = {}
	for field in STORED: result[field] = var_to_bytes(node.get(field)).hex_encode()
	return result

static func apply(node: CharacterBody2D, values: Dictionary) -> void:
	var blocked := node.is_blocking_signals()
	node.set_block_signals(true)
	for field in values: node.set(field, values[field])
	node.set_block_signals(blocked)

static func check_value(field: String, raw: Variant) -> Dictionary:
	var value: Variant = raw
	if not (value is int or value is float) or not is_finite(float(value)): return error("INVALID_ARGUMENT", "Character fields require finite numbers")
	if field in ["collision_layer", "collision_mask", "motion_mode", "max_slides"]:
		if value != floor(value): return error("INVALID_ARGUMENT", "Character integer field requires an integer")
		value = int(value)
	else: value = float(value)
	if field in ["collision_layer", "collision_mask"] and (value < 0 or value > 4294967295): return error("INVALID_ARGUMENT", "Character layer/mask must be uint32")
	if field == "motion_mode" and value not in [0, 1]: return error("INVALID_ARGUMENT", "Character motion mode must be grounded or floating")
	if field == "max_slides" and (value < 1 or value > 8): return error("INVALID_ARGUMENT", "Character slide budget is 1..8")
	if field == "safe_margin" and (value < 0.001 or value > 10): return error("INVALID_ARGUMENT", "Character safe margin outside budget")
	if field == "floor_snap_length" and (value < 0 or value > 100): return error("INVALID_ARGUMENT", "Character floor snap outside budget")
	return {"value":value}

static func prepare(node: Node, values: Variant) -> Dictionary:
	if not node is CharacterBody2D: return error("UNSUPPORTED", "Character fields require CharacterBody2D")
	if not values is Dictionary or values.is_empty() or values.size() > 6: return error("INVALID_ARGUMENT", "Expected 1..6 character fields")
	var before: Dictionary = {}
	var after: Dictionary = {}
	for field in values:
		if field not in FIELDS: return error("UNSUPPORTED", "Undeclared character field")
		var checked := check_value(field, values[field])
		if checked.has("code"): return checked
		before[field] = node.get(field)
		after[field] = checked.value
	apply(node, after)
	for field in after:
		if node.get(field) != after[field]: return error("INVALID_ARGUMENT", "Character value normalized by engine")
	return {"before":before, "after":after}
