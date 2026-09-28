@tool
extends RefCounted

# Validate the entire declared native dependency grammar BEFORE ResourceLoader.
# No scripts, expressions, signals, subresources, placeholders or imported assets.
const TYPES := ["Node", "Node2D", "Node3D", "Marker2D", "Marker3D", "MeshInstance3D"]

static func _error(code: String, message: String) -> Dictionary:
	return {"code": code, "message": message, "status": "FAIL", "persisted": false}

static func collect(raw: Variant, expected: Variant) -> Dictionary:
	if not raw is String or not expected is String or expected.length() != 64:
		return _error("INVALID_ARGUMENT", "Expected a fingerprinted native scene")
	var hashes: Dictionary = {}
	var visiting: Dictionary = {}
	var failure := _scan(raw, hashes, visiting, 0)
	if failure.has("code"): return failure
	if hashes.get(raw) != expected: return _error("CONFLICT", "Scene dependency fingerprint changed")
	return {"hashes": hashes}

static func _scan(raw: String, hashes: Dictionary, visiting: Dictionary, depth: int) -> Dictionary:
	if visiting.has(raw): return _error("CONFLICT", "Scene dependency cycle")
	if hashes.has(raw): return {}
	if depth > 16 or hashes.size() + visiting.size() >= 32: return _error("UNSUPPORTED", "Scene graph exceeds 16 levels/32 files")
	if not raw.begins_with("res://") or not raw.ends_with(".tscn") or raw.length() > 512:
		return _error("FORBIDDEN", "Only project-local text scene dependencies supported")
	var parent := "res://"
	for part in raw.substr(6).split("/"):
		if part.is_empty() or part in [".", ".."] or part.to_lower() in [".git", ".godot", ".harness"] or ":" in part or "\\" in part or part.ends_with(" ") or part.ends_with("."):
			return _error("FORBIDDEN", "Unsafe dependency path")
		var directory := DirAccess.open(parent)
		if directory == null or directory.is_link(part): return _error("FORBIDDEN", "Linked dependency path")
		parent = parent.path_join(part)
	var file := FileAccess.open(raw, FileAccess.READ)
	if file == null: return _error("NOT_FOUND", "Scene dependency missing")
	if file.get_length() > 65536:
		file.close()
		return _error("UNSUPPORTED", "Scene dependency exceeds 64 KiB")
	var text := file.get_as_text()
	file.close()
	var fingerprint := FileAccess.get_sha256(raw)
	if fingerprint != text.sha256_text(): return _error("CONFLICT", "Scene dependency changed while reading")
	visiting[raw] = true
	var header := RegEx.new()
	header.compile('^\\[gd_scene (?:load_steps=[0-9]+ )?format=3(?: uid="uid://[a-zA-Z0-9_]+")?\\]$')
	var external := RegEx.new()
	external.compile('^\\[ext_resource type="PackedScene" (?:uid="(uid://[a-zA-Z0-9_]+)" )?path="(res://[^"\\\\]+\\.tscn)" id="([a-zA-Z0-9_-]+)"\\]$')
	var node := RegEx.new()
	node.compile('^\\[node name="[a-zA-Z0-9_-]+"(?: type="([a-zA-Z0-9]+)")?(?: unique_id=[0-9]+)?(?: parent="[a-zA-Z0-9_./-]+")?(?: index="[0-9]+")?(?: unique_id=[0-9]+)?(?: instance=ExtResource\\("([a-zA-Z0-9_-]+)"\\))?\\]$')
	var property := RegEx.new()
	property.compile('^(position|rotation|scale|visible) = (true|false|[-+0-9.eE]+|Vector[23]\\([-+0-9.eE, ]+\\))$')
	var editable := RegEx.new()
	editable.compile('^\\[editable path="[a-zA-Z0-9_./-]+"\\]$')
	var first := true
	var count := 0
	var resources: Dictionary = {}
	for raw_line in text.split("\n"):
		var line := raw_line.strip_edges()
		if line.is_empty() or line.begins_with(";"): continue
		if first:
			if header.search(line) == null: return _error("UNSUPPORTED", "Unsupported native scene header")
			first = false
			continue
		var ext := external.search(line)
		if ext != null and count == 0:
			var uid := ext.get_string(1)
			var target := ext.get_string(2)
			var id := ext.get_string(3)
			if resources.has(id): return _error("CONFLICT", "Duplicate scene resource ID")
			resources[id] = target
			if not uid.is_empty():
				var identity := ResourceUID.text_to_id(uid)
				if ResourceUID.has_id(identity) and ResourceUID.get_id_path(identity) != target:
					return _error("CONFLICT", "Scene UID resolves to a different dependency")
			var nested := _scan(target, hashes, visiting, depth + 1)
			if nested.has("code"): return nested
			continue
		var entry := node.search(line)
		if entry != null:
			if not entry.get_string(1).is_empty() and entry.get_string(1) not in TYPES: return _error("UNSUPPORTED", "Unsupported dependency node class")
			if not entry.get_string(2).is_empty() and not resources.has(entry.get_string(2)): return _error("CONFLICT", "Unresolved scene instance resource")
			count += 1
			continue
		if count == 0 or (property.search(line) == null and editable.search(line) == null):
			return _error("UNSUPPORTED", "Scene dependency outside native instance/override grammar")
	if first or count == 0 or count > 32: return _error("UNSUPPORTED", "Native dependency requires 1..32 declarations")
	if FileAccess.get_sha256(raw) != fingerprint: return _error("CONFLICT", "Dependency changed during graph inspection")
	visiting.erase(raw)
	hashes[raw] = fingerprint
	return {}
