@tool
extends RefCounted

# Deliberately NOT ResourceLoader, ConfigFile, str_to_var or an eval path.
# Only scalar/container values and these inert native constructors can be read.
const Files = preload("res://addons/wheel_mcp/png_texture.gd")
const Animations = preload("res://addons/wheel_mcp/animation_service.gd")

class Reader extends RefCounted:
	var tokens: Array[String] = []
	var cursor := 0
	var failed := false

	func peek() -> String:
		return tokens[cursor] if cursor < tokens.size() else ""

	func take(wanted: String) -> bool:
		if peek() != wanted:
			failed = true
			return false
		cursor += 1
		return true

	func lines() -> void:
		while peek() == "\n": cursor += 1

	func value(depth: int = 0) -> Variant:
		lines()
		if failed or depth > 8 or peek().is_empty():
			failed = true
			return null
		var token := peek()
		cursor += 1
		if token.begins_with("\""):
			var parsed: Variant = JSON.parse_string(token)
			if not parsed is String or parsed.length() > 512: failed = true
			return parsed
		if token == "true": return true
		if token == "false": return false
		if token.is_valid_float():
			var number := token.to_float()
			if not is_finite(number) or absf(number) > 1000000.0: failed = true
			return number
		if token == "{":
			var result: Dictionary = {}
			lines()
			while not failed and peek() != "}":
				var key: Variant = value(depth + 1)
				if not key is String or result.has(key) or result.size() >= 8 or not take(":"):
					failed = true
					return null
				result[key] = value(depth + 1)
				lines()
				if peek() != "}": take(",")
				lines()
			take("}")
			return result
		var constructors := ["Vector2", "Vector3", "NodePath", "PackedFloat32Array", "PackedStringArray"]
		if token != "[" and token not in constructors:
			failed = true
			return null
		if token != "[" and not take("("): return null
		var end := "]" if token == "[" else ")"
		var args: Array = []
		lines()
		while not failed and peek() != end:
			if args.size() >= 32:
				failed = true
				return null
			args.append(value(depth + 1))
			lines()
			if peek() != end: take(",")
			lines()
		take(end)
		if token == "[": return args
		if token == "NodePath" and args.size() == 1 and args[0] is String: return NodePath(args[0])
		if token == "PackedStringArray" and args.all(func(v): return v is String): return PackedStringArray(args)
		if not args.all(func(v): return v is float):
			failed = true
			return null
		if token == "Vector2" and args.size() == 2: return Vector2(args[0], args[1])
		if token == "Vector3" and args.size() == 3: return Vector3(args[0], args[1], args[2])
		if token == "PackedFloat32Array": return PackedFloat32Array(args)
		failed = true
		return null

static func _error(message: String, code: String = "UNSUPPORTED") -> Dictionary:
	return {"status":"FAIL", "code":code, "message":message, "persisted":false}

static func source_file(raw: Variant, expected: Variant) -> Dictionary:
	if not raw is String or not expected is String or expected.length() != 64 or not expected.is_valid_hex_number(false) or raw.length() > 512 or not raw.begins_with("res://") or not raw.ends_with(".tres"):
		return _error("Expected a fingerprinted project Animation .tres", "INVALID_ARGUMENT")
	var parent := "res://"
	for index in range(raw.length()):
		var codepoint: int = raw.unicode_at(index)
		if codepoint < 32 or codepoint == 127: return _error("Unsafe animation source path", "FORBIDDEN")
	for part in raw.substr(6).split("/"):
		if part.is_empty() or part in [".", ".."] or part.to_lower() in [".git", ".godot", ".harness"] or ":" in part or "\\" in part or part.ends_with(" ") or part.ends_with("."):
			return _error("Unsafe animation source path", "FORBIDDEN")
		var directory := DirAccess.open(parent)
		if directory == null or directory.is_link(part): return _error("Linked animation source path", "FORBIDDEN")
		parent = parent.path_join(part)
	var file := FileAccess.open(raw, FileAccess.READ)
	if file == null: return _error("Animation source is missing", "NOT_FOUND")
	if file.get_length() > 16384: return _error("Animation source exceeds 16 KiB")
	var bytes := file.get_buffer(file.get_length())
	file.close()
	if Files.sha(bytes) != expected or FileAccess.get_sha256(raw) != expected: return _error("Animation source changed", "CONFLICT")
	return {"bytes":bytes}

