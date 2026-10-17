@tool
extends RefCounted
const UITheme = preload("res://addons/wheel_mcp/ui_theme.gd")
const ShaderAuthoring = preload("res://addons/wheel_mcp/shader_service.gd")
const Textures = preload("res://addons/wheel_mcp/texture_service.gd")

# Explicit native types only. Handles never interpret a client path as a Resource.
const FIELDS := {
	"StandardMaterial3D": ["albedo_color", "roughness", "metallic"],
	"ShaderMaterial": ["tint", "roughness"],
	"PhysicsMaterial": ["friction", "bounce", "rough", "absorbent"],
	"BoxShape3D": ["size"], "SphereShape3D": ["radius"],
	"CapsuleShape3D": ["radius", "height"], "CylinderShape3D": ["radius", "height"],
	"RectangleShape2D": ["size"], "CircleShape2D": ["radius"],
	"CapsuleShape2D": ["radius", "height"],
	"BoxMesh": ["size"], "SphereMesh": ["radius", "height"],
	"Theme": ["default_font_size"],
	"GradientTexture2D": [], # Immutable through resource_set; replace via an exact-plan assignment.
	"StyleBoxFlat": ["bg_color", "border_color", "border_width_left", "border_width_top", "border_width_right", "border_width_bottom", "corner_radius_top_left", "corner_radius_top_right", "corner_radius_bottom_left", "corner_radius_bottom_right", "content_margin_left", "content_margin_top", "content_margin_right", "content_margin_bottom"],
}
const SHADER := "shader_type spatial;\nuniform vec4 tint : source_color = vec4(1.0);\nuniform float roughness = 0.5;\nvoid fragment() { ALBEDO = tint.rgb; ROUGHNESS = roughness; }\n"
const NODE_PROPERTIES := ["material_override", "mesh", "shape", "physics_material_override", "theme", "texture"]
var _handles: Dictionary = {}
var _exports: Dictionary = {}
const TTL := 120000

static func error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

