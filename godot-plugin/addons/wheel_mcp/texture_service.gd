@tool
extends RefCounted

# A closed native resource graph, not a loader for arbitrary project images.
static func error(message: String, code: String = "UNSUPPORTED") -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

static func color_valid(value: Color) -> bool:
	for channel in [value.r, value.g, value.b, value.a]:
		if not is_finite(channel) or channel < 0 or channel > 1: return false
	return true

static func storage(texture: GradientTexture2D) -> Dictionary:
	if texture.get_script() != null or texture.width < 1 or texture.width > 32 or texture.height < 1 or texture.height > 32 or texture.use_hdr or texture.fill != 0 or texture.repeat != 0 or texture.fill_from != Vector2.ZERO or texture.fill_to != Vector2(1, 0): return error("Only a bounded 1..32 linear horizontal LDR gradient texture is declared")
	var gradient := texture.gradient
	if gradient == null or gradient.get_class() != "Gradient" or gradient.get_script() != null or gradient.get_point_count() != 2 or gradient.offsets != PackedFloat32Array([0, 1]) or gradient.interpolation_mode != 0 or gradient.interpolation_color_space != 0: return error("Texture requires exactly two native linear sRGB gradient stops")
	for color in gradient.colors:
		if not color_valid(color): return error("Gradient colors must be finite 0..1")
	var result: Dictionary = {}
	for resource in [texture, gradient]:
		var fields: Dictionary = {}
		for info in resource.get_property_list():
			if not (int(info.usage) & PROPERTY_USAGE_STORAGE): continue
			if str(info.name).begins_with("metadata/") or fields.size() >= 24: return error("Texture metadata or expanded storage graph is not declared")
			var value: Variant = resource.get(info.name)
			if resource == texture and str(info.name) == "gradient": continue # Inspected in full below.
			if value is Object or value is Array or value is Dictionary: return error("Texture/gradient contains an opaque resource dependency")
			if value is String and value.length() > 512: return error("Texture storage string exceeds budget")
			fields[str(info.name)] = var_to_bytes(value).hex_encode()
		result["texture" if resource == texture else "gradient"] = fields
	return {"storage": result}

static func create(source: Variant) -> Dictionary:
	if not source is Dictionary or source.size() != 4 or source.get("format") != "linear-gradient" or not source.get("colors") is Array or source.colors.size() != 2: return error("Expected a bounded linear-gradient source", "INVALID_ARGUMENT")
	for dimension in [source.get("width"), source.get("height")]:
		if typeof(dimension) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(dimension) or dimension != floor(dimension) or dimension < 1 or dimension > 32: return error("Texture dimensions must be integers 1..32", "INVALID_ARGUMENT")
	var colors := PackedColorArray()
	for raw in source.colors:
		if not raw is Dictionary or raw.size() != 5 or raw.get("type") != "Color": return error("Expected explicit Color stops", "INVALID_ARGUMENT")
		for name in ["r", "g", "b", "a"]:
			if typeof(raw.get(name)) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(raw[name]) or raw[name] < 0 or raw[name] > 1: return error("Color channels must be finite 0..1", "INVALID_ARGUMENT")
		colors.append(Color(raw.r, raw.g, raw.b, raw.a))
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array([0, 1])
	gradient.colors = colors
	gradient.interpolation_mode = 0
	gradient.interpolation_color_space = 0
	var texture := GradientTexture2D.new()
	texture.width = int(source.width)
	texture.height = int(source.height)
	texture.fill_from = Vector2.ZERO
	texture.fill_to = Vector2(1, 0)
	texture.gradient = gradient
	var checked := storage(texture)
	return checked if checked.has("code") else {"resource": texture}

static func properties(texture: GradientTexture2D) -> Dictionary:
	var colors: Array = []
	for color in texture.gradient.colors:
		colors.append({"type": "Color", "r": color.r, "g": color.g, "b": color.b, "a": color.a})
	return {"format": "linear-gradient", "width": texture.width, "height": texture.height, "colors": colors}