static func parse_text(text: String, clip_id: String, targets: Dictionary) -> Dictionary:
	var header := RegEx.new()
	header.compile("^\\[gd_resource type=\"Animation\" format=3( uid=\"uid://[A-Za-z0-9_]+\")?\\]$")
	var input := text.replace("\r\n", "\n").strip_edges().split("\n")
	if input.size() < 3 or header.search(input[0]) == null: return _error("Only standalone native Animation format 3 is declared")
	var body := "\n".join(input.slice(1)).strip_edges()
	if not body.begins_with("[resource]\n"): return _error("Animation requires exactly one resource section")
	body = body.substr("[resource]\n".length())
	var expression := RegEx.new()
	expression.compile("\"(?:[^\"\\\\\\n]|\\\\.)*\"|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_/]*|[\\[\\]{}(),:=]")
	var reader := Reader.new()
	var offset := 0
	while offset < body.length():
		var character := body.substr(offset, 1)
		if character in [" ", "\t", "\r"]:
			offset += 1
			continue
		if character == ";":
			while offset < body.length() and body.substr(offset, 1) != "\n": offset += 1
			continue
		if character == "\n":
			reader.tokens.append("\n")
			offset += 1
			continue
		var matched := expression.search(body, offset)
		if matched == null or matched.get_start() != offset or reader.tokens.size() >= 4096: return _error("Animation syntax/token budget is outside subset")
		reader.tokens.append(matched.get_string())
		offset = matched.get_end()
	var fields: Dictionary = {}
	reader.lines()
	while not reader.peek().is_empty() and not reader.failed:
		var key := reader.peek()
		reader.cursor += 1
		if fields.has(key) or fields.size() >= 64 or not reader.take("="): return _error("Duplicate or invalid animation field")
		fields[key] = reader.value()
		if not reader.peek().is_empty() and reader.peek() != "\n": return _error("Animation assignments require separate lines")
		reader.lines()
	if reader.failed: return _error("Animation contains an undeclared value or constructor")
	var tracks: Array = []
	var indexes: Dictionary = {}
	for key in fields:
		if key in ["resource_name", "length", "loop_mode", "step", "resource_local_to_scene", "capture_included", "metadata/wheel_track_ids"]: continue
		var pieces: PackedStringArray = key.split("/")
		if pieces.size() != 3 or pieces[0] != "tracks" or pieces[1] not in ["0", "1", "2", "3", "4", "5", "6", "7"] or pieces[2] not in ["type", "imported", "enabled", "path", "interp", "loop_wrap", "keys"]:
			return _error("Unknown animation field or track type")
		indexes[int(pieces[1])] = true
	if indexes.is_empty(): return _error("Animation requires 1..8 tracks")
	if fields.has("resource_name") and not fields.resource_name is String: return _error("Invalid resource name")
	for setting in ["resource_local_to_scene", "capture_included"]:
		if not fields.get(setting, false) is bool or fields.get(setting, false): return _error("Source locality/capture policy is outside subset")
	if fields.has("step") and (not fields.step is float or absf(fields.step - 1.0 / 30.0) > 0.000001): return _error("Nondefault animation step is outside subset")
	if fields.has("metadata/wheel_track_ids") and (not fields["metadata/wheel_track_ids"] is PackedStringArray or fields["metadata/wheel_track_ids"].size() != indexes.size()): return _error("Invalid source track metadata")
	var used: Dictionary = {}
	for index in range(indexes.size()):
		if not indexes.has(index): return _error("Animation track indexes must be contiguous")
		var prefix := "tracks/%d/" % index
		if fields.get(prefix + "type") != "value" or not fields.get(prefix + "enabled", true) is bool or not fields.get(prefix + "enabled", true) or not fields.get(prefix + "interp", 1.0) is float or fields.get(prefix + "interp", 1.0) != 1.0 or not fields.get(prefix + "loop_wrap", true) is bool or not fields.get(prefix + "loop_wrap", true) or not fields.get(prefix + "imported", false) is bool:
			return _error("Only enabled linear value tracks are declared for source copying")
		var path: Variant = fields.get(prefix + "path")
		if not path is NodePath or path.is_absolute() or path.get_subname_count() != 1: return _error("Source requires a local transform property path")
		var origin := str(path.get_concatenated_names())
		if origin.is_empty() or origin.length() > 128 or "\\" in origin or "%" in origin or "//" in origin: return _error("Invalid source node path")
		for part in origin.split("/"):
			if (part in [".", ".."] and origin != ".") or part.is_empty(): return _error("Noncanonical source node path")
		var property := str(path.get_subname(0))
		if property not in ["position", "rotation", "scale"] or not targets.get(origin) is String: return _error("Missing explicit source target mapping or unsupported property")
		used[origin] = true
		var keys: Variant = fields.get(prefix + "keys")
		if not keys is Dictionary or keys.size() != 4 or not keys.get("update") is float or keys.get("update") != 0.0 or not keys.get("times") is PackedFloat32Array or not keys.get("transitions") is PackedFloat32Array or not keys.get("values") is Array:
			return _error("Source key structure is outside bounded native value format")
		if keys.times.is_empty() or keys.times.size() > 32 or keys.transitions.size() != keys.times.size() or keys.values.size() != keys.times.size(): return _error("Source key counts differ")
		var frames: Array = []
		for ki in range(keys.times.size()):
			if keys.transitions[ki] != 1.0: return _error("Source easing is outside subset")
			var value: Variant = keys.values[ki]
			if not Animations._bounded_value(property, value): return _error("Source transform value is outside subset")
			var encoded: Variant = value
			if value is Vector2: encoded = {"x":float(value.x), "y":float(value.y)}
			if value is Vector3: encoded = {"x":float(value.x), "y":float(value.y), "z":float(value.z)}
			frames.append({"time":float(keys.times[ki]), "value":encoded})
		tracks.append({"id":"track_%d" % index, "target":targets[origin], "property":property, "keys":frames})
	if used.size() != targets.size(): return _error("Unused source target mapping")
	var length: Variant = fields.get("length", 1.0)
	var loop_mode: Variant = fields.get("loop_mode", 0.0)
	if not length is float or not loop_mode is float or loop_mode not in [0.0, 1.0]: return _error("Unsupported source length/loop")
	return {"clips":[{"id":clip_id, "length":length, "loop":loop_mode == 1.0, "tracks":tracks}]}

static func read(request: Dictionary) -> Dictionary:
	var source := source_file(request.get("sourcePath"), request.get("sourceHash"))
	if source.has("code"): return source
	var text: String = source.bytes.get_string_from_utf8()
	if text.to_utf8_buffer() != source.bytes: return _error("Animation source must be UTF-8")
	if not Animations._id(request.get("clipId")) or not request.get("targets") is Dictionary or request.targets.is_empty() or request.targets.size() > 8: return _error("Invalid animation copy identity/mapping", "INVALID_ARGUMENT")
	var parsed := parse_text(text, request.clipId, request.targets)
	if parsed.has("code"): return parsed
	if FileAccess.get_sha256(request.sourcePath) != request.sourceHash: return _error("Animation source changed while parsing", "CONFLICT")
	return parsed