static func encode(value: Variant) -> Variant:
	if value is Color: return {"type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
	if value is Vector2: return {"type": "Vector2", "x": value.x, "y": value.y}
	if value is Vector3: return {"type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
	return value

static func describe(resource: Resource, mapping: Dictionary = {}) -> Dictionary:
	if resource == null or resource.get_script() != null or not FIELDS.has(resource.get_class()):
		return error("UNSUPPORTED", "Unsupported/scripted resource type")
	var fields: Array = FIELDS[resource.get_class()]
	if resource is ShaderMaterial and resource.shader is Shader and resource.shader.code != SHADER:
		fields = ShaderAuthoring.fields(resource.shader)
		if not ShaderAuthoring.supported(resource.shader): return error("UNSUPPORTED", "Unrecognized shader source or visual graph")
	# Reject opaque graphs, next_pass and cycles. Only the explicit shader,
	# UI Theme and bounded gradient graphs have separate storage contracts.
	var storage: Dictionary = {}
	for property in resource.get_property_list():
		if not (int(property.usage) & PROPERTY_USAGE_STORAGE): continue
		if resource is GradientTexture2D:
			var inspected := Textures.storage(resource)
			if inspected.has("code"): return inspected
			storage = inspected.storage
			break
		if resource is Theme:
			var inspected := UITheme.storage(resource)
			if inspected.has("code"): return inspected
			storage = inspected.storage
			break
		var value: Variant = resource.get(property.name)
		if value is Object:
			if resource is ShaderMaterial and str(property.name) == "shader" and value is Shader and value.get_script() == null and (value.code == SHADER or ShaderAuthoring.supported(value)):
				storage[str(property.name)] = value.code.sha256_text()
				continue
			if resource is ShaderMaterial and resource.shader is Shader and resource.shader.code == ShaderAuthoring.TEXTURE_BLEND_TEXT and str(property.name) in ["shader_parameter/layer_a", "shader_parameter/layer_b"] and value is ImageTexture:
				storage[str(property.name)] = value.get_image().get_data().hex_encode()
				continue
			return error("UNSUPPORTED", "Resource graph contains an unsupported dependency or cycle at " + str(property.name))
		if value is Array or value is Dictionary:
			return error("UNSUPPORTED", "Container resource graphs are not supported")
		storage[str(property.name)] = var_to_bytes(value).hex_encode()
	if resource is ShaderMaterial and resource.shader is Shader and resource.shader.code == ShaderAuthoring.TEXTURE_BLEND_TEXT:
		for key in ["layer_a", "layer_b"]:
			var texture: Variant = resource.get_shader_parameter(key)
			if not texture is ImageTexture: return error("UNSUPPORTED", "Texture blend requires native ImageTexture tiles")
			var image: Image = texture.get_image()
			if image == null or image.get_width() != 2 or image.get_height() != 2 or image.get_format() != Image.FORMAT_RGBA8:
				return error("UNSUPPORTED", "Texture tile changed type/dimensions")
			storage[key] = image.get_data().hex_encode()
	var properties: Dictionary = {}
	for property in fields:
		var value: Variant = resource.get_shader_parameter(property) if resource is ShaderMaterial else resource.get(property)
		properties[property] = encode(value)
	var actual: Resource = mapping.get(resource, resource)
	if resource is GradientTexture2D: properties = Textures.properties(resource)
	return {"resourceType": resource.get_class(), "properties": properties, "id": actual.get_instance_id(), "path": actual.resource_path, "storage": storage}

static func set_values(resource: Resource, values: Dictionary) -> Dictionary:
	if resource is GradientTexture2D: return error("UNSUPPORTED", "Declared textures are immutable; create and assign a replacement")
	var state := describe(resource)
	if state.has("code"): return state
	var fields: Array = state.properties.keys()
	if values.is_empty() or values.size() > 8: return error("INVALID_ARGUMENT", "Expected 1..8 resource properties")
	var decoded: Dictionary = {}
	for property in values:
		if property not in fields: return error("UNSUPPORTED", "Resource property not declared")
		var expected: Variant = resource.get_shader_parameter(property) if resource is ShaderMaterial else resource.get(property)
		var raw: Variant = values[property]
		var value: Variant = raw
		if (resource is StyleBoxFlat or resource is Theme) and expected is int and raw is float and is_finite(raw) and raw == floor(raw): value = int(raw)
		if raw is Dictionary:
			if raw.get("type") == "Color" and raw.size() == 5 and raw.get("r") is float and raw.get("g") is float and raw.get("b") is float and raw.get("a") is float:
				value = Color(raw.r, raw.g, raw.b, raw.a)
			elif raw.get("type") == "Vector2" and raw.size() == 3 and raw.get("x") is float and raw.get("y") is float:
				value = Vector2(raw.x, raw.y)
			elif raw.get("type") == "Vector3" and raw.size() == 4 and raw.get("x") is float and raw.get("y") is float and raw.get("z") is float:
				value = Vector3(raw.x, raw.y, raw.z)
			else: return error("INVALID_ARGUMENT", "Malformed typed resource value")
		if typeof(value) != typeof(expected): return error("INVALID_ARGUMENT", "Resource property type mismatch")
		if value is int and (value < 0 or value > 128 or (resource is Theme and value < 1)): return error("INVALID_ARGUMENT", "UI resource metric outside 0..128")
		if value is float and (not is_finite(value) or value < 0 or value > 1000000): return error("INVALID_ARGUMENT", "Invalid numeric resource value")
		if value is Vector2 and (not value.is_finite() or value.x <= 0 or value.y <= 0 or value.x > 1000000 or value.y > 1000000): return error("INVALID_ARGUMENT", "Invalid resource size")
		if value is Vector3 and (not value.is_finite() or value.x <= 0 or value.y <= 0 or value.z <= 0 or value.abs().max_axis_index() < 0 or value.length() > 1000000): return error("INVALID_ARGUMENT", "Invalid resource size")
		if value is Color and (not is_finite(value.r) or not is_finite(value.g) or not is_finite(value.b) or not is_finite(value.a) or value.r < 0 or value.g < 0 or value.b < 0 or value.a < 0 or value.r > 1 or value.g > 1 or value.b > 1 or value.a > 1): return error("INVALID_ARGUMENT", "Color must be finite 0..1")
		if property in ["roughness", "metallic", "bounce", "blend"] and value > 1: return error("INVALID_ARGUMENT", "Resource fraction must be 0..1")
		if property in ["radius", "height"] and value <= 0: return error("INVALID_ARGUMENT", "Shape dimension must be positive")
		decoded[property] = value
	# Set only a detached duplicate during preflight. Never mutate a live object here.
	for property in decoded:
		if resource is ShaderMaterial: resource.set_shader_parameter(property, decoded[property])
		else: resource.set(property, decoded[property])
	for property in decoded:
		var actual: Variant = resource.get_shader_parameter(property) if resource is ShaderMaterial else resource.get(property)
		# Several engine properties are float32 while JSON numbers are float64.
		# Accept only exact float32 representation, not arbitrary clamping/tolerance.
		if actual != decoded[property] and not (actual is float and decoded[property] is float and actual == float(PackedFloat32Array([decoded[property]])[0])):
			return error("VALIDATION_FAILED", "Engine normalized the requested resource value")
	return {"status": "PASS"}

static func create(kind: Variant, values: Variant) -> Dictionary:
	if not kind is String or not FIELDS.has(kind) or not values is Dictionary:
		return error("UNSUPPORTED", "Unknown resource kind/properties")
	if kind == "GradientTexture2D":
		if not values.is_empty(): return error("UNSUPPORTED", "Use the bounded texture source for custom gradients")
		return Textures.create({"format": "linear-gradient", "width": 16, "height": 16, "colors": [{"type": "Color", "r": 0, "g": 0, "b": 0, "a": 1}, {"type": "Color", "r": 1, "g": 1, "b": 1, "a": 1}]})
	var resource: Resource = ClassDB.instantiate(kind)
	if resource is ShaderMaterial:
		var shader := Shader.new()
		shader.code = SHADER
		resource.shader = shader
		resource.set_shader_parameter("tint", Color.WHITE)
		resource.set_shader_parameter("roughness", 0.5)
	var result := set_values(resource, values) if not values.is_empty() else {"status": "PASS"}
	if result.has("code"): return result
	return {"resource": resource}

func shutdown() -> void:
	_handles.clear()
	_exports.clear()

func _expire() -> void:
	for handle in _handles.keys():
		if Time.get_ticks_msec() >= _handles[handle].expires: _handles.erase(handle)
	for hash in _exports.keys():
		if Time.get_ticks_msec() >= _exports[hash].expires: _exports.erase(hash)

func retain(resource: Resource, owner: String, identity: Dictionary) -> Dictionary:
	_expire()
	var state := describe(resource)
	if state.has("code"): return state
	if _handles.size() >= 64: return error("CONFLICT", "Resource handle quota exceeded")
	var id := Crypto.new().generate_random_bytes(16).hex_encode()
	var ref := {"type": "ResourceRef", "handle": id, "resourceType": resource.get_class(), "projectId": identity.projectId, "sessionId": identity.sessionId, "ownerId": owner, "fingerprint": JSON.stringify(state).sha256_text()}
	_handles[id] = {"resource": resource, "ref": ref, "expires": Time.get_ticks_msec() + TTL}
	return {"status": "PASS", "ref": ref, "properties": state.properties, "expiresInMs": TTL, "persisted": false}

func resolve(ref: Variant, owner: String, identity: Dictionary) -> Dictionary:
	_expire()
	if not ref is Dictionary or ref.get("type") != "ResourceRef" or ref.size() != 7 or not _handles.has(ref.get("handle", "")):
		return error("NOT_FOUND", "Resource handle missing or expired")
	var record: Dictionary = _handles[ref.handle]
	if ref.get("ownerId") != owner or ref.get("projectId") != identity.projectId or ref.get("sessionId") != identity.sessionId or JSON.stringify(ref) != JSON.stringify(record.ref):
		return error("FORBIDDEN", "Resource handle scope/type/fingerprint mismatch")
	var state := describe(record.resource)
	if state.has("code"): return state
	if JSON.stringify(state).sha256_text() != ref.fingerprint: return error("CONFLICT", "Resource changed; obtain a fresh handle")
	return {"resource": record.resource, "properties": state.properties}

func dispatch(params: Dictionary, owner: String, identity: Dictionary) -> Dictionary:
	if params.get("sessionId") != identity.sessionId: return error("CONFLICT", "Resource editor session changed")
	var action: Variant = params.get("action")
	if action == "texture":
		var made := Textures.create(params.get("source"))
		return made if made.has("code") else retain(made.resource, owner, identity)
	if action == "shader_capabilities":
		return {"status": "PASS", "capability": "scene.shader/v1", "textTemplates": ["spatial-unshaded-tint/v1", "spatial-unshaded-texture-blend/v1"], "visualNodes": ["color", "mix"], "visualPorts": {"color": {"outputs": ["vec3", "float"]}, "mix": {"inputs": ["vec3", "vec3", "float"], "outputs": ["vec3"]}, "fragment": {"inputs": {"ALBEDO": "vec3"}}}, "renderModes": ["spatial/unshaded", "spatial/visual-fragment"], "supportedRenderers": ["forward_plus", "mobile", "gl_compatibility"], "editorRenderer": RenderingServer.get_current_rendering_method(), "renderValidation": "NOT_RUN", "persisted": false}
	if action == "theme":
		var resources: Dictionary = {}
		if not params.get("items") is Array: return error("INVALID_ARGUMENT", "Missing Theme items")
		for item in params.items:
			if item is Dictionary and item.get("kind") == "stylebox":
				var checked := resolve(item.get("ref"), owner, identity)
				if checked.has("code"): return checked
				resources[item.ref.handle] = checked.resource
		var made := UITheme.create(params.items, resources)
		if made.has("code"): return made
		return retain(made.resource, owner, identity)
	if action == "shader":
		var authored := ShaderAuthoring.create(params.get("source"))
		if authored.has("code"): return authored
		if not authored.has("resource"): return error("VALIDATION_FAILED", "Native shader authoring produced no resource")
		return retain(authored.resource, owner, identity)
	if action == "adopt":
		_expire()
		var raw: Variant = params.get("path")
		var hash: Variant = params.get("sourceHash")
		if not raw is String or not raw.begins_with("res://") or not raw.ends_with(".tres") or ".." in raw or "\\" in raw or raw.length() > 512 or not hash is String or not _exports.has(hash) or _exports[hash].owner != owner:
			return error("FORBIDDEN", "Only an exact native export from this owner can be referenced")
		var parent := "res://"
		for part in raw.substr(6).split("/"):
			if part.is_empty() or part == "." or part.to_lower() in [".harness", ".godot", ".git"] or ":" in part:
				return error("FORBIDDEN", "Protected resource path")
			var directory := DirAccess.open(parent)
			if directory == null or directory.is_link(part): return error("FORBIDDEN", "Linked resource path")
			parent = parent.path_join(part)
		if FileAccess.get_sha256(raw) != hash: return error("CONFLICT", "Native export bytes changed")
		var resource: Resource = ResourceLoader.load(raw, "", ResourceLoader.CACHE_MODE_IGNORE)
		if resource == null or FileAccess.get_sha256(raw) != hash: return error("CONFLICT", "Resource changed during readback")
		return retain(resource, owner, identity)
	if action == "create":
		var made := create(params.get("resourceType"), params.get("properties", {}))
		return made if made.has("code") else retain(made.resource, owner, identity)
	if action == "reference":
		var root := EditorInterface.get_edited_scene_root()
		var raw: Variant = params.get("path")
		var property: Variant = params.get("property")
		if root == null: return error("ENGINE_UNAVAILABLE", "No edited scene")
		if not raw is String or raw.length() > 512 or raw.begins_with("/") or ".." in raw or ":" in raw or "%" in raw or "\\" in raw or property not in NODE_PROPERTIES:
			return error("INVALID_ARGUMENT", "Invalid resource node/property")
		var node := root if raw == "." else root.get_node_or_null(NodePath(raw))
		if node == null or node.get_script() != null: return error("NOT_FOUND", "Unscripted resource node not found")
		var exists := false
		for item in node.get_property_list():
			if str(item.name) == property: exists = true
		if not exists: return error("INVALID_ARGUMENT", "Node does not declare resource property")
		var value: Variant = node.get(property)
		if not value is Resource: return error("NOT_FOUND", "Node property has no resource")
		return retain(value, owner, identity)
	if action not in ["read", "duplicate", "release", "export"]: return error("UNSUPPORTED", "Unsupported resource action")
	var resolved := resolve(params.get("ref"), owner, identity)
	if resolved.has("code"): return resolved
	if action == "release":
		_handles.erase(params.ref.handle)
		return {"status": "PASS", "released": true, "persisted": false}
	if action == "duplicate":
		var unique: Resource = resolved.resource.duplicate(true)
		unique.resource_path = ""
		return retain(unique, owner, identity)
	if action == "export":
		var record: Dictionary = _handles[params.ref.handle]
		var uid: Variant = params.get("uid", "")
		if not uid is String or uid.length() > 40 or (not uid.is_empty() and ResourceUID.text_to_id(uid) == ResourceUID.INVALID_ID): return error("INVALID_ARGUMENT", "Invalid native resource UID")
		if record.has("export") and (uid.is_empty() or record.export.content.contains('uid="' + uid + '"')): return record.export
		if _exports.size() >= 64: return error("CONFLICT", "Export quota exceeded")
		var root := DirAccess.open("res://")
		var internal := DirAccess.open("res://.harness")
		if root == null or root.is_link(".harness") or internal == null or internal.is_link("resource-staging"):
			return error("FORBIDDEN", "Unsafe resource staging path")
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.harness/resource-staging"))
		var staged := "res://.harness/resource-staging/" + Crypto.new().generate_random_bytes(16).hex_encode() + ".tres"
		var copy: Resource = resolved.resource.duplicate(true)
		copy.resource_path = ""
		if ResourceSaver.save(copy, staged) != OK: return error("VALIDATION_FAILED", "ResourceSaver staging failed")
		if not uid.is_empty() and ResourceSaver.set_uid(staged, ResourceUID.text_to_id(uid)) != OK: return error("VALIDATION_FAILED", "Resource UID preservation failed")
		var loaded: Resource = ResourceLoader.load(staged, "", ResourceLoader.CACHE_MODE_IGNORE)
		var before := describe(copy)
		var after := describe(loaded)
		if after.has("code") or after.resourceType != before.resourceType or JSON.stringify(after.properties) != JSON.stringify(before.properties) or ((copy is Theme or copy is StyleBoxFlat or copy is ShaderMaterial or copy is GradientTexture2D) and after.storage != before.storage):
			return error("VALIDATION_FAILED", "ResourceSaver roundtrip differs")
		var content := FileAccess.get_file_as_string(staged)
		DirAccess.remove_absolute(ProjectSettings.globalize_path(staged))
		if content.to_utf8_buffer().size() > 24000: return error("UNSUPPORTED", "Native export exceeds review budget")
		var hash := content.sha256_text()
		_exports[hash] = {"owner": owner, "expires": Time.get_ticks_msec() + TTL}
		var exported := {"status": "PASS", "persisted": false, "validation": "PASS", "content": content, "sourceHash": hash, "resourceType": before.resourceType, "properties": before.properties}
		record["export"] = exported
		return exported
	return {"status": "PASS", "ref": params.ref, "properties": resolved.properties, "persisted": false}
